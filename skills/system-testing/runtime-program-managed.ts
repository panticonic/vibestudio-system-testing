import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { ProgramDescription } from "@workspace/natlang/describe-types";
import type { RuntimeFs } from "@workspace/runtime";
import { managedRuntimeProgramWorlds } from "./runtime-program-worlds.js";

type Ports = {
  fs: Pick<RuntimeFs, "mkdtemp" | "writeFile" | "readFile">;
  describe(path: string): Promise<ProgramDescription>;
  load(path: string): Promise<unknown>;
};
type Diagnostic = "result-type" | "missing-import" | "other";

export function classifyCompile(error: unknown): Diagnostic {
  const typed = error as { message?: string; errorData?: { reason?: string } };
  if (
    typed?.errorData?.reason !== "does-not-compile" ||
    typeof typed.message !== "string"
  )
    throw error;
  if (
    /cannot find module|module .* (?:not found|does not exist)|missing import/iu.test(
      typed.message,
    )
  )
    return "missing-import";
  if (/not assignable to type/iu.test(typed.message)) return "result-type";
  return "other";
}

export async function measureRuntimeProgram(
  ports: Ports,
  contextId: string,
  evalRunId: string,
  caseId: string,
) {
  const world = managedRuntimeProgramWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown runtime program assignment");
  const directory = await ports.fs.mkdtemp("runtime-program-review");
  const names = Object.keys(world.files).sort();
  const path = directory + "/main.ts";
  for (const [name, contents] of Object.entries(world.files))
    await ports.fs.writeFile(directory + "/" + name, contents);
  const revision = async () =>
    sha256HexSyncText(
      JSON.stringify(
        await Promise.all(
          names.map(async (name) => [
            name,
            await ports.fs.readFile(directory + "/" + name, "utf8"),
          ]),
        ),
      ),
    );
  const original = await revision();
  let diagnostic: Diagnostic | null = null;
  let signature = false;
  try {
    await ports.describe(path);
  } catch (error) {
    diagnostic = classifyCompile(error);
  }

  const program =
    diagnostic === null
      ? ((await ports.load(path)) as {
          check?: (input: unknown) => Promise<unknown>;
        })
      : null;
  signature = typeof program?.check === "function";
  let execution: null | {
    id: string;
    state: "verified" | "unchecked" | "failed" | "stale";
  } = null;
  let returned: unknown = null;
  let thrown: string | null = null;
  const assigned = world.execution;
  if (assigned) {
    if (diagnostic || !signature)
      throw new Error("The assigned program must compile before its execution");
    if (typeof program?.check !== "function")
      throw new Error(
        "The loaded program does not expose the assigned callable",
      );
    try {
      returned = await program.check(assigned.input);
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    if (assigned.kind === "failure") {
      if (!thrown?.includes(assigned.message))
        throw new Error(
          "The loaded program did not record the assigned execution failure",
        );
      execution = { id: evalRunId, state: "failed" };
    } else {
      if (thrown !== null)
        throw new Error("Unexpected loaded program failure: " + thrown);
      if (
        assigned.kind !== "unchecked" &&
        JSON.stringify(returned) !== JSON.stringify(assigned.output)
      )
        throw new Error(
          "The loaded program did not return the independently checked output",
        );
      execution = {
        id: evalRunId,
        state: assigned.kind === "check" ? "verified" : assigned.kind,
      };
    }
    if (assigned.kind === "stale")
      await ports.fs.writeFile(path, assigned.replacement);
  }
  const current = await revision();
  if ((current !== original) !== (execution?.state === "stale"))
    throw new Error("The assigned revision diverged from its program receipt");
  if (!diagnostic && !signature)
    throw new Error(
      "Compiler receipt did not describe the actual exported callable",
    );
  const request = {
    kind: "program" as const,
    goal: world.goal,
    path,
    compiler: diagnostic ? ("failed" as const) : ("passed" as const),
    diagnostic,
    call: null,
    userRequestedRetry: false,
    ...(execution ? { execution } : {}),
  };
  return {
    caseId,
    contextId,
    request,
    expected: world.expected,
    receipt: {
      evalRunId,
      original,
      current,
      signature,
      returned,
      thrown,
      execution,
    },
  };
}
type Observation = Awaited<ReturnType<typeof measureRuntimeProgram>>;

export function verifyRuntimeProgram(
  observed: Observation,
  report: { kind?: string; next?: string; basis?: string } | null,
) {
  const { request, expected, receipt } = observed;
  const compileDecision = {
    "result-type": "repair-result-contract",
    "missing-import": "resolve-import",
    other: "read-diagnostic",
  } as const;
  const executionDecision = {
    verified: "verified",
    unchecked: "inspect-trace",
    failed: "inspect-trace",
    stale: "refresh-program-receipt",
  } as const;
  const next = request.diagnostic
    ? compileDecision[request.diagnostic]
    : request.execution
      ? executionDecision[request.execution.state]
      : "call-reviewed-signature";

  const checks = {
    observation:
      expected === next &&
      receipt.signature === (request.compiler === "passed") &&
      (request.execution === undefined ||
        request.execution.id === receipt.evalRunId),

    verdict: report?.kind === "program" && report.next === expected,
    basis: report?.basis === (request.execution?.id ?? request.path),
    source:
      receipt.original.length === 64 &&
      receipt.current.length === 64 &&
      (receipt.original !== receipt.current) ===
        (request.execution?.state === "stale"),
  };
  return { observed, checks, passed: Object.values(checks).every(Boolean) };
}
