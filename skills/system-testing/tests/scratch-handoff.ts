import type { TestCase } from "../types.js";
import type { ScratchHandoffReceiver } from "../scratch-handoff-contract.js";
import { managedScratchWorlds } from "../scratch-handoff-worlds.js";

type Captured = Awaited<
  ReturnType<ScratchHandoffReceiver["runScratchHandoffTeacher"]>
>;
type Exercise = Captured["teacher"] & { trainingEligible?: boolean };

export const managedScratchHandoffTests: TestCase[] = managedScratchWorlds.map(
  (world) => ({
    name: `scratch-handoff-live-${world.id}`,
    category: "project-lifecycle",
    description:
      "Build or hold a scratch evidence handoff using real context files and independent readback",
    prompt: world.goal,
    explicitOnly: true,
    validation: "harness",
    async orchestrate(context) {
      context.signal.throwIfAborted();
      const started = Date.now();
      const observed = await context.runner.runScratchHandoff(world.id);
      if (observed.kind !== "teacher")
        throw new Error("Missing authored scratch handoff run");
      context.signal.throwIfAborted();
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          channelId: null,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
          contextId: observed.result.world.contextId,
        },
        diagnostics: {
          natlangTeacher: observed.result.teacher,
          scratchHandoffWorld: observed.result.world,
          scratchHandoffVerification: observed.result.verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Exercise
        | undefined;
      const verified = result.diagnostics?.["scratchHandoffVerification"] as
        | Captured["verification"]
        | undefined;
      return teacher?.trainingEligible === true &&
        verified?.passed === true &&
        verified.expectedStatus === world.status
        ? { passed: true, details: verified.checks }
        : {
            passed: false,
            reason:
              "The authored call and independent workspace readback must both pass",
            details: verified?.checks,
          };
    },
  }),
);

managedScratchHandoffTests.push({
  name: "scratch-handoff-managed-oracle-qualification",
  category: "project-lifecycle",
  description:
    "Check real scratch reads, byte-exact staging, fabricated evidence rejection, and blocked handoff",
  prompt:
    "Qualify the scratch handoff verifier against owned workspace files without model calls.",
  explicitOnly: true,
  validation: "harness",
  async orchestrate(context) {
    const started = Date.now();
    const qualified = [];
    for (const [id, mode] of [
      ["translation-review", "reference"],
      ["translation-review", "negative"],
      ["missing-rollback-record", "reference"],
    ] as const) {
      context.signal.throwIfAborted();
      const observed = await context.runner.runScratchHandoff(id, mode);
      if (observed.kind !== "reference")
        throw new Error("Qualification used an executor");
      qualified.push(observed.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { scratchHandoffQualification: qualified },
    };
  },
  validate(result) {
    const [reference, negative, missing] = (result.diagnostics?.[
      "scratchHandoffQualification"
    ] ?? []) as Captured["verification"][];
    const passed =
      reference?.passed === true &&
      negative?.passed === false &&
      negative.checks.disposition &&
      negative.checks.originalsUnchanged &&
      negative.checks.protectedUnchanged &&
      negative.checks.exactReadback === false &&
      missing?.passed === true &&
      missing.artifact === null;
    return passed
      ? {
          passed: true,
          details: {
            reference: true,
            alteredQuotationRejected: true,
            missingSourceHeld: true,
            modelCalls: 0,
          },
        }
      : {
          passed: false,
          reason: "Real scratch verifier did not pass its three checks",
          details: { reference, negative, missing },
        };
  },
});
