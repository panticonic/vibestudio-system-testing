import { vcs } from "@workspace/runtime";
import { openSpectroliteVault, spectroliteGoalWorlds, type OpenSpectroliteWorld } from "./open-goal-spectrolite-worlds.js";

export async function seedOpenSpectroliteGoal({ contextId, caseId }: { contextId: string; caseId: string }) {
  const world = spectroliteGoalWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown Spectrolite goal");
  return seedSpectroliteScene(contextId, world);
}

export async function seedSpectroliteScene(contextId: string, world: Pick<OpenSpectroliteWorld, "openPath" | "files"> & { draft?: Record<string, string | null> }) {
  const { workingHead } = await vcs.status({ contextId });
  const repository = await vcs.resolveRepository({ state: workingHead, repoPath: openSpectroliteVault });
  if (!repository) throw new Error("The owned Spectrolite vault is absent");
  const { repositoryId } = repository;
  const seed = await vcs.edit({
    contextId, expectedWorkingHead: workingHead, commandId: `open-spectrolite:seed:${contextId}`,
    changes: Object.entries(world.files).map(([path, text]) => ({
      kind: "file-create", repositoryId, path, mode: 0o644, content: { kind: "text", text },
    })),
  });
  const committed = await vcs.commit({
    contextId, expectedWorkingHead: seed.workingHead, commandId: `open-spectrolite:commit:${contextId}`,
    message: "Seed the owned Spectrolite vault",
  });
  if (world.draft) {
    const state = { kind: "event" as const, eventId: committed.event.eventId };
    const changes = await Promise.all(Object.entries(world.draft).map(async ([path, text]) => {
      const file = await vcs.readFile({ state, repositoryId, file: { kind: "path", path } });
      if (!file || file.content.kind !== "text") throw new Error(`Missing committed source ${path}`);
      if (text === null) return {kind:"file-delete" as const,repositoryId,fileId:file.fileId};
      return { kind: "text-edit" as const, repositoryId, fileId: file.fileId,
        edits: [{ start: 0, end: file.content.text.length, text }] };
    }));
    await vcs.edit({ contextId, expectedWorkingHead: state,
      commandId: `open-spectrolite:draft:${contextId}`, changes });
  }
  return { openPath: world.openPath };
}
