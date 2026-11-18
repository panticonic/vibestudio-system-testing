import type { VcsClient } from "@workspace/runtime";
import type { WorkspaceRepoFixturePort } from "./workspace-repo-fixture.js";
import type { IntegrationOracleFixture } from "./vcs-integration-oracle.js";

type FixtureClient = Pick<VcsClient, "status" | "edit" | "commit" | "merge" | "resolveRepository" | "readFile" | "compare">;
/** Owned real semantic contexts; existing fixture lifecycle authority, without pushing fixture source to main. */
export async function prepareWorkspaceIntegration(port: Pick<WorkspaceRepoFixturePort, "createContext" | "destroyContext"> & { vcs: FixtureClient }, seed: string, values: { theme: string; locale: string } = { theme: "dark", locale: "es" }) {
  const contexts: string[] = [];
  const cleanup = async () => {
    const results = await Promise.allSettled(contexts.map((id) => port.destroyContext(id)));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Integration fixture context cleanup failed");
  };
  try {
    const target = await port.createContext(); contexts.push(target.contextId);
    const initial = await port.vcs.status({ contextId: target.contextId });
    if (!initial.clean || initial.mainRelation !== "at") throw new Error("Integration fixture requires an owned clean context at main");
    const suffix = seed.replace(/[^a-z0-9]/giu, "").toLowerCase();
    if (!suffix) throw new Error("Supply a nonempty fixture seed");
    const repoPath = `projects/integration-${suffix}-${crypto.randomUUID()}`;
    const path = "settings.json";
    const theme = `theme_${suffix}`; const locale = `locale_${suffix}`; const preserved = `keep_${suffix}`;
    const baseline = { [theme]: "light", [locale]: "en", [preserved]: `preserved-${seed}` };
    const text = JSON.stringify(baseline) + "\n";
    const created = await port.vcs.edit({ contextId: target.contextId, commandId: crypto.randomUUID(), expectedWorkingHead: initial.workingHead,
      intentSummary: "Create isolated settings for an integration exercise", changes: [{ kind: "repository-create", repoPath, files: [{ path, content: { kind: "text", text }, mode: 0o644 }] }] });
    const committed = await port.vcs.commit({ contextId: target.contextId, commandId: crypto.randomUUID(), expectedWorkingHead: created.workingHead, message: "Local integration exercise baseline" });
    const repository = await port.vcs.resolveRepository({ state: committed.event, repoPath });
    if (!repository) throw new Error("Created repository absent from local baseline");
    const file = await port.vcs.readFile({ state: committed.event, repositoryId: repository.repositoryId, file: { kind: "path", path } });
    if (!file || file.content.kind !== "text") throw new Error("Created fixture file missing");
    const sourceContext = await port.createContext(); contexts.push(sourceContext.contextId);
    const sourceInitial = await port.vcs.status({ contextId: sourceContext.contextId });
    if (!sourceInitial.clean || sourceInitial.mainRelation !== "at" || sourceInitial.mainEventId !== initial.mainEventId) throw new Error("Protected main changed during fixture setup");
    const based = await port.vcs.merge({ contextId: sourceContext.contextId, commandId: crypto.randomUUID(), expectedWorkingHead: sourceInitial.workingHead, source: committed.event });
    await port.vcs.commit({ contextId: sourceContext.contextId, commandId: crypto.randomUUID(), expectedWorkingHead: based.workingHead, message: "Adopt local fixture baseline" });
    const write = async (contextId: string, value: Record<string, unknown>, intentSummary: string) => {
      const status = await port.vcs.status({ contextId });
      return port.vcs.edit({ contextId, commandId: crypto.randomUUID(), expectedWorkingHead: status.workingHead, intentSummary,
        changes: [{ kind: "text-edit", repositoryId: repository.repositoryId, fileId: file.fileId, edits: [{ start: 0, end: text.length, text: JSON.stringify(value) + "\n" }] }] });
    };
    const incoming = await write(sourceContext.contextId, { ...baseline, [locale]: values.locale }, `Change ${locale} to ${JSON.stringify(values.locale)}; preserve the other settings`);
    const sourceCommit = await port.vcs.commit({ contextId: sourceContext.contextId, commandId: crypto.randomUUID(), expectedWorkingHead: incoming.workingHead, message: `Use ${JSON.stringify(values.locale)} for ${locale}` });
    await write(target.contextId, { ...baseline, [theme]: values.theme }, `Change ${theme} to ${JSON.stringify(values.theme)}; preserve the other settings`);
    const targetStatus = await port.vcs.status({ contextId: target.contextId });
    const comparison = await port.vcs.compare({ target: targetStatus.workingHead, source: sourceCommit.event });
    if (!comparison.coordinates.some((item) => item.coordinate.kind === "file" && item.coordinate.id === file.fileId && item.status === "conflict")) throw new Error("Fixture did not produce the declared real file conflict");
    const fixture: IntegrationOracleFixture = { contextId: target.contextId, source: sourceCommit.event, repositoryId: repository.repositoryId,
      fileId: file.fileId, path, commonSeedEvent: committed.event, sourceChangeIds: comparison.coordinates.filter((item) => item.coordinate.kind === "file" && item.coordinate.id === file.fileId).flatMap((item) => item.attribution.theirs.map((change) => change.changeId)), mainEventId: initial.mainEventId, baseline, required: { [theme]: values.theme, [locale]: values.locale } };
    return { fixture, initialComparison: comparison, repoPath, files: [{ repositoryId: repository.repositoryId, path, workspacePath: `${repoPath}/${path}` }],
      request: { goal: "Integrate the assigned incoming source, preserving the independently requested local and incoming changes and all untouched settings. Do not publish." }, cleanup };
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Fixture setup and cleanup failed"); }
    throw error;
  }
}
