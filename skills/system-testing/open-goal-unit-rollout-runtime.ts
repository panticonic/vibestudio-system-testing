import { sha256HexSyncText, compareUtf16CodeUnits } from "@vibestudio/content-addressing";
import { unitBuildReportSchema } from "@vibestudio/service-schemas/build";
import { expectedBuildUnitName } from "@vibestudio/workspace-contracts/sourceDirs";
import type { WorkspaceRuntime } from "@workspace/runtime/hosted";
import { createPanelRepair, createUnitRepair } from "@workspace/natlang-services";
import { verifyUnit } from "@workspace/harness/unit-verification";
import { panelRepairWorldSource } from "./panel-repair-world.js";
import { verifyPanelDraft } from "./panel-repair-oracle.js";
import type { OpenUnitRolloutWorld } from "./open-goal-unit-rollout-worlds.js";

type TestPorts = Pick<WorkspaceRuntime, "openPanel" | "rpc">;
export type RolloutPorts = TestPorts & Pick<WorkspaceRuntime, "vcs" | "blobstore"> & {
  contextId: string;
  build: { getBuildReport(source: string, ref: string): Promise<unknown> };
};
export type Revision = Awaited<ReturnType<WorkspaceRuntime["vcs"]["status"]>>["workingHead"];
export type RolloutPhase = <T>(phase: string, run: () => Promise<T>) => Promise<T>;
export type Edit = { path: string; before: string; after: string };
export type Build = { stateHash: string; status: "ok" | "failed" | "skipped"; diagnostics: string[] };
export type Check = {
  revision: string; build: Build;
  check: { runtime: "workerd" | "browser"; status: "passed" | "failed" | "unavailable"; count: number; receipt: string | null } | null;
};
export type OwnedUnit = {
  id: string; source: string; title: string; repositoryId: string; kind: "worker" | "panel";
  entry: string; files: Record<string, string>; mayEdit: boolean; mayRunChecks: boolean; mayCommit: boolean;
};
export type Engine = {
  observe: () => Promise<{ revision: string; build: Build }>;
  read: (revision: string, paths: string[]) => Promise<{ path: string; text: string }[]>;
  apply: (revision: string, edits: Edit[]) => Promise<{ revision: string }>;
  check: (revision: string) => Promise<Check>;
  close?: () => Promise<void>;
};

const hash = (value: unknown) => sha256HexSyncText(JSON.stringify(value));
const summarize = (report: ReturnType<typeof unitBuildReportSchema.parse>): Build => ({
  stateHash: report.stateHash, status: report.status,
  diagnostics: report.diagnostics.slice(0, 20).map(item => `${item.file}:${item.line}:${item.column} ${item.message.slice(0, 650)}`),
});
function withWorkerFetch(code: string) {
  return code + '\nexport default { fetch() { return new Response("Owned unit"); } };\n';
}

function workerFiles(source: string, world: OpenUnitRolloutWorld, alternate: boolean) {
  const title = alternate ? world.alternate : world.title;
  if (world.fixture.kind !== "worker" && !alternate) throw new Error("A panel cannot be seeded as worker code");
  const fixture = world.fixture;
  const sourceText = !alternate && fixture.kind === "worker" ? fixture.initial : 'export function status(): string { return "healthy"; }';
  const name = !alternate && fixture.kind === "worker" ? fixture.name : "status";
  const assertions = !alternate && fixture.kind === "worker" ? fixture.assertions : [["sees its own healthy state", 'expect(status()).toBe("healthy")']];
  return {
    "index.ts": withWorkerFetch(sourceText),
    "package.json": JSON.stringify({ name: expectedBuildUnitName(source), version: "0.0.0", private: true, type: "module",
      vibestudio: { title, kind: "worker", entry: "index.ts", authority: { requests: [], serviceRequests: [], provides: [] },
        tests: [{ name: "unit", runtime: "workerd", include: ["**/*.test.ts"] }] },
      dependencies: { "@workspace/test-runtime": "workspace:*", "@workspace/runtime": "workspace:*" },
    }, null, 2) + "\n",
    "index.test.ts": `import { describe, expect, it } from "@workspace/test-runtime";
import { rpc } from "@workspace/runtime";
import { ${name} } from "./index.js";
describe("retained unit contract", () => {
 it("executes in the injected workspace runtime", () => expect(typeof rpc.call).toBe("function"));
${assertions.map(([name, body]) => ` it(${JSON.stringify(name)}, () => { ${body}; });`).join("\n")}
});\n`,
  };
}

