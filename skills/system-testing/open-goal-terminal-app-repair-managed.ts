import {assessTerminalRepairGoal,terminalRepairReturnIsBound} from "./terminal-repair-return-evidence.js";
import type {ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import type { VcsClient } from "@workspace/runtime";
import { createUnitRepair } from "@workspace/natlang-services";
import { verifyUnit } from "@workspace/harness/unit-verification";
import {
  sha256HexSyncText,
  stableSha256Hex,
} from "@vibestudio/content-addressing";
import { expectedBuildUnitName } from "@vibestudio/workspace-contracts/sourceDirs";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { RpcCaller } from "@vibestudio/rpc";
import type { TerminalRepairFixture } from "./open-goal-terminal-app-repair-worlds.js";

export { verifyUnit };
type Unit = ReturnType<typeof createUnitRepair>;
type Evidence = Awaited<ReturnType<Unit["unitRepair"]["observe"]>>;
type Edits = Parameters<Unit["unitRepairEdit"]["apply"]>[1];
type Metadata = Awaited<ReturnType<NonNullable<Ports["metadata"]>>>;
type Ports = {
  vcs: Pick<
    VcsClient,
    | "status"
    | "resolveRepository"
    | "listFiles"
    | "readFile"
    | "edit"
    | "importSnapshot"
  >;
  getBuildReport(unit: string, ref: string): Promise<unknown>;
  verifyTests: Parameters<typeof createUnitRepair>[0]["verifyTests"];
  putText(text: string): Promise<{ digest: string }>;
  metadata?: (
    key: string,
  ) => Promise<
    import("@vibestudio/service-schemas/build").BuildMetadataWire | null
  >;
};
type Journal = {
  service: string;
  method: string;
  args: unknown[];
  result: unknown;
};
const suite = "unit";

export function terminalRepairFiles(
  unit: string,
  world: TerminalRepairFixture,
) {
  const manifest = {
    name: expectedBuildUnitName(unit),
    version: "0.1.0",
    private: true,
    type: "module",
    vibestudio: {
      title: world.title,
      entry: "index.ts",
      description: "Owned terminal rendering verification fixture",
      authority: { requests: [], provides: [] },
      tests: [
        { name: suite, runtime: "native", include: ["**/index.test.ts"] },
      ],
    },
    devDependencies: { vitest: "^3.2.4" },
  };
  const production = (
    body: string,
  ) => `export function terminalDisplay(${world.params}): ${world.returns} {
  ${body}
}

console.log(JSON.stringify(terminalDisplay(${world.assertions[0]![1]})));
`;
  const broken = production(world.faulty);
  const repair = production(world.repaired);
  const tests = `import { describe, expect, it } from "vitest";
import { terminalDisplay } from "./index.js";

describe(${JSON.stringify(world.title)}, () => {
${world.assertions.map(([name, args, value]) => `  it(${JSON.stringify(name)}, () => expect(terminalDisplay(${args})).toEqual(${JSON.stringify(value)}));`).join("\n")}
});
`;
  return {
    broken,
    repair,
    files: {
      "package.json": JSON.stringify(manifest, null, 2) + "\n",
      "index.ts": broken,
      "index.test.ts": tests,
    },
  };
}

export function terminalRepairHostPorts(
  rpc: Pick<RpcCaller, "call">,
  vcs: Ports["vcs"],
  verifyTests: Ports["verifyTests"],
): Ports {
  return {
    vcs,
    verifyTests,
    getBuildReport: (unit, ref) =>
      rpc.call("main", mainRpcMethods["build.getBuildReport"], [unit, ref]),
    putText: (text) =>
      rpc.call("main", mainRpcMethods["blobstore.putText"], [text]),
    metadata: (key) =>
      rpc.call("main", mainRpcMethods["build.getBuildMetadata"], [key]),
  };
}

export async function prepareOpenTerminalAppRepair(
  contextId: string,
  world: TerminalRepairFixture,
  ports: Ports,
) {
  const { vcs } = ports;
  const nonce = crypto.randomUUID();
  const unit = `terminal-apps/disposable-repair-${nonce}`;
  const entry = `${unit}/index.ts`;
  const testPath = `${unit}/index.test.ts`;
  const manifestPath = `${unit}/package.json`;
  const title = world.title;
  const app = {
    id: nonce,
    path: unit,
    title,
    ownership: "current" as const,
    mayEdit: world.mode !== "hold-edit",
    mayTest: world.mode !== "hold-test",
  };
  const prior = {
    ...app,
    id: `retired-${nonce}`,
    path: `${unit}-retired`,
    ownership: "retired" as const,
    mayEdit: false,
    mayTest: false,
  };
  const original = terminalRepairFiles(unit, world);
  const status = () => vcs.status({ contextId });
  const before = await status();
  const repositories = [
    {
      repoPath: unit,
      files: await Promise.all(
        Object.entries(original.files)
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(async ([path, text]) => {
            const { digest } = await ports.putText(text);
            if (digest !== sha256HexSyncText(text))
              throw new Error(
                "The source blob changed while staging the terminal fixture",
              );
            return { path, mode: 0o644, contentHash: digest };
          }),
      ),
    },
  ];
  const seeded = await vcs.importSnapshot({
    contextId,
    expectedWorkingHead: before.workingHead,
    commandId: `terminal-repair-fixture-${nonce}`,
    intentSummary: "Prepare an isolated terminal application regression",
    source: {
      kind: "generated",
      uri: `system-test://terminal-app-repair/${nonce}`,
      snapshotRevision: stableSha256Hex(repositories),
    },
    repositories,
    message: "Retain exact original production source and focused suite",
  });
  const initialState = (await status()).workingHead;
  if (initialState.kind !== "event" || seeded.eventId !== initialState.eventId)
    throw new Error(
      "Owned terminal repair source did not become the exact fixture revision",
    );
  const repository = await vcs.resolveRepository({
    state: initialState,
    repoPath: unit,
  });
  if (
    !repository ||
    !seeded.importedRepositoryIds.includes(repository.repositoryId)
  )
    throw new Error("Unable to bind the exact owned terminal app repository");

  const options = {
    contextId,
    unit,
    suite,
    editablePaths: [entry],
    vcs,
    build: { getBuildReport: ports.getBuildReport },
    verifyTests: ports.verifyTests,
  };
  const appRepair = createUnitRepair(options);
  const independent = createUnitRepair(options);
  const evidence = await independent.unitRepair.observe();
  const protectedBefore = await independent.unitRepair.readSource(
    evidence.revision,
    [manifestPath, testPath],
  );
  const journal: Journal[] = [];
  type Observation = Awaited<ReturnType<typeof check>>;
  let initial: Observation | null = null;
  let final: Observation | null = null;
  let finishedBuild: Evidence | null = null;
  let artifact: {
    source: string;
    revision: string;
    stateHash: string;
    buildKey: string;
    runtime: "terminal";
    artifactDigest: string;
    executionDigest: string;
  } | null = null;
  let movedRevision: string | null = null;
  let applied: Awaited<ReturnType<typeof apply>> | null = null;
  const movedSource =
    original.broken +
    "\n// The owner's replacement draft still requires its own review.\n";
  function chosen(id: string) {
    if (id !== app.id)
      throw new Error("This is not the currently owned terminal app.");
  }
  function record<T>(
    service: string,
    method: string,
    args: unknown[],
    result: T,
  ): T {
    journal.push(structuredClone({ service, method, args, result }));
    return result;
  }
  async function check(repair: Unit, expected?: string) {
    let latest =
      expected === undefined
        ? await repair.unitRepair.observe()
        : await repair.unitRepairEdit.build(expected);
    const paths = await repair.unitRepair.listSource(latest.revision);
    const sources = await repair.unitRepair.readSource(latest.revision, [
      entry,
      manifestPath,
      testPath,
    ]);
    if (latest.build.status === "ok" && app.mayTest)
      latest = await repair.unitRepairEdit.test(latest.revision);
    const native = latest.tests;
    const report =
      native?.status !== "compilation-failed" ? native?.report : null;
    return {
      evidence: latest,
      public: {
        observed: {
          revision: latest.revision,
          stateHash: latest.build.stateHash,
          buildStatus: latest.build.status,
          diagnostics: latest.build.diagnostics,
          paths,
          sources,
        },
        tests: native
          ? {
              revision: latest.revision,
              stateHash: native.receipt.stateHash,
              runtime: native.receipt.runtime,
              status: native.status,
              suite: native.receipt.suite,
              artifactKey: native.receipt.artifactKey ?? null,
              executionDigest: native.receipt.executionDigest ?? null,
              passed: report?.passed ?? 0,
              failed: report?.failed ?? 0,
              total: report?.total ?? 0,
              details: report?.details ?? [],
            }
          : null,
      },
    };
  }
  async function apply(id: string, revision: string, edits: Edits) {
    chosen(id);
    if (
      !app.mayEdit ||
      !app.mayTest ||
      !initial ||
      revision !== initial.evidence.revision ||
      applied
    )
      throw new Error(
        "The exact terminal repair authority or observed source is absent",
      );
    if (world.mode === "hold-moved") {
      // The fixture's independent coauthor moves the actual semantic VCS head before the model's stale CAS.
      movedRevision = (
        await independent.unitRepairEdit.apply(revision, [
          { path: entry, before: original.broken, after: movedSource },
        ])
      ).revision;
      try {
        await appRepair.unitRepairEdit.apply(revision, edits);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("Revision changed")
        )
          return { status: "moved" as const, revision: movedRevision };
        throw error;
      }
      throw new Error("A stale terminal source repair unexpectedly applied");
    }
    const updated = await appRepair.unitRepairEdit.apply(revision, edits);
    return { status: "applied" as const, revision: updated.revision };
  }
  function proven(evidence: Evidence) {
    const result = evidence.tests;
    return (
      evidence.build.status === "ok" &&
      result?.status === "passed" &&
      result.report.runtime === "native" &&
      result.report.total === world.assertions.length &&
      result.report.failed === 0 &&
      result.report.passed === world.assertions.length &&
      result.truncatedFiles === 0 &&
      result.truncatedErrors === 0
    );
  }
  async function readArtifact(result: Evidence) {
    if (
      !proven(result) ||
      !ports.metadata ||
      JSON.stringify((await status()).workingHead) !== result.revision
    )
      return null;
    const key = result.build.builds.find(
      (item) => item.target === "runtime",
    )?.buildKey;
    if (!key) return null;
    const metadata: Metadata = await ports.metadata(key);
    if (
      !metadata ||
      JSON.stringify((await status()).workingHead) !== result.revision ||
      metadata.kind !== "panel" ||
      metadata.details.kind !== "terminal" ||
      metadata.name !== expectedBuildUnitName(unit) ||
      metadata.buildKey !== key ||
      metadata.execution?.buildKey !== key ||
      metadata.sourcePath !== unit ||
      metadata.sourceStateHash?.replace(/^state:/u, "") !==
        result.build.stateHash.replace(/^state:/u, "")
    )
      return null;
    return {
      source: unit,
      revision: result.revision,
      stateHash: result.build.stateHash,
      buildKey: key,
      runtime: "terminal" as const,
      artifactDigest: metadata.execution.artifactDigest,
      executionDigest: metadata.execution.executionDigest,
    };
  }

  const services = {
    terminalRepairCatalog: {
      async list() {
        return record("terminalRepairCatalog", "list", [], [app, prior]);
      },
    },
    terminalRepairObserve: {
      async read(id: string) {
        chosen(id);
        if (initial)
          throw new Error(
            "This repair assignment has one reviewed source revision",
          );
        initial = await check(appRepair);
        return record("terminalRepairObserve", "read", [id], initial.public);
      },
    },
    terminalRepairApply: {
      async edit(id: string, revision: string, edits: Edits) {
        applied = await apply(id, revision, edits);
        return record(
          "terminalRepairApply",
          "edit",
          [id, revision, edits],
          applied,
        );
      },
    },
    terminalRepairFinal: {
      async verify(id: string, revision: string) {
        chosen(id);
        if (
          !initial ||
          !app.mayTest ||
          final ||
          applied?.status === "moved" ||
          revision !== (applied?.revision ?? initial.evidence.revision)
        )
          throw new Error(
            "Final verification needs the exact observed terminal candidate",
          );
        final = await check(appRepair, revision);
        finishedBuild = final.evidence;
        return record(
          "terminalRepairFinal",
          "verify",
          [id, revision],
          final.public,
        );
      },
    },
    terminalRepairArtifact: {
      async read(id: string, revision: string) {
        chosen(id);
        if (!finishedBuild || finishedBuild.revision !== revision)
          throw new Error(
            "Read an artifact only from the exact independently verified candidate",
          );
        artifact = await readArtifact(finishedBuild);
        return record(
          "terminalRepairArtifact",
          "read",
          [id, revision],
          artifact,
        );
      },
    },
  };

  
  async function verify(raw: unknown,observations?: InvocationObservations) {
    const proof=await verifyNativeApplication(raw,observations);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["returnedTerminalRepair"],"rootPath":["explanation"],"producerSourceSuffix":"workOnTerminalApp/reviewTerminalCandidate.nl","producerPath":["reason"]}];
    const contributions=authored.filter(binding=>{
      let current:unknown=raw;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessTerminalRepairGoal(proof,proof.outcomeContract,raw,observations,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(raw: unknown, observations?: InvocationObservations) {
    const report = raw as {artifact:unknown;outcome:string;explanation:string}|null;
    const end = await independent.unitRepair.observe();
    const protectedAfter = await independent.unitRepair.readSource(
      end.revision,
      [manifestPath, testPath],
    );
    const actualSource = (
      await independent.unitRepair.readSource(end.revision, [entry])
    )[0]?.text;
    const endStatus = await status();
    const kept = world.mode === "repair" || world.mode === "already-ready";
    const rechecked = kept ? await check(independent, end.revision) : null;
    const independentArtifact = rechecked
      ? await readArtifact(rechecked.evidence)
      : null;
    const expectedPlan =
      world.mode === "repair" || world.mode === "hold-moved"
        ? "repair"
        : world.mode === "already-ready"
          ? "existing"
          : world.mode;
    const edits = journal.filter(
      (entry) => entry.service === "terminalRepairApply",
    );
    const checks = {
      returnedTerminalRepair: terminalRepairReturnIsBound(report,kept?artifact:null),
      exactOwnedTerminalSource:
        !!initial &&
        evidence.revision === initial.evidence.revision &&
        initial.public.observed.sources.some(
          (row) => row.path === entry && row.text === original.broken,
        ),
      authorizedRepairOrHold:
        (expectedPlan === "repair" ? edits.length===1&&!!applied : edits.length===0),
      exactNativeTestAndArtifact: kept
        ? Boolean(
            rechecked &&
            proven(rechecked.evidence) &&
            artifact &&
            isDeepStrictEqual(independentArtifact, artifact) &&
            final?.evidence.revision === end.revision &&
            final.evidence.tests?.receipt.artifactKey ===
              rechecked.evidence.tests?.receipt.artifactKey &&
            final.evidence.tests?.receipt.executionDigest ===
              rechecked.evidence.tests?.receipt.executionDigest,
          )
        : !artifact &&
          final === null,
      protectedOriginalTestAndMain:
        isDeepStrictEqual(protectedBefore, protectedAfter) &&
        before.mainEventId === endStatus.mainEventId &&
        (world.mode === "repair"
          ? applied?.status === "applied" &&
            end.revision === applied.revision &&
            actualSource !== original.broken
          : world.mode === "hold-moved"
            ? applied?.status === "moved" &&
              end.revision === movedRevision &&
              actualSource === movedSource
            : end.revision === evidence.revision &&
              actualSource === original.broken),
    };
    return {
      outcomeContract: {
        effects: {checks:["exactOwnedTerminalSource", "authorizedRepairOrHold", "exactNativeTestAndArtifact", "protectedOriginalTestAndMain"],rationale:"The actual terminal source, original native suite and bound artifact establish the repair."},
        returnedValue: {checks:["returnedTerminalRepair"],required:!kept,rationale:"A blocked repair explanation is requested; a receipt copy is optional once the app is repaired and verified."},
        incidentalValues: {checks:[],rationale:"A known incorrect emitted application value is excluded using the actual root definition."},
      },
      incorrectReturnValues:[],
      contextId,
      caseId: world.id,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      journal: structuredClone(journal),
      proof: {
        initial: evidence,
        final: rechecked?.evidence ?? null,
        artifact: independentArtifact,
        protectedDigest: stableSha256Hex(protectedAfter),
        currentRevision: end.revision,
        appStateId: repository.repositoryId,
      },
    };
  }

  async function qualify() {
    const cards = await services.terminalRepairCatalog.list();
    let rejectedAlias = false;
    try {
      await services.terminalRepairObserve.read(cards[1]!.id);
    } catch (error) {
      rejectedAlias =
        error instanceof Error && error.message.includes("currently owned");
    }
    const initial = await services.terminalRepairObserve.read(app.id);
    const repairing = world.mode === "repair" || world.mode === "hold-moved";
    const edits = repairing
      ? [{ path: entry, before: original.broken, after: original.repair }]
      : [];
    const effect = repairing
      ? await services.terminalRepairApply.edit(
          app.id,
          initial.observed.revision,
          edits,
        )
      : null;
    const kept = world.mode === "repair" || world.mode === "already-ready";
    const revision = effect?.revision ?? initial.observed.revision;
    const final = kept
      ? await services.terminalRepairFinal.verify(app.id, revision)
      : null;
    const artifact = kept
      ? await services.terminalRepairArtifact.read(app.id, revision)
      : null;
    const report = {artifact,outcome:world.mode === "repair" ? "verified" : world.mode,
      explanation:"Only the exact current candidate and its native evidence establish this disposition."};
    const verification = await verify(report);
    const wrong = await verify({ ...report, outcome: "invented" });
    const altered = await verify({
        ...report,
        artifact: artifact
          ? { ...artifact, buildKey: "other-artifact" }
          : { buildKey: "not-authorized" },
      });
    const rejectedAlteredEvidence =
      rejectedAlias && !wrong.outcomeDimensions.returnedValue.passed && !altered.outcomeDimensions.returnedValue.passed;
    return {
      ...verification,
      outcomeContract:{...verification.outcomeContract,effects:{...verification.outcomeContract.effects,checks:[...verification.outcomeContract.effects.checks,"rejectedAlteredEvidence"]}},
      passed: verification.passed && rejectedAlteredEvidence,
      checks: { ...verification.checks, rejectedAlteredEvidence },
      referenceReport: report,
    };
  }
  return { services, verify, qualify };
}
