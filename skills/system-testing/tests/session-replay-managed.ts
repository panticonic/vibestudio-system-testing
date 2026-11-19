import type { TestCase } from "../types.js";
import type { ManagedSessionReplayReceiver } from "../session-replay-contract.js";
import {
  composedSessionReplayWorlds,
  managedSessionReplayWorlds,
} from "../session-replay-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedSessionReplayReceiver["runManagedSessionReplayTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedSessionReplayReceiver["qualifyManagedSessionReplay"]>
>;

const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["skills/session-test-review", "workers/pubsub-channel"],
};

export const managedSessionReplayTests: TestCase[] =
  managedSessionReplayWorlds.map((world) => ({
    ...settings,
    name: `session-replay-live-${world.id}`,
    description:
      "Review durable transcript continuity after a real headless reconnect",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedSessionReplay(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang replay review");
      const { contextId, teacher, verification } = run.result;
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
          managedSessionReplay: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const evidence = result.diagnostics?.["managedSessionReplay"] as
        | Omit<Teacher, "teacher">
        | undefined;
      return teacher?.trainingEligible && evidence?.verification.passed
        ? { passed: true, details: evidence.verification.checks }
        : {
            passed: false,
            reason:
              "The review must cite the exact replay and retry identities.",
            details: evidence?.verification,
          };
    },
  }));

function replayQualification(name: string, worlds: readonly {id: string}[]): TestCase {
  return {
    ...settings,
    name,
    description:
      "Qualify the headless reconnect and durable transcript without a model",
    prompt: "Verify exact accepted messages and the resulting live replay.",
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const checks: Qualification[] = [];
      for (const { id } of worlds) {
        try {
          const run = await runner.runManagedSessionReplay(id, true, signal);
          if (run.kind !== "reference")
            throw new Error("Replay qualification ran a teacher");
          checks.push(run.result);
        } catch (cause) {
          throw new Error(`Failed to qualify session replay case ${id}`, {
            cause,
          });
        }
      }
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { replayQualification: checks },
      };
    },
    validate(result) {
      const checks = result.diagnostics?.["replayQualification"] as
        | Qualification[]
        | undefined;
      return checks?.length === worlds.length &&
        checks.every(
          ({ verified, rejectedForeignReceipt }) =>
            verified.passed && rejectedForeignReceipt,
        )
        ? { passed: true, details: { cases: checks.length, modelCalls: 0 } }
        : {
            passed: false,
            reason:
              "The transcript readback or oracle differed from the assigned replay.",
            details: { checks },
          };
    },
  };
}

managedSessionReplayTests.push(
  replayQualification("session-replay-managed-qualification", managedSessionReplayWorlds),
  replayQualification("session-replay-composed-qualification", composedSessionReplayWorlds),
);
