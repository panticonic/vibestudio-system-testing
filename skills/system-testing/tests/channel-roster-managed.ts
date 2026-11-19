import type { TestCase } from "../types.js";
import type { ManagedChannelRosterReceiver } from "../channel-roster-contract.js";
import { managedChannelRosterWorlds } from "../channel-roster-worlds.js";

type Exercise = Awaited<
  ReturnType<ManagedChannelRosterReceiver["runManagedChannelRosterTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedChannelRosterReceiver["qualifyManagedChannelRoster"]>
>;
const settings = {
  category: "local-messaging",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [
    "workers/test-agent",
    "workers/pubsub-channel",
    "workers/local-messaging-fixture",
  ],
};

export const managedChannelRosterTests: TestCase[] =
  managedChannelRosterWorlds.map(({ id, goal }) => ({
    ...settings,
    name: `channel-roster-live-${id}`,
    description: "Reconcile exact worker memberships across two live channels",
    prompt: goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedChannelRoster(
        id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored channel roster workflow");
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
          managedChannelRoster: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Exercise["teacher"]
        | undefined;
      const exercise = result.diagnostics?.["managedChannelRoster"] as
        | Omit<Exercise, "teacher">
        | undefined;
      return teacher?.trainingEligible === true &&
        exercise?.verification.passed === true
        ? { passed: true, details: exercise.verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the ordered operations and final rosters of both channels.",
            details: exercise?.verification,
          };
    },
  }));

managedChannelRosterTests.push({
  ...settings,
  name: "channel-roster-managed-oracle-qualification",
  timeoutMs: 15 * 60_000,
  description: "Qualify live channel rosters without a model",
  prompt: "Check actual membership effects, scope and held conflicts.",
  async orchestrate(context) {
    const started = Date.now();
    const rows: Qualification[] = [];
    for (const { id } of managedChannelRosterWorlds) {
      try {
        const run = await context.runner.runManagedChannelRoster(
          id,
          true,
          context.signal,
        );
        if (run.kind !== "reference")
          throw new Error("Qualification invoked a teacher");
        rows.push(run.result);
      } catch (cause) {
        throw new Error(`Channel roster qualification failed for ${id}`, {
          cause,
        });
      }
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { channelRosterQualification: rows },
    };
  },
  validate(result) {
    const rows = result.diagnostics?.["channelRosterQualification"] as
      | Qualification[]
      | undefined;
    return rows?.length === managedChannelRosterWorlds.length &&
      rows.every(
        ({ verification, rejectsOtherChannel, rejectsWrongReceipt }) =>
          verification.passed && rejectsOtherChannel && rejectsWrongReceipt,
      )
      ? { passed: true, details: { checkedCases: rows.length, modelCalls: 0 } }
      : {
          passed: false,
          reason: "The live rosters or scope checks did not match.",
          details: { rows },
        };
  },
});
