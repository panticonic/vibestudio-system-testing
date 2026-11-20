import type { TestCase } from "../types.js";
import type { RemoteCommissionReceiver } from "../remote-commission-managed.js";
import { liveRemoteCommissionWorld as world } from "../remote-commission-worlds.js";

type Teacher = Awaited<
  ReturnType<RemoteCommissionReceiver["runRemoteCommissionTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<RemoteCommissionReceiver["qualifyRemoteCommission"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["skills/remote-access"],
  timeoutMs: 6 * 60_000,
  prompt: world.goal,
};

export const remoteCommissionTests: TestCase[] = [
  {
    ...settings,
    name: `remote-commission-live-${world.id}`,
    description:
      "Reuse a verified native hub and pair and open its workspace from a new terminal profile",
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runRemoteCommission(false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a managed commissioning capture");
      const { contextId, teacher, verification } = run.value;
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          contextId,
          channelId: null,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
        },
        diagnostics: {
          natlangTeacher: teacher,
          remoteCommissionManaged: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["remoteCommissionManaged"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  },
  {
    ...settings,
    name: `remote-commission-oracle-qualification-${world.id}`,
    description:
      "Check native commissioning and reject foreign and replayed receipts without model calls",
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runRemoteCommission(true, signal);
      if (run.kind !== "reference")
        throw new Error("Qualification invoked a commissioning teacher");
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { remoteCommissionQualification: run.value },
      };
    },
    validate(result) {
      const observation = result.diagnostics?.[
        "remoteCommissionQualification"
      ] as Qualification | undefined;
      return {
        passed: observation?.caseId === world.id && observation.passed,
        details: observation?.checks,
      };
    },
  },
];
