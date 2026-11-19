import type { AndroidAuditReceiver } from "../android-audit-managed.js";
import { androidAuditWorlds } from "../android-audit-worlds.js";
import type { TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<AndroidAuditReceiver["qualifyAndroidAudit"]>>;
type Teacher = Awaited<ReturnType<AndroidAuditReceiver["runAndroidAuditTeacher"]>>;
const settings = {
  category: "mobile",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/mobile-runtime-audit", "skills/mobile-runtime-audit-bindings", "extensions/mobile-debug"],
  resources: ["mobile:android-device"],
  authorityPolicy: {
    authority: [{
      ruleId: "android-runtime-audit",
      capability: { kind: "prefix" as const, prefix: "userland:extensions/mobile-debug/native.mobile.execute#" },
      resource: { kind: "exact" as const, key: "native.mobile:extension:@workspace-extensions/mobile-debug" },
      tier: "gated" as const,
      decision: "once" as const,
    }],
  },
};

export const managedAndroidAuditTests: TestCase[] = androidAuditWorlds.map((world) => ({
  ...settings,
  name: `android-audit-live-${world.id}`,
  description: "Audit the assigned Android device and application through Mobile Debug",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runAndroidAudit(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a captured Android audit");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, androidAudit: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
    const verification = result.diagnostics?.["androidAudit"] as Teacher["verification"] | undefined;
    return { passed: !!teacher?.trainingEligible && !!verification?.passed, details: verification?.checks };
  },
}));

managedAndroidAuditTests.push({
  ...settings,
  name: "android-audit-oracle-qualification",
  description: "Qualify native Android inventory and application evidence without model calls",
  prompt: androidAuditWorlds[0].goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const outcomes: Qualification[] = [];
    for (const { id } of androidAuditWorlds) {
      const result = await runner.runAndroidAudit(id, true, signal);
      if (result.kind !== "reference") throw new Error("Android audit qualification invoked a teacher");
      outcomes.push(result.value);
    }
    return { messages: [], duration: Date.now() - start, diagnostics: { androidAudit: outcomes } };
  },
  validate(result) {
    const outcomes = result.diagnostics?.["androidAudit"] as Qualification[] | undefined;
    return {
      passed: outcomes?.length === androidAuditWorlds.length && outcomes.every(({ passed }) => passed),
      details: outcomes?.map(({ caseId, checks }) => ({ caseId, checks })),
    };
  },
});
