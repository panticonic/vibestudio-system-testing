import { describe, it, expect } from "vitest";
import { imagePanelFixtureFiles } from "./image-panel-fixture.js";
import { parseUnitAuthorityManifest } from "@vibestudio/shared/authorityManifest";
describe("live image panel fixture", () => {
  it("declares exact service authority and persists only lightweight job identities", () => {
    const files = imagePanelFixtureFiles("owned-image-studio");
    const manifest = JSON.parse(files["package.json"]!);
    expect(() =>
      parseUnitAuthorityManifest(manifest.vibestudio.authority, "image fixture")
    ).not.toThrow();
    expect(manifest.vibestudio.authority.requests).toContainEqual({
      capability: "workspace-service:images",
      resource: { kind: "exact", key: "do:workers/images:ImagesDO:workspace" },
      tier: "gated",
      evidence: "exact",
    });
    expect(Object.keys(manifest.vibestudio.stateArgs.properties)).toEqual(["jobs", "selectedJob"]);
    expect(Object.keys(files).sort()).toEqual(["index.tsx", "package.json"]);
  });
});
