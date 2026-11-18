import { createWorkspaceIntegration } from "@workspace/natlang-services";
import { prepareWorkspaceIntegration } from "./vcs-integration-fixture.js";
import { verifyWorkspaceIntegration } from "./vcs-integration-oracle.js";

type Port = Parameters<typeof prepareWorkspaceIntegration>[0] & { vcs: Parameters<typeof verifyWorkspaceIntegration>[0] };
/** Actual local-state reference/negative/alias qualification, never a teacher trajectory or learner source. */
export async function qualifyWorkspaceIntegration(port: Port, seed: string) {
  const run = async (variant: "reference" | "negative" | "alias") => {
    const world = await prepareWorkspaceIntegration(port, `${seed}-${variant}`, variant === "alias" ? { theme: "solarized", locale: "fr" } : { theme: "dark", locale: "es" });
    try {
      const service = createWorkspaceIntegration({ vcs: port.vcs, contextId: world.fixture.contextId, source: world.fixture.source, files: world.files });
      const initial = await service.observe();
      if (variant !== "negative") {
        await service.apply(initial.head, [{ path: world.files[0]!.workspacePath, before: initial.files[0]!.text, after: JSON.stringify({ ...world.fixture.baseline, ...world.fixture.required }) + "\n" }]);
      }
      const current = await service.observe();
      const comparison = await port.vcs.compare({ target: (await port.vcs.status({ contextId: world.fixture.contextId })).workingHead, source: world.fixture.source });
      const coordinate = comparison.coordinates.find((item) => item.coordinate.kind === "file" && item.coordinate.id === world.fixture.fileId);
      if (!coordinate) throw new Error("Qualification lost assigned file coordinate");
      const resolution = variant === "negative" ? "ours" : coordinate.resolutions.includes("current") ? "current" : "composed";
      if (!coordinate.resolutions.includes(resolution)) throw new Error(`Qualification resolution is not offered: ${resolution}`);
      await service.merge(current.head, [{ coordinate: { kind: "file", id: world.fixture.fileId }, resolution, rationale: variant === "negative" ? "Negative candidate deliberately discards incoming intention" : "Observed current content contains both requested fields and preserves all other fields" }]);
      const verdict = await verifyWorkspaceIntegration(port.vcs, world.fixture);
      if (verdict.passed !== (variant !== "negative")) throw new Error(`Oracle qualification failed for ${variant}: ${JSON.stringify(verdict.reasons)}`);
      return { variant, verdict };
    } finally { await world.cleanup(); }
  };
  return [await run("reference"), await run("negative"), await run("alias")];
}
