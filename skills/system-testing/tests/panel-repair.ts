import { panelControlAuthorityPolicy, PANEL_AUTOMATION_RESOURCE } from "../panel-authority.js";
import { panelRepairWorlds } from "../panel-repair-world.js";
import type { TestCase } from "../types.js";

export const panelRepairTests: TestCase[] = panelRepairWorlds.map((world) => ({
  name: world.id,
  category: "panel-repair",
  description: "Repair a workspace topic panel and preserve Save and Discard behavior",
  explicitOnly: true,
  workspaceRepoFixture: { kind: "draft-repair-panel", section: "panels", fault: world.fault },
  authorityPolicy: panelControlAuthorityPolicy("verify-repaired-topic-panel"),
  resources: [PANEL_AUTOMATION_RESOURCE],
  prompt:
    "The workspace topic panel loses my unsaved changes when I switch to Preview topic and back. Fix the provided panel so the draft is still there when I return. Preview should continue showing the saved value until I select Save, and Discard should still restore the saved value. Check the result in the running panel. Leave the change in this workspace.",
  validate(result) {
    const check = result.diagnostics?.["panelDraftVerification"] as
      | { passed: boolean; checks: Record<string, boolean> }
      | undefined;
    return check?.passed
      ? { passed: true, details: { panelDraftChecks: check.checks } }
      : { passed: false, reason: "The independent browser checks did not pass.", details: { panelDraftChecks: check?.checks } };
  },
}));