function panelFiles(source: string, world: OpenUnitRolloutWorld) {
  if (world.fixture.kind !== "panel") throw new Error("A worker cannot be seeded as panel code");
  return {
    "index.tsx": panelRepairWorldSource(world.fixture.fault),
    "package.json": JSON.stringify({ name: expectedBuildUnitName(source), version: "0.0.0", private: true, type: "module",
      vibestudio: { title: world.title, entry: "index.tsx", authority: { requests: [], serviceRequests: [], provides: [] },
        exposeModules: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"] },
      dependencies: { "@workspace/runtime": "workspace:*", react: "^19.0.0", "react-dom": "^19.0.0" },
    }, null, 2) + "\n",
  };
}

export function repairReference(world: OpenUnitRolloutWorld) {
  return world.fixture.kind === "panel" ? panelRepairWorldSource(null)
    : world.fixture.replacement ? withWorkerFetch(world.fixture.replacement) : null;
}

export async function seedRolloutUnits(
  ports: RolloutPorts, world: OpenUnitRolloutWorld, expectedWorkingHead: Revision, phase: RolloutPhase,
): Promise<OwnedUnit[]> {
  const { contextId, vcs } = ports;
  const basename = `open-repair-${crypto.randomUUID().slice(0, 12)}`;
  const candidates = [false, true].map(alternate => {
    const kind = alternate ? "worker" : world.fixture.kind;
    const source = `${kind === "worker" ? "workers" : "panels"}/${basename}${alternate ? "-reference" : ""}`;
    const files = kind === "worker" ? workerFiles(source, world, alternate) : panelFiles(source, world);
    return { source, files, title: alternate ? world.alternate : world.title, kind,
      entry: kind === "worker" ? "index.ts" : "index.tsx",
      mayEdit: !alternate && world.grant.edit, mayRunChecks: !alternate && world.grant.checks, mayCommit: !alternate && world.grant.commit } as const;
  }).sort((a, b) => compareUtf16CodeUnits(a.source, b.source));
  const repositories = await phase("fixture.blobs", () => Promise.all(candidates.map(async candidate => ({
    repoPath: candidate.source,
    files: await Promise.all(Object.entries(candidate.files).sort(([a], [b]) => compareUtf16CodeUnits(a, b))
      .map(async ([path, text]) => ({ path, contentHash: (await ports.blobstore.putText(text)).digest, mode: 0o644 }))),
  }))));
  const imported = await phase("fixture.import", () => vcs.importSnapshot({
    contextId, commandId: crypto.randomUUID(), expectedWorkingHead,
    intentSummary: "Create two disposable workspace rollout units", message: "Create two disposable workspace rollout units",
    source: { kind: "generated", uri: `system-test://open-unit-rollout/${basename}`, snapshotRevision: `fixture:${hash(repositories)}` }, repositories,
  }));
  const { workingHead } = await phase("fixture.import-readback", () => vcs.status({ contextId }));
  if (imported.importedRepositoryIds.length !== candidates.length || workingHead.kind !== "event" || workingHead.eventId !== imported.eventId)
    throw new Error("Scoped rollout units do not match their imported native state");
  return phase("fixture.resolve", () => Promise.all(candidates.map(async candidate => {
    const repository = await vcs.resolveRepository({ state: workingHead, repoPath: candidate.source });
    if (!repository || !imported.importedRepositoryIds.includes(repository.repositoryId))
      throw new Error("A disposable unit resolved outside the owned snapshot");
    return { ...candidate, id: crypto.randomUUID(), repositoryId: repository.repositoryId };
  })));
}

export async function readRepositorySource(ports: RolloutPorts, unit: OwnedUnit, state: Revision, path: string) {
  const file = await ports.vcs.readFile({ state, repositoryId: unit.repositoryId, file: { kind: "path", path } });
  if (!file || file.repositoryId !== unit.repositoryId || file.path !== path || file.content.kind !== "text")
    throw new Error(`Native rollout readback does not match the owned file: ${path}`);
  return { id: file.fileId, text: file.content.text };
}

function workerEngine(ports: RolloutPorts, unit: OwnedUnit): Engine {
  const service = createUnitRepair({ contextId: ports.contextId, unit: unit.source, suite: "unit",
    editablePaths: [`${unit.source}/${unit.entry}`], vcs: ports.vcs, build: ports.build,
    verifyTests: command => verifyUnit({ rpc: ports.rpc, openPanel: ports.openPanel,
      contextId: ports.contextId, operationPrefix: "open-unit-rollout" }, command),
  });
  let successfulBuild: { revision: string; build: Build } | undefined;
  const remember = (actual: Awaited<ReturnType<typeof service.unitRepair.observe>>) => {
    const observation = { revision: actual.revision, build: summarize(actual.build) };
    successfulBuild = observation.build.status === "ok" ? observation : undefined;
    return observation;
  };
  return {
    async observe() {
      successfulBuild = undefined;
      return remember(await service.unitRepair.observe());
    },
    read: service.unitRepair.readSource,
    async apply(revision, edits) {
      successfulBuild = undefined;
      return service.unitRepairEdit.apply(revision, edits);
    },
    async check(revision) {
      // test rechecks the working head and its native receipt must name the observed build hash.
      const { build } = successfulBuild?.revision === revision
        ? successfulBuild
        : remember(await service.unitRepairEdit.build(revision));
      if (build.status !== "ok") return { revision, build, check: null };
      const tested = await service.unitRepairEdit.test(revision);
      const evidence = tested.tests;
      if (!evidence || evidence.status === "compilation-failed")
        return { revision, build, check: { status: "unavailable", count: 0, runtime: "workerd", receipt: null } };
      const { report, receipt } = evidence;
      const status = evidence.status === "passed" && report.total > 0 && report.total === report.passed &&
        report.failed === 0 && evidence.truncatedFiles === 0 && evidence.truncatedErrors === 0 ? "passed"
        : evidence.status === "failed" && report.failed > 0 ? "failed" : "unavailable";
      return { revision, build, check: { status, count: report.total, runtime: "workerd",
        receipt: receipt.artifactKey && receipt.executionDigest ? hash(receipt) : null } };
    },
  };
}

function panelEngine(ports: RolloutPorts, unit: OwnedUnit): Engine {
  const { contextId, openPanel, vcs, build } = ports;
  let handle: Awaited<ReturnType<typeof openPanel>> | null = null;
  const panel = async () => handle ??= await openPanel(unit.source, { contextId, ref: `ctx:${contextId}`, focus: false, parentId: null });
  const scopes = async () => createPanelRepair({ contextId, panelSource: unit.source, panel: await panel(), vcs, build });
  async function observe() {
    const before = JSON.stringify((await vcs.status({ contextId })).workingHead);
    const report = unitBuildReportSchema.parse(await build.getBuildReport(unit.source, `ctx:${contextId}`));
    const after = JSON.stringify((await vcs.status({ contextId })).workingHead);
    if (before !== after || report.repoPath !== unit.source) throw new Error("Panel build evidence became stale or foreign");
    return { revision: after, build: summarize(report) };
  }
  return {
    observe,
    async read(revision, paths) { return (await scopes()).readSource(revision, paths); },
    async apply(revision, edits) { return (await scopes()).apply(revision, edits); },
    async check(revision) {
      const receipt = await observe();
      if (receipt.revision !== revision) throw new Error("Panel verification has a newer source revision");
      if (receipt.build.status !== "ok") return { revision, build: receipt.build, check: null };
      const native = await scopes();
      const built = await native.build(revision);
      if (!built.passed) return { revision, build: receipt.build, check: { status: "unavailable", count: 0, runtime: "browser", receipt: null } };
      const activated = await native.rebuild(revision);
      if (activated.revision !== revision || activated.phase !== "ready")
        return { revision, build: receipt.build, check: { status: "unavailable", count: 0, runtime: "browser", receipt: null } };
      const report = await verifyPanelDraft(await panel());
      if (JSON.stringify((await vcs.status({ contextId })).workingHead) !== revision)
        throw new Error("Renderer evidence crossed a later workspace revision");
      return { revision, build: receipt.build, check: { status: report.passed ? "passed" : "failed",
        count: Object.keys(report.checks).length, runtime: "browser", receipt: hash({ generation: activated.generation, ...report }) } };
    },
    async close() { if (handle) await handle.archive(); },
  };
}

export function createRolloutEngine(ports: RolloutPorts, unit: OwnedUnit): Engine {
  return unit.kind === "worker" ? workerEngine(ports, unit) : panelEngine(ports, unit);
}
