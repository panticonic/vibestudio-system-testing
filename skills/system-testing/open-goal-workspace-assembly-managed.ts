import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { isDeepStrictEqual } from "node:util";
import { compareUtf16CodeUnits, sha256HexSyncText, stableSha256Hex } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { RuntimeFs, VcsClient, rpc as RuntimeRpc } from "@workspace/runtime";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { AssemblyBuildReceipt, AssemblyHandoff, AssemblyInventory, AssemblyPlan, AssemblyReport, AssemblyRevision, AssemblyUnit, UnitSource } from "@workspace-skills/open-workspace-assembly/types";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { openAssemblyWorlds, type UnitSpec } from "./open-goal-workspace-assembly-worlds.js";

type Ports = {
  contextId: string;
  fs: RuntimeFs;
  vcs: Pick<VcsClient, "status" | "importSnapshot">;
  rpc: Pick<typeof RuntimeRpc, "call">;
};
type SourcePackage = { unit: AssemblyUnit; files: Record<string, string> };
const maxArtifact = 32 * 1024;
const maxFile = 4096;
const encode = new TextEncoder();
const normalizeHash = (hash: string | null | undefined) => hash?.replace(/^state:/u, "");
const sorted = (values: string[]) => [...values].sort(compareUtf16CodeUnits);
const contentKeys = (files: Record<string, string>) => Object.fromEntries(Object.entries(files)
  .map(([path, text]) => [path, sha256HexSyncText(text)]));

function buildScaffold(spec: UnitSpec, namespace: string): SourcePackage {
  const packageName = (id: string) => `@workspace/assembly-${namespace}-${id}`;
  const categories = { runtime: "dependencies", test: "devDependencies", dev: "devDependencies",
    optional: "optionalDependencies", peer: "peerDependencies" } as const;
  const manifest = {
    name: packageName(spec.id), version: "0.1.0", private: true, type: "module",
    exports: Object.fromEntries([[".", "./src/index.ts"], ...(spec.exports ?? []).map(path => [`./${path}`,`./src/${path}.ts`])]),
    ...(Object.fromEntries([...new Set(spec.edges.map(edge => edge.declaration ?? (edge.mode === "test" ? "dev" : "runtime")))]
      .filter(bucket => bucket !== "none").map(bucket => [categories[bucket as keyof typeof categories],
        Object.fromEntries(spec.edges.filter(edge => (edge.declaration ?? (edge.mode === "test" ? "dev" : "runtime")) === bucket)
          .map(edge => [packageName(edge.unit), "workspace:*"]))]))),
  };
  const files: SourcePackage["files"] = {
    "package.json": JSON.stringify(manifest, null, 2) + "\n",
    "README.md": `# ${spec.label}\n\n${spec.purpose}\n`,
    "src/index.ts": "export { marker } from './markers.js';\nexport type { Value } from './markers.js';\n",
    "src/markers.ts": "export type Value = { marker: string };\n",
  };
  const runtime: string[] = [];
  const types: string[] = [];
  const tests: string[] = [];
  for (const [index, edge] of spec.edges.entries()) {
    const source = packageName(edge.unit) + (edge.subpath ? "/" + edge.subpath : "");
    if (edge.mode === "type") {
      files["src/markers.ts"] += `import type { Value as Dependency${index} } from "${source}";\n`;
      types.push(`Dependency${index}`);
    } else if (edge.mode === "runtime") {
      files["src/markers.ts"] += `import { marker as dependency${index} } from "${source}";\n`;
      runtime.push(`dependency${index}`);
    } else {
      tests.push(`import { marker as tested${index} } from "${source}";\nexport const observed${index} = tested${index};`);
    }
  }
  files["src/markers.ts"] += types.length ? `export type SourceInput = ${types.join(" & ")};\n` : "";
  files["src/markers.ts"] += spec.broken ? "export const marker: string = 17;\n" :
    `export const marker: string = [${[JSON.stringify(spec.id), ...runtime].join(", ")}].join(":");\n`;
  if (tests.length) files["tests/scenario.ts"] = tests.join("\n") + "\n";
  for (const subpath of spec.exports ?? []) files[`src/${subpath}.ts`] = "export { marker } from './markers.js';\n";
  return { unit: { id: spec.id, label: spec.label, role: spec.purpose, repoPath: `packages/assembly-${namespace}-${spec.id}`, packageName: manifest.name }, files };
}

