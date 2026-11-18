import type { VcsClient } from "@workspace/runtime";
import type { WorkspaceRepoFixturePort } from "./workspace-repo-fixture.js";
import {
  expectedIntegratedFile,
  workspaceIntegrationSeeds,
} from "./vcs-integration-worlds.js";
import type { IntegrationOracleFixture } from "./vcs-integration-oracle.js";

type FixtureClient = Pick<
  VcsClient,
  | "status"
  | "edit"
  | "commit"
  | "merge"
  | "resolveRepository"
  | "readFile"
  | "compare"
>;
/** Owned real semantic contexts; existing fixture lifecycle authority, without pushing fixture source to main. */
export async function prepareWorkspaceIntegration(
  port: Pick<WorkspaceRepoFixturePort, "createContext" | "destroyContext"> & {
    vcs: FixtureClient;
    createSourceContext(
      parentContextId: string,
    ): Promise<{ contextId: string; ownerEntityId: string }>;
  },
  seed: string,
  worldId: string,
) {
  const contexts: string[] = [];
  const cleanup = async () => {
    const results = await Promise.allSettled(
      contexts.map((id) => port.destroyContext(id)),
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        "Integration fixture context cleanup failed",
      );
  };
  try {
    const target = await port.createContext();
    contexts.push(target.contextId);
    const initial = await port.vcs.status({ contextId: target.contextId });
    if (!initial.clean || initial.mainRelation !== "at")
      throw new Error(
        "Integration fixture requires an owned clean context at main",
      );
    const suffix = seed.replace(/[^a-z0-9]/giu, "").toLowerCase();
    if (!suffix) throw new Error("Supply a nonempty fixture seed");
    const repoPath = `projects/integration-${suffix}-${crypto.randomUUID()}`;
    const seeds = workspaceIntegrationSeeds(worldId, seed).map((file) => ({
      ...file,
      text: JSON.stringify(file.baseline) + "\n",
    }));
    const created = await port.vcs.edit({
      contextId: target.contextId,
      commandId: crypto.randomUUID(),
      expectedWorkingHead: initial.workingHead,
      intentSummary: "Create isolated settings for an integration exercise",
      changes: [
        {
          kind: "repository-create",
          repoPath,
          files: seeds.map(({ path, text }) => ({
            path,
            content: { kind: "text" as const, text },
            mode: 0o644,
          })),
        },
      ],
    });
    const committed = await port.vcs.commit({
      contextId: target.contextId,
      commandId: crypto.randomUUID(),
      expectedWorkingHead: created.workingHead,
      message: "Local integration exercise baseline",
    });
    const repository = await port.vcs.resolveRepository({
      state: committed.event,
      repoPath,
    });
    if (!repository)
      throw new Error("Created repository absent from local baseline");
    const files = await Promise.all(
      seeds.map(async (seed) => {
        const file = await port.vcs.readFile({
          state: committed.event,
          repositoryId: repository.repositoryId,
          file: { kind: "path", path: seed.path },
        });
        if (!file || file.content.kind !== "text")
          throw new Error(`Created fixture file missing: ${seed.path}`);
        return { ...seed, fileId: file.fileId };
      }),
    );
    // A legitimate owned child exposes this incoming event to the target caller's
    // existing reachable-context graph; the independent harness's access is insufficient.
    const sourceContext = await port.createSourceContext(target.contextId);
    // Child cleanup belongs to the target's recursive lifecycle teardown.
    const sourceInitial = await port.vcs.status({
      contextId: sourceContext.contextId,
    });
    if (
      !sourceInitial.clean ||
      sourceInitial.committed.eventId !== committed.event.eventId ||
      sourceInitial.mainEventId !== initial.mainEventId
    )
      throw new Error(
        "Source child did not fork the exact committed fixture baseline",
      );
    const write = async (contextId: string, side: "local" | "incoming") => {
      const status = await port.vcs.status({ contextId });
      const intentSummary = files
        .map((file) => `${file.path}: set ${JSON.stringify(file[side])}`)
        .join("; ");
      return port.vcs.edit({
        contextId,
        commandId: crypto.randomUUID(),
        expectedWorkingHead: status.workingHead,
        intentSummary,
        changes: files.map((file) => ({
          kind: "text-edit" as const,
          repositoryId: repository.repositoryId,
          fileId: file.fileId,
          edits: [
            {
              start: 0,
              end: file.text.length,
              text: JSON.stringify({ ...file.baseline, ...file[side] }) + "\n",
            },
          ],
        })),
      });
    };
    const incoming = await write(sourceContext.contextId, "incoming");
    const sourceCommit = await port.vcs.commit({
      contextId: sourceContext.contextId,
      commandId: crypto.randomUUID(),
      expectedWorkingHead: incoming.workingHead,
      message: "Apply incoming project settings for review",
    });
    await write(target.contextId, "local");
    const targetStatus = await port.vcs.status({ contextId: target.contextId });
    const comparison = await port.vcs.compare({
      target: targetStatus.workingHead,
      source: sourceCommit.event,
    });
    const assigned = files.map((file) => {
      const coordinate = comparison.coordinates.find(
        (entry) =>
          entry.coordinate.kind === "file" &&
          entry.coordinate.id === file.fileId,
      );
      const sourceChangeIds =
        coordinate?.attribution.theirs.map((change) => change.changeId) ?? [];
      if (coordinate?.status !== "conflict" || sourceChangeIds.length === 0)
        throw new Error(
          `Fixture did not produce the expected attributable file conflict: ${file.path}`,
        );
      return {
        path: file.path,
        fileId: file.fileId,
        expected: expectedIntegratedFile(file),
        sourceChangeIds,
      };
    });
    const fixture: IntegrationOracleFixture = {
      contextId: target.contextId,
      source: sourceCommit.event,
      repositoryId: repository.repositoryId,
      files: assigned,
      commonSeedEvent: committed.event,
      mainEventId: initial.mainEventId,
    };
    return {
      fixture,
      ownerEntityId: sourceContext.ownerEntityId,
      initialComparison: comparison,
      repoPath,
      files: files.map(({ path }) => ({
        repositoryId: repository.repositoryId,
        path,
        workspacePath: `${repoPath}/${path}`,
      })),
      cleanup,
    };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Fixture setup and cleanup failed",
      );
    }
    throw error;
  }
}
