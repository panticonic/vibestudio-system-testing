import type { AndroidInstallReceiver } from "../android-install-managed.js";
import { androidInstallWorlds } from "../android-install-worlds.js";
import type { TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<AndroidInstallReceiver["qualifyAndroidInstall"]>>;
type Teacher = Awaited<ReturnType<AndroidInstallReceiver["runAndroidInstallTeacher"]>>;
const settings = {
  category: "mobile",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 25 * 60_000,
  requiresUnits: ["skills/mobile-system-testing", "extensions/mobile-debug"],
  resources: ["mobile:android-device"],
  authorityPolicy: {
    authority: [{
      ruleId: "android-development-install",
      capability: { kind: "prefix" as const, prefix: "userland:extensions/mobile-debug/native.mobile.execute#" },
      resource: { kind: "exact" as const, key: "native.mobile:extension:@workspace-extensions/mobile-debug" },
      tier: "gated" as const,
      decision: "once" as const,
    }],
  },
};

export const managedAndroidInstallTests: TestCase[] = androidInstallWorlds.map((world) => ({
  ...settings,
  name: `android-install-live-${world.id}`,
  description: "Exercise one assigned Android development install and verify the exact outcome",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runAndroidInstall(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a captured Android installation");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, androidInstall: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
    const verification = result.diagnostics?.["androidInstall"] as Teacher["verification"] | undefined;
    return { passed: !!teacher?.trainingEligible && !!verification?.passed, details: verification?.checks };
  },
}));

managedAndroidInstallTests.push({
  ...settings,
  name: "android-install-oracle-qualification",
  description: "Qualify the original native Android development installation path without model calls",
  prompt: androidInstallWorlds[0].goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const outcomes: Qualification[] = [];
    for (const { id } of androidInstallWorlds) {
      const result = await runner.runAndroidInstall(id, true, signal);
      if (result.kind !== "reference") throw new Error("Android installation qualification invoked a teacher");
      outcomes.push(result.value);
    }
    return { messages: [], duration: Date.now() - start, diagnostics: { androidInstall: outcomes } };
  },
  validate(result) {
    const outcomes = result.diagnostics?.["androidInstall"] as Qualification[] | undefined;
    return {
      passed: outcomes?.length === androidInstallWorlds.length && outcomes.every(({ passed }) => passed),
      details: outcomes?.map(({ caseId, checks }) => ({ caseId, checks })),
    };
  },
});
