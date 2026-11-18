import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { ProgramDescription } from "@workspace/natlang/describe-types";
import type { RuntimeFs, VcsClient } from "@workspace/runtime";
import type {
  AuthoringFinding,
  AuthoringReport,
  CompilerIssue,
  ProgramReadback,
  ProgramRole,
} from "@workspace-skills/natlang-authoring/types";
import { managedAuthoringWorlds } from "./authoring-worlds.js";

type Ports = {
  fs: Pick<RuntimeFs, "mkdtemp" | "mkdir" | "writeFile" | "readFile">;
  vcs: Pick<VcsClient, "status">;
  describe(path: string): Promise<ProgramDescription>;
};

async function seed(
  fs: Ports["fs"],
  directory: string,
  files: Record<string, string>,
) {
  await fs.mkdir(directory, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const file = `${directory}/${path}`;
    await fs.mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(file, content);
  }
  return { directory, paths: Object.keys(files).sort() };
}

type Seed = Awaited<ReturnType<typeof seed>>;

async function fingerprint(fs: Ports["fs"], source: Seed) {
  const snapshot = await Promise.all(
    source.paths.map(async (path) => [
      path,
      await fs.readFile(`${source.directory}/${path}`, "utf8"),
    ]),
  );
  return sha256HexSyncText(JSON.stringify(snapshot));
}

