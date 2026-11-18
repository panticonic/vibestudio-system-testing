import type { TestCase } from "../types.js";
import type { ManagedPdfReceiver } from "../pdf-intake-contract.js";
import { managedPdfWorlds } from "../pdf-intake-worlds.js";

type Run = Awaited<ReturnType<ManagedPdfReceiver["runManagedPdfTeacher"]>>;
type Qualification = Awaited<
  ReturnType<ManagedPdfReceiver["qualifyManagedPdf"]>
>;
export const managedPdfTests: TestCase[] = managedPdfWorlds.map((world) => ({
  name: `pdf-intake-live-${world.id}`,
  category: "project-lifecycle",
  description:
    "Extract or hold scoped evidence using the installed PDF extension and actual workspace bytes",
  prompt: world.goal,
  explicitOnly: true,
  validation: "harness",
  async orchestrate(context) {
    context.signal.throwIfAborted();
    const started = Date.now();
    const observed = await context.runner.runManagedPdf(world.id);
    if (observed.kind !== "teacher")
      throw new Error("Missing authored PDF intake run");
    context.signal.throwIfAborted();
    return {
      messages: [],
      duration: Date.now() - started,
      provenance: {
        channelId: null,
        branchId: null,
        agentEntityId: null,
        agentTargetId: null,
        contextId: observed.result.contextId,
      },
      diagnostics: {
        natlangTeacher: observed.result.teacher,
        managedPdf: {
          contextId: observed.result.contextId,
          verification: observed.result.verification,
        },
      },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as
      | (Run["teacher"] & { trainingEligible?: boolean })
      | undefined;
    const value = result.diagnostics?.["managedPdf"] as
      | Omit<Run, "teacher">
      | undefined;
    return teacher?.trainingEligible === true && value?.verification.passed
      ? { passed: true, details: value.verification.checks }
      : {
          passed: false,
          reason:
            "Authored PDF execution and exact extension-backed citation verification must both pass",
          details: value?.verification.checks,
        };
  },
}));
managedPdfTests.push({
  name: "pdf-intake-managed-oracle-qualification",
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness",
  prompt:
    "Qualify local PDF batches and citation verification using owned workspace files.",
  description:
    "Verify the installed PDF extension, exact citation rejection, partial answers, and blocked scope with no model calls",
  async orchestrate(context) {
    const started = Date.now();
    const checks = [];
    for (const { id } of managedPdfWorlds) {
      context.signal.throwIfAborted();
      const observed = await context.runner.runManagedPdf(id, true);
      if (observed.kind !== "reference")
        throw new Error("Qualification invoked a teacher");
      checks.push(observed.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { pdfIntakeQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["pdfIntakeQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === managedPdfWorlds.length &&
      checks.every(
        (item) => item.accepted.passed && item.rejectedUnsupportedReceipt,
      )
      ? {
          passed: true,
          details: {
            checkedCases: checks.length,
            invalidReceiptRejected: true,
            modelCalls: 0,
          },
        }
      : {
          passed: false,
          reason:
            "Actual PDF extraction and its independent oracle failed to qualify",
          details: { checks },
        };
  },
});