export async function prepareOpenWorkspaceAssembly(input: { contextId: string; caseId: string }, ports: Ports) {
  const candidate = openAssemblyWorlds.find(row => row.id === input.caseId);
  if (!candidate || ports.contextId !== input.contextId) throw new Error("Unknown owned workspace assembly");
  const world = candidate;
  const { rpc, fs, vcs } = ports;
  const namespace = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const from = await vcs.status();
  const source = new Map(world.units.map(item => [item.id, buildScaffold(item, namespace)]));
  const repositoryIds = new Map<string, string>();

  async function importUnits(units: SourcePackage[], workingHead: AssemblyRevision, label: string): Promise<AssemblyRevision> {
    const repositories = await Promise.all(units.map(async ({ unit, files }) => ({
      repoPath: unit.repoPath,
      ...(repositoryIds.has(unit.id) ? { repositoryId: repositoryIds.get(unit.id)! } : {}),
      files: await Promise.all(Object.entries(files).sort(([a], [b]) => compareUtf16CodeUnits(a, b)).map(async ([path, text]) => {
        const result = await rpc.call("main", mainRpcMethods["blobstore.putText"], [text]);
        if (result.digest !== sha256HexSyncText(text)) throw new Error("The fixture blob changed source bytes");
        return { path, mode: 0o644, contentHash: result.digest };
      })),
    })));
    repositories.sort((left, right) => compareUtf16CodeUnits(left.repoPath, right.repoPath));
    const result = await vcs.importSnapshot({
      contextId: input.contextId, commandId: `assembly-${namespace}-${label}`, expectedWorkingHead: workingHead,
      intentSummary: "Prepare owned package planning evidence",
      source: { kind: "generated", uri: `system-test://open-workspace-assembly/${namespace}`, snapshotRevision: stableSha256Hex(repositories) },
      repositories, message: "Prepare isolated workspace assembly units",
    });
    const state = { kind: "event", eventId: result.eventId } as const;
    if (result.importedRepositoryIds.length !== units.length) throw new Error("Incomplete owned package registration");
    for (const { unit } of units) {
      const native = await resolve(unit.repoPath, state);
      if (!native || !result.importedRepositoryIds.includes(native.repositoryId) ||
          (repositoryIds.has(unit.id) && repositoryIds.get(unit.id) !== native.repositoryId))
        throw new Error("The assembly fixture lost its registered source");
      repositoryIds.set(unit.id, native.repositoryId);
    }
    return state;
  }
  const reviewed = await importUnits([...source.values()], from.workingHead, "reviewed");
  let head = reviewed;
  if (world.later?.length) {
    const recent = world.later.map(item => buildScaffold(item, namespace));
    head = await importUnits(recent, reviewed, "current");
    for (const record of recent) source.set(record.unit.id, record);
  }
  const baseline = await vcs.status();
  if (baseline.mainEventId !== from.mainEventId || !isDeepStrictEqual(baseline.workingHead, head))
    throw new Error("Assembly must seed only its own context");
  const dir = await fs.mkdtemp("assembly-brief");
  const notePath = `${dir}/brief.md`;
  await fs.writeFile(notePath, world.note);
  const readNote = async () => new TextDecoder("utf-8", { fatal: true }).decode(await readWorkspaceBytes(rpc, notePath, maxFile));
  const priorHandoffs = new Set(await listOwnedScratchEntries(fs));
  const handoff = bindScratchHandoff(fs, { goal: world.goal, questions: ["Which owned source and build evidence supports the local assembly?"],
    sources: [{ id: "assembly-brief", path: notePath }] }, (path, max) => readWorkspaceBytes(rpc, path, max)).scratchHandoffWrite;

  const read = new Map<string, UnitSource>();
  const established = new Map<string, AssemblyBuildReceipt>();
  let observed: AssemblyInventory | null = null;
  let staged: AssemblyHandoff | null = null;
  let durableText: string | null = null;
  let building = false;
  let writeStarted = false;
  let readCalls = 0;
  const buildScope = new Set(world.grantedBuilds ?? []);
  type NativeBuild = { report: Awaited<ReturnType<typeof buildReport>>; metadata: Awaited<ReturnType<typeof buildMetadata>>[] };
  const nativeBuilds = new Map<string, NativeBuild>();
  function resolve(repoPath: string, state: AssemblyRevision) {
    return rpc.call("main", mainRpcMethods["vcs.resolveRepository"], [{ repoPath, state }]);
  }
  function buildReport(repoPath: string) {
    return rpc.call("main", mainRpcMethods["build.getBuildReport"], [repoPath, `ctx:${input.contextId}`, { priority: "background" }]);
  }
  function buildMetadata(key: string) {
    return rpc.call("main", mainRpcMethods["build.getBuildMetadata"], [key, {}]);
  }
  async function sameHead() {
    const now = await vcs.status();
    return now.mainEventId === baseline.mainEventId && isDeepStrictEqual(now.workingHead, head);
  }
  async function readNative(unit: AssemblyUnit): Promise<UnitSource | null> {
    const repository = await resolve(unit.repoPath, head);
    if (!repository || repository.repositoryId !== repositoryIds.get(unit.id) ||
        !isDeepStrictEqual(repository.state, head) || repository.repoPath !== unit.repoPath) return null;
    const listed = await rpc.call("main", mainRpcMethods["vcs.listFiles"], [{
      state: head, repositoryId: repository.repositoryId, limit: 12,
    }]);
    if (!listed || listed.nextCursor || listed.repositoryId !== repository.repositoryId || !isDeepStrictEqual(listed.state, head)) return null;
    const files = await Promise.all(listed.files.map(async indexed => {
      const actual = await rpc.call("main", mainRpcMethods["vcs.readFile"], [{
        state: head, repositoryId: repository.repositoryId, file: { kind: "id", fileId: indexed.fileId },
      }]);
      if (!actual || actual.repositoryId !== repository.repositoryId || actual.fileId !== indexed.fileId ||
          actual.path !== indexed.path || actual.contentHash !== indexed.contentHash || actual.content.kind !== "text" ||
          encode.encode(actual.content.text).length > maxFile || sha256HexSyncText(actual.content.text) !== indexed.contentHash) return null;
      return { path: actual.path, text: actual.content.text, contentHash: actual.contentHash };
    }));
    const manifest = files.find(file => file?.path === "package.json");
    if (!manifest || files.some(file => file === null) || JSON.parse(manifest.text)?.name !== unit.packageName) return null;
    return { unit, head, files: files.filter(file => file !== null).sort((a, b) => compareUtf16CodeUnits(a.path, b.path)), manifestSha: manifest.contentHash };
  }
  function bindReport(unit: string, report: NativeBuild["report"], metadata: NativeBuild["metadata"]): AssemblyBuildReceipt {
    const keys = sorted([...new Set(report.builds.flatMap(record => record.buildKey ? [record.buildKey] : []))]);
    const retained = keys.length > 0 && keys.length === metadata.length && metadata.every((item, index) =>
      !!item && item.buildKey === keys[index] && normalizeHash(item.sourceStateHash) === normalizeHash(report.stateHash) &&
      (!item.sourceState || isDeepStrictEqual(item.sourceState, head)));
    const diagnosticCodes = report.diagnostics.map(item => `${item.source}:${item.compilerCode ?? item.severity}`);
    return { unit, head, stateHash: report.stateHash, buildKeys: keys, diagnosticCodes, result: report.status,
      cached: retained, sha256: stableSha256Hex({ report, metadata }) };
  }

  function draftManifests(plan: AssemblyPlan) {
    const drafts = new Map<string, { path: string; before: string; manifest: Record<string, unknown> }>();
    for (const change of plan.dependencies.amendment) {
      if (!plan.dependencies.included.includes(change.unit) || !plan.dependencies.included.includes(change.dependency) ||
          !["add-runtime", "remove-runtime"].includes(change.action)) return null;
      const owner = read.get(change.unit);
      const dependency = read.get(change.dependency);
      const sourceFile = owner?.files.find(file => file.path === "package.json");
      if (!owner || !dependency || !sourceFile) return null;
      const draft = drafts.get(change.unit) ?? { path: `${owner.unit.repoPath}/package.json`,
        before: sourceFile.contentHash, manifest: JSON.parse(sourceFile.text) as Record<string, unknown> };
      const dependencies = { ...draft.manifest["dependencies"] as Record<string, string> | undefined };
      if (change.action === "add-runtime") dependencies[dependency.unit.packageName] = "workspace:*";
      else delete dependencies[dependency.unit.packageName];
      draft.manifest["dependencies"] = dependencies;
      drafts.set(change.unit, draft);
    }
    return [...drafts.values()].map(({ path, before, manifest }) => {
      const text = JSON.stringify(manifest, null, 2) + "\n";
      return { path, before, text, sha256: sha256HexSyncText(text) };
    });
  }
  function stagedContents(plan: AssemblyPlan) {
    const drafts = draftManifests(plan);
    if (drafts === null) return null;
    return JSON.stringify({ schema: "vibestudio.workspace-assembly/1", contextId: input.contextId,
      head, goal: world.goal, plan, drafts,
      manifest: plan.dependencies.included.map(id => {
        const input = read.get(id)!;
        return { sourceUnit: input.unit.repoPath, packageName: input.unit.packageName, manifestSha: input.manifestSha,
          sourceFiles: Object.fromEntries(input.files.map(file => [file.path, file.contentHash])) };
      }),
    });
  }
  const services = {
    assemblyInventory: {
      async observe() {
        if (!await sameHead()) throw new Error("Read the owned assembly inventory at its current semantic head");
        if (observed) return structuredClone(observed);
        observed = { head, reviewed, units: [...source.values()].map(item => item.unit),
          allowedBuilds: [...buildScope], mayStage: world.mayStage === true, note: await readNote() };
        return structuredClone(observed);
      },
    },
    assemblySource: {
      async read(id: string, state: AssemblyRevision) {
        const owned = source.get(id);
        if (!observed || !owned || !isDeepStrictEqual(state, head) || ++readCalls > 10 || !await sameHead()) return null;
        const exact = await readNative(owned.unit);
        if (exact) read.set(id, exact);
        return structuredClone(exact);
      },
    },
    assemblyBuild: {
      async verify(id: string, state: AssemblyRevision) {
        const unit = read.get(id)?.unit;
        if (!unit || !buildScope.has(id) || !isDeepStrictEqual(state, head) || established.has(id) || building) return null;
        building = true;
        try {
          if (!await sameHead()) return null;
          const report = await buildReport(unit.repoPath);
          if (report.repoPath !== unit.repoPath || !await sameHead()) return null;
          const keys = sorted([...new Set(report.builds.flatMap(target => target.buildKey ? [target.buildKey] : []))]);
          const metadata = await Promise.all(keys.map(buildMetadata));
          if (!await sameHead()) return null;
          const receipt = bindReport(id, report, metadata);
          established.set(id, receipt);
          nativeBuilds.set(id, { report, metadata });
          return structuredClone(receipt);
        } finally { building = false; }
      },
    },
    assemblyDraft: {
      async stage(plan: AssemblyPlan) {
        if (!observed?.mayStage || staged || writeStarted || building || !validShape(plan) ||
            !["ready", "draft-repair"].includes(plan.disposition) || !isDeepStrictEqual(plan.head, head) ||
            !isDeepStrictEqual(plan.builds, [...established.values()]) || plan.dependencies.included.some(id => !read.has(id)) ||
            (plan.disposition === "ready" && (plan.dependencies.blockers.length > 0 ||
              plan.builds.some(result => result.result !== "ok" || !result.cached)))) return null;
        writeStarted = true;
        try {
          if (!await sameHead() || observed.note !== await readNote()) return null;
          const refreshed = await Promise.all(plan.dependencies.included.map(id => readNative(read.get(id)!.unit)));
          if (!refreshed.every((item, index) => isDeepStrictEqual(item, read.get(plan.dependencies.included[index]!))) || !await sameHead()) return null;
          const text = stagedContents(plan);
          if (text === null || encode.encode(text).length > maxArtifact) return null;
          const receipt = await handoff.stage(text);
          if (!receipt) return null;
          durableText = text;
          staged = { ...receipt, sha256: sha256HexSyncText(text) };
          return structuredClone(staged);
        } finally { writeStarted = false; }
      },
    },
  };

  async function proof(outcome: AssemblyReport | null, negative: boolean) {
    const expected = world.expected;
    const plan = outcome?.plan;
    const valid = validShape(plan);
    const reread = await Promise.all([...source.values()].map(async item => {
      const exact = await readNative(item.unit);
      return exact && isDeepStrictEqual(contentKeys(item.files), Object.fromEntries(exact.files.map(file => [file.path,file.contentHash]))) &&
        (!read.has(item.unit.id) || isDeepStrictEqual(read.get(item.unit.id), exact));
    }));
    const retainedBuilds = await Promise.all([...nativeBuilds.entries()].map(async ([id, { report, metadata }]) => {
      const receipt = established.get(id)!;
      const fresh = await Promise.all(receipt.buildKeys.map(buildMetadata));
      return isDeepStrictEqual(metadata, fresh) && isDeepStrictEqual(bindReport(id, report, fresh), receipt);
    }));
    const newHandoffs = (await listOwnedScratchEntries(fs)).filter(name => name.startsWith("evidence-handoff-") && !priorHandoffs.has(name));
    const draftPath = staged?.path;
    const durableBytes = draftPath ? await readWorkspaceBytes(rpc, draftPath, maxArtifact) : null;
    const recoveredDrafts = durableBytes ? JSON.parse(new TextDecoder().decode(durableBytes))?.drafts : [];
    const wantedChanges = new Map<string, Record<string, string>>();
    for (const amendment of expected.amendment) {
      const owner = source.get(amendment.unit)!;
      const dependency = source.get(amendment.dependency)!;
      const current = JSON.parse(owner.files["package.json"]!);
      const revised = wantedChanges.get(owner.unit.repoPath) ?? { ...current.dependencies };
      if (amendment.action === "add-runtime") revised[dependency.unit.packageName] = "workspace:*";
      else delete revised[dependency.unit.packageName];
      wantedChanges.set(owner.unit.repoPath, revised);
    }
    const checkedDrafts = Array.isArray(recoveredDrafts) && recoveredDrafts.length === wantedChanges.size &&
      [...wantedChanges.entries()].every(([path, dependencies]) => {
        const retained = recoveredDrafts.find(row => row.path === `${path}/package.json`);
        const original = [...source.values()].find(row => row.unit.repoPath === path)?.files["package.json"];
        if (!retained || !original || retained.before !== sha256HexSyncText(original) ||
            typeof retained.text !== "string" || retained.sha256 !== sha256HexSyncText(retained.text)) return false;
        const baseline = JSON.parse(original);
        baseline.dependencies = dependencies;
        return isDeepStrictEqual(JSON.parse(retained.text), baseline);
      });
    const checks = {
      observedExactAssemblyScope: !!observed && observed.note === world.note && expected.read.every(id => read.has(id)) &&
        valid && isDeepStrictEqual(plan.head, head) && plan.root === expected.root,
      verifiedNativePackageSources: reread.every(value => value === true),
      exactDependencyDecision: valid && isDeepStrictEqual(sorted(plan.dependencies.included), sorted(expected.include)) &&
        (plan.dependencies.included[0] ?? null) === expected.root &&
        isDeepStrictEqual(sorted(plan.dependencies.blockers), sorted(expected.blockers)) &&
        isDeepStrictEqual(plan.dependencies.amendment, expected.amendment),
      verifiedPinnedBuildReadback: valid && isDeepStrictEqual(plan.builds, [...established.values()]) && retainedBuilds.every(Boolean) &&
        isDeepStrictEqual(plan.builds.map(item => ({ unit: item.unit, result: item.result })), expected.builds) &&
        plan.builds.every(item => item.result === "ok" ? item.cached && item.buildKeys.length > 0 : item.diagnosticCodes.length > 0),
      groundedRolloutDisposition: valid && plan.disposition === expected.disposition && expected.claims.every(rule => rule.test(plan.rationale)),
      verifiedLocalDraft: expected.stage ? valid && checkedDrafts && !!staged && !!durableBytes && typeof durableText === "string" &&
        newHandoffs.length === 1 && staged.path === `/.tmp/${newHandoffs[0]}/handoff.json` &&
        isDeepStrictEqual(outcome?.handoff, staged) && durableBytes.length === staged.bytes &&
        new TextDecoder().decode(durableBytes) === stagedContents(plan) && sha256HexSyncText(durableText) === staged.sha256 :
        staged === null && outcome?.handoff === null && newHandoffs.length === 0,
      protectedManagedHeads: await sameHead() && (await readNote()) === world.note,
      rejectedUnownedAssembly: negative,
    };
    return { contextId: input.contextId, caseId: input.caseId, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      observed, reads: [...read.values()], buildReceipts: [...established.values()], handoff: staged, durableText };
  }
  async function negatives() {
    const forged = { kind: "event", eventId: `unrelated-${namespace}` } as const;
    const first = source.keys().next().value!;
    return await services.assemblySource.read("other-package", head) === null &&
      await services.assemblySource.read(first, forged) === null &&
      await services.assemblyBuild.verify(first, forged) === null &&
      await services.assemblyDraft.stage({ disposition: "hold" } as AssemblyPlan) === null;
  }
  async function verify(raw: unknown) {
    const report = raw as { status?: string; skill?: string; outcome?: AssemblyReport } | null;
    return proof(report?.status === "workspace-skill-reviewed" && report.skill === "workspaceAssembly" ? report.outcome ?? null : null, await negatives());
  }
  async function qualify() {
    const state = await services.assemblyInventory.observe();
    for (const id of world.expected.read) {
      if (!await services.assemblySource.read(id, state.head)) throw new Error("Missing native package evidence: " + id);
    }
    for (const { unit } of world.expected.builds) {
      if (!await services.assemblyBuild.verify(unit, state.head)) throw new Error("Missing native pinned build: " + unit);
    }
    const plan: AssemblyPlan = { root: world.expected.root, head: state.head, disposition: world.expected.disposition,
      dependencies: { included: world.expected.include, amendment: world.expected.amendment, blockers: world.expected.blockers },
      builds: [...established.values()], rationale: world.expected.explanation };
    const receipt = world.expected.stage ? await services.assemblyDraft.stage(plan) : null;
    const negative = await negatives();
    const result = await proof({ plan, handoff: receipt }, negative);
    const changed = await proof({ plan: { ...plan, head: { kind: "event", eventId: "unrelated" } }, handoff: receipt }, negative);
    return { ...result, passed: result.passed && !changed.passed };
  }
  return { goal: world.goal, services, verify, qualify };
}

function validShape(plan: AssemblyPlan | undefined): plan is AssemblyPlan {
  return !!plan && !!plan.dependencies && Array.isArray(plan.dependencies.included) && plan.dependencies.included.length <= 8 &&
    Array.isArray(plan.dependencies.amendment) && plan.dependencies.amendment.length <= 8 && Array.isArray(plan.dependencies.blockers) &&
    typeof plan.rationale === "string" && encode.encode(plan.rationale).length <= 640 && Array.isArray(plan.builds);
}
