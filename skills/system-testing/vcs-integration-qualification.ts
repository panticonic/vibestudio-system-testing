import { createWorkspaceIntegration } from "@workspace/natlang-services";
import type { prepareWorkspaceIntegration } from "./vcs-integration-fixture.js";
import { verifyWorkspaceIntegration } from "./vcs-integration-oracle.js";

type Port = Parameters<typeof prepareWorkspaceIntegration>[0] & { vcs: Parameters<typeof verifyWorkspaceIntegration>[0] };
/** Candidate mechanics use the fixture owner's real VCS authority; oracle sees only stored fixture and actual state. */
export async function exerciseWorkspaceIntegration(vcs: Port["vcs"], world: Omit<Awaited<ReturnType<typeof prepareWorkspaceIntegration>>, "cleanup">, variant: "reference" | "negative" | "alias") {
      const service = createWorkspaceIntegration({ vcs, contextId: world.fixture.contextId, source: world.fixture.source, files: world.files });
      const initial = await service.observe();
      if (variant !== "negative") {
        await service.apply(initial.head, [{ path: world.files[0]!.workspacePath, before: initial.files[0]!.text, after: JSON.stringify({ ...world.fixture.baseline, ...world.fixture.required }) + "\n" }]);
      }
      const current = await service.observe();
      const comparison = await vcs.compare({ target: (await vcs.status({ contextId: world.fixture.contextId })).workingHead, source: world.fixture.source });
      const coordinate = comparison.coordinates.find((item) => item.coordinate.kind === "file" && item.coordinate.id === world.fixture.fileId);
      if (!coordinate) throw new Error("Qualification lost assigned file coordinate");
      const resolution = variant === "negative" ? "ours" : coordinate.resolutions.includes("current") ? "current" : "composed";
      if (!coordinate.resolutions.includes(resolution)) throw new Error(`Qualification resolution is not offered: ${resolution}`);
      await service.merge(current.head, [{ coordinate: { kind: "file", id: world.fixture.fileId }, resolution, rationale: variant === "negative" ? "Negative candidate deliberately discards incoming intention" : "Observed current content contains both requested fields and preserves all other fields" }]);
      const verdict = await verifyWorkspaceIntegration(vcs, world.fixture);
      return verdict;
}
