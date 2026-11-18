import { createWorkspaceIntegration } from "@workspace/natlang-services";
import type { prepareWorkspaceIntegration } from "./vcs-integration-fixture.js";
import { verifyWorkspaceIntegration } from "./vcs-integration-oracle.js";

type Port = Parameters<typeof prepareWorkspaceIntegration>[0] & {
  vcs: Parameters<typeof verifyWorkspaceIntegration>[0];
};
/** Candidate mechanics use real owned VCS authority. The negative omits the final file's incoming change. */
export async function exerciseWorkspaceIntegration(
  vcs: Port["vcs"],
  world: Omit<
    Awaited<ReturnType<typeof prepareWorkspaceIntegration>>,
    "cleanup"
  >,
  variant: "reference" | "negative" | "alias",
) {
  const { fixture } = world;
  const service = createWorkspaceIntegration({
    vcs,
    contextId: fixture.contextId,
    source: fixture.source,
    files: world.files,
  });
  const initial = await service.observe();
  const skippedFile = variant === "negative" ? fixture.files.at(-1) : undefined;
  const edits = fixture.files.flatMap((file) => {
    if (file === skippedFile) return [];
    const assigned = world.files.find((entry) => entry.path === file.path);
    const modelFile = initial.files.find(
      (entry) => entry.path === assigned?.workspacePath,
    );
    if (!modelFile)
      throw new Error(`Qualification did not observe ${file.path}`);
    return [
      {
        path: modelFile.path,
        before: modelFile.text,
        after: JSON.stringify(file.expected) + "\n",
      },
    ];
  });
  if (edits.length) await service.apply(initial.head, edits);
  const current = await service.observe();
  const comparison = await vcs.compare({
    target: (await vcs.status({ contextId: fixture.contextId })).workingHead,
    source: fixture.source,
  });
  const decisions: Parameters<typeof service.merge>[1] = fixture.files.map(
    (file) => {
      const coordinate = comparison.coordinates.find(
        (item) =>
          item.coordinate.kind === "file" && item.coordinate.id === file.fileId,
      );
      if (!coordinate)
        throw new Error(`Qualification lost the coordinate for ${file.path}`);
      const resolution =
        file === skippedFile
          ? "ours"
          : coordinate.resolutions.includes("current")
            ? "current"
            : "composed";
      if (!coordinate.resolutions.includes(resolution))
        throw new Error(
          `Qualification resolution is not offered for ${file.path}: ${resolution}`,
        );
      return {
        coordinate: { kind: "file" as const, id: file.fileId },
        resolution,
        rationale:
          file === skippedFile
            ? "Negative deliberately keeps only the local intention in the final file"
            : "The observed current file contains all assigned and preserved fields",
      };
    },
  );
  await service.merge(current.head, decisions);
  return verifyWorkspaceIntegration(vcs, fixture);
}