function compilerIssues(path: string, error: unknown): CompilerIssue[] {
  const typed = error as { message?: string; errorData?: { reason?: string } };
  if (
    typed?.errorData?.reason !== "does-not-compile" ||
    typeof typed.message !== "string"
  )
    throw error;
  const relative = path.replace(/^\//u, "");
  const issues = typed.message.split("\n").flatMap((line) => {
    const match = /^(.*?):(\d+):(\d+) (?:error|warning) ([^:]+): (.*)$/u.exec(
      line,
    );
    if (!match) return [];
    const source = match[1]!.replace(/^\//u, "");
    return [
      {
        source: source.startsWith(`${relative}/`)
          ? source.slice(relative.length + 1)
          : source,
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4]!,
        message: match[5]!,
      },
    ];
  });
  return issues.length
    ? issues
    : [
        {
          source: ".",
          line: 0,
          column: 0,
          code: "does-not-compile",
          message: typed.message,
        },
      ];
}

export async function prepareManagedAuthoring(ports: Ports, caseId: string) {
  const world = managedAuthoringWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown managed Natlang authoring case");
  const before = await ports.vcs.status();
  const scope = await ports.fs.mkdtemp("natlang-authoring");
  const candidate = await seed(ports.fs, `${scope}/candidate`, world.candidate);
  const baseline = world.baseline
    ? await seed(ports.fs, `${scope}/baseline`, world.baseline)
    : null;
  const expected = {
    candidate: await fingerprint(ports.fs, candidate),
    baseline: baseline ? await fingerprint(ports.fs, baseline) : null,
  };
  const reads: ProgramReadback[] = [];
  const requested = new Set<ProgramRole>();
  const service = {
    async inspect(role: ProgramRole): Promise<ProgramReadback> {
      if ((role !== "candidate" && role !== "baseline") || requested.has(role))
        throw new Error("Inspect each caller-assigned program role once.");
      const seed = role === "candidate" ? candidate : baseline;
      if (!seed)
        throw new Error(
          "The caller did not assign a baseline for this review.",
        );
      requested.add(role);
      const revision = await fingerprint(ports.fs, seed);
      if (revision !== expected[role])
        throw new Error(
          "The assigned source changed before compiler inspection.",
        );
      let readback: ProgramReadback;
      try {
        const shape = await ports.describe(seed.directory);
        readback = {
          role,
          revision,
          state: "compiled",
          functions: shape.functions.map(({ source, params, returns }) => ({
            source,
            parameters: params,
            returns,
          })),
          services: [...shape.services],
        };
      } catch (error) {
        readback = {
          role,
          revision,
          state: "rejected",
          diagnostics: compilerIssues(seed.directory, error),
        };
      }
      reads.push(readback);
      return structuredClone(readback);
    },
  };
  return {
    request: world.request,
    world,
    service,
    candidate,
    baseline,
    expected,
    before,
    reads,
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedAuthoring>>;
const location = (issue: CompilerIssue) =>
  `${issue.source}:${issue.line}:${issue.column}`;
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export function reviewCompilerReadbacks(prepared: Prepared): AuthoringReport {
  const [candidate, baseline] = prepared.reads;
  if (!candidate) throw new Error("Candidate compiler evidence is missing");
  const report = {
    candidateRevision: candidate.revision,
    baselineRevision: baseline?.revision ?? null,
    findings: [] as AuthoringFinding[],
  };
  if (candidate.state === "rejected" || baseline?.state === "rejected") {
    const issue =
      candidate.state === "rejected"
        ? candidate.diagnostics[0]
        : baseline?.state === "rejected"
          ? baseline.diagnostics[0]
          : undefined;
    if (!issue) throw new Error("The compiler rejection has no diagnostic");
    report.findings.push({
      code: "compiler-error",
      subject: location(issue),
      observed: issue.code,
      recovery: issue.message,
    });
    return {
      ...report,
      status:
        candidate.state === "rejected"
          ? "candidate-rejected"
          : "baseline-rejected",
    };
  }
  const { contract } = prepared.request;
  const entry = candidate.functions.find(
    ({ source }) => source === contract.entry,
  );
  const prior = contract.preserveBaseline
    ? baseline?.functions.find(({ source }) => source === contract.entry)
    : undefined;
  const expectParameters = contract.expectedParameters ?? prior?.parameters;
  const expectReturn = contract.expectedReturn ?? prior?.returns;
  const services =
    contract.declaredServices ??
    (contract.preserveBaseline ? baseline?.services : undefined);
  const add = (
    code: AuthoringFinding["code"],
    subject: string,
    observed: string,
    recovery: string,
  ) => report.findings.push({ code, subject, observed, recovery });
  if (!entry)
    add(
      "missing-entry",
      contract.entry,
      "missing",
      "Restore the assigned entry file.",
    );
  else {
    if (expectParameters && !same(entry.parameters, expectParameters))
      add(
        "parameter-change",
        contract.entry,
        entry.parameters.join(", "),
        "Keep the expected named parameters and their order.",
      );
    if (expectReturn && entry.returns !== expectReturn)
      add(
        "return-change",
        contract.entry,
        entry.returns,
        "Restore the expected result type.",
      );
  }
  if (services) {
    for (const name of services)
      if (!candidate.services.includes(name))
        add(
          "missing-service",
          name,
          "missing",
          "Restore the required declaration.",
        );
    for (const name of candidate.services)
      if (!services.includes(name))
        add(
          "unexpected-service",
          name,
          "declared",
          "Remove the unassigned service.",
        );
  }
  for (const helper of contract.requiredHelpers)
    if (!candidate.functions.some(({ source }) => source === helper))
      add(
        "missing-helper",
        helper,
        "missing",
        "Restore the helper within the assigned callable folder.",
      );
  return {
    ...report,
    status: report.findings.length ? "changes-required" : "ready",
  };
}

export async function verifyManagedAuthoring(
  ports: Ports,
  prepared: Prepared,
  value: unknown,
) {
  const after = await ports.vcs.status();
  const baselineRevision = prepared.baseline
    ? await fingerprint(ports.fs, prepared.baseline)
    : null;
  const candidateRevision = await fingerprint(ports.fs, prepared.candidate);
  const report = value as AuthoringReport | null;
  const actual = reviewCompilerReadbacks(prepared);
  const normalized = (findings: AuthoringFinding[]) =>
    findings
      .map(({ code, subject, observed }) =>
        JSON.stringify({ code, subject, observed }),
      )
      .sort();
  const fixtureMarkers = prepared.world.expected.markers
    .map(({ code, subject }) => `${code}:${subject}`)
    .sort();
  const observedMarkers = actual.findings
    .map(
      ({ code, subject }) =>
        `${code}:${code === "compiler-error" ? subject.replace(/:\d+:\d+$/u, "") : subject}`,
    )
    .sort();
  const checks = {
    sourceUnchanged:
      candidateRevision === prepared.expected.candidate &&
      baselineRevision === prepared.expected.baseline,
    workspaceHeadUnchanged:
      after.mainEventId === prepared.before.mainEventId &&
      same(after.workingHead, prepared.before.workingHead),
    exactInspections: same(
      prepared.reads.map(({ role }) => role),
      prepared.baseline ? ["candidate", "baseline"] : ["candidate"],
    ),
    intendedWorld:
      actual.status === prepared.world.expected.status &&
      same(observedMarkers, fixtureMarkers),
    joinedFindings:
      report?.status === actual.status &&
      report.candidateRevision === candidateRevision &&
      report.baselineRevision === baselineRevision &&
      Array.isArray(report.findings) &&
      report.findings.every(
        (finding) =>
          typeof finding?.recovery === "string" &&
          Boolean(finding.recovery.trim()),
      ) &&
      same(normalized(report.findings), normalized(actual.findings)),
  };
  return {
    caseId: prepared.world.id,
    candidateRevision,
    baselineRevision,
    status: actual.status,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

export async function qualifyManagedAuthoring(ports: Ports, caseId: string) {
  const prepared = await prepareManagedAuthoring(ports, caseId);
  await prepared.service.inspect("candidate");
  if (prepared.request.compare) await prepared.service.inspect("baseline");
  const reference = reviewCompilerReadbacks(prepared);
  const accepted = await verifyManagedAuthoring(ports, prepared, reference);
  const altered = await verifyManagedAuthoring(ports, prepared, {
    ...reference,
    candidateRevision:
      reference.baselineRevision === reference.candidateRevision
        ? "earlier"
        : (reference.baselineRevision ?? "wrong"),
  });
  return { accepted, rejectedStaleRevision: !altered.passed };
}
