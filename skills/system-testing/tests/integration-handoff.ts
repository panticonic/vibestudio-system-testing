import type { TestCase } from "../types.js";
import type { IntegrationHandoffReceiver } from "../integration-handoff-contract.js";
import { integrationHandoffWorlds } from "../integration-handoff-worlds.js";

type Managed = Awaited<
  ReturnType<IntegrationHandoffReceiver["runIntegrationHandoffTeacher"]>
>;
type Qualified = Awaited<
  ReturnType<IntegrationHandoffReceiver["qualifyIntegrationHandoff"]>
>;
const goal =
  "Integrate the assigned settings, then prepare a scratch handoff from the verified files. Stage it only when every answer is supported.";
export const managedIntegrationHandoffTests: TestCase[] =
  integrationHandoffWorlds.map((world) => ({
    name: `integration-handoff-${world.id}`,
    category: "vcs-integration",
    description:
      "Integrate actual workspace settings and quote the verified result in an independently checked scratch artifact",
    prompt: goal,
    explicitOnly: true,
    validation: "harness",
    async orchestrate(context) {
      context.signal.throwIfAborted();
      const started = Date.now();
      const observed = await context.runner.runIntegrationHandoff(world.id);
      if (observed.kind !== "teacher")
        throw new Error("Missing composed Natlang execution");
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
          integrationHandoff: {
            contextId: observed.result.contextId,
            caseId: observed.result.caseId,
            verification: observed.result.verification,
          },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Managed["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const evidence = result.diagnostics?.["integrationHandoff"] as
        | Omit<Managed, "teacher">
        | undefined;
      return teacher?.trainingEligible === true &&
        evidence?.verification.passed === true
        ? { passed: true, details: evidence.verification.checks }
        : {
            passed: false,
            reason:
              "Ordered shared workflow capture and independent integrated-head handoff must both pass",
            details: evidence?.verification.checks,
          };
    },
  }));
managedIntegrationHandoffTests.push({
  name: "integration-handoff-oracle-qualification",
  category: "vcs-integration",
  description:
    "Qualify the dependency and readback in a real workspace without model calls",
  prompt: goal,
  explicitOnly: true,
  validation: "harness",
  // The qualification opens and retires a fresh integration workspace for each case.
  timeoutMs: 20 * 60_000,
  async orchestrate(context) {
    const started = Date.now();
    const cases: { id: string; qualification: Qualified }[] = [];
    for (const { id } of integrationHandoffWorlds) {
      context.signal.throwIfAborted();
      const observed = await context.runner.runIntegrationHandoff(id, true);
      if (observed.kind !== "reference")
        throw new Error("Qualification called a teacher");
      cases.push({ id, qualification: observed.result });
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { integrationHandoffQualification: cases },
    };
  },
  validate(result) {
    const cases = result.diagnostics?.["integrationHandoffQualification"] as
      | { id: string; qualification: Qualified }[]
      | undefined;
    const passed =
      cases?.length === integrationHandoffWorlds.length &&
      integrationHandoffWorlds.every(({ id, questions }, index) => {
        const observed = cases[index];
        const checks = observed?.qualification;
        const held = questions.some(({ unanswered }) => unanswered);
        return (
          observed?.id === id &&
          checks?.earlyReadDenied &&
          checks.earlyStageDenied &&
          checks.verified.passed &&
          checks.verified.expectedStatus === (held ? "unanswered" : "staged") &&
          Boolean(checks.verified.artifact) === !held
        );
      });
    return { passed, details: { cases, modelCalls: 0 } };
  },
});
