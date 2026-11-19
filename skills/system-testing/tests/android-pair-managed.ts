import { androidPairingAuthority } from "./mobile.js";
import type { AndroidPairReceiver } from "../android-pair-managed.js";
import { androidPairWorlds } from "../android-pair-worlds.js";
import type { TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<AndroidPairReceiver["qualifyAndroidPair"]>>;
type Teacher = Awaited<ReturnType<AndroidPairReceiver["runAndroidPairTeacher"]>>;
const settings = {
  category: "mobile",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 25 * 60_000,
  requiresUnits: ["skills/mobile-system-testing", "workers/phone-provisioning"],
  resources: ["mobile:android-device"],
  authorityPolicy: androidPairingAuthority,
};

export const managedAndroidPairTests: TestCase[] = androidPairWorlds.map((world) => ({
  ...settings,
  name: `android-pair-live-${world.id}`,
  description: "Pair the assigned Android target through an attached desktop and verify its workspace",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runAndroidPair(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a captured Android pairing");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, androidPair: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
    const verification = result.diagnostics?.["androidPair"] as Teacher["verification"] | undefined;
    return { passed: !!teacher?.trainingEligible && !!verification?.passed, details: verification?.checks };
  },
}));

managedAndroidPairTests.push({
  ...settings,
  name: "android-pair-oracle-qualification",
  description: "Qualify the connected desktop and Android workspace without model calls",
  prompt: androidPairWorlds[0].goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const outcomes: Qualification[] = [];
    for (const { id } of androidPairWorlds) {
      const result = await runner.runAndroidPair(id, true, signal);
      if (result.kind !== "reference") throw new Error("Android pairing qualification invoked a teacher");
      outcomes.push(result.value);
    }
    return { messages: [], duration: Date.now() - start, diagnostics: { androidPair: outcomes } };
  },
  validate(result) {
    const outcomes = result.diagnostics?.["androidPair"] as Qualification[] | undefined;
    return {
      passed: outcomes?.length === androidPairWorlds.length && outcomes.every(({ passed }) => passed),
      details: outcomes?.map(({ caseId, checks }) => ({ caseId, checks })),
    };
  },
});
