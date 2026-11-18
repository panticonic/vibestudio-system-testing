import type { UnitRepairTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import {
  PANEL_AUTOMATION_RESOURCE,
  PANEL_RUNTIME_STATE_AUTHORITY,
} from "../panel-authority.js";
import type { UnitRepairFault } from "../unit-repair-oracle.js";
import type { TestCase } from "../types.js";

const cases = [
  { name: "worker-label-repair-type-mismatch", fault: "type-mismatch" },
  { name: "worker-label-repair-missing-helper", fault: "missing-helper" },
] as const satisfies readonly { name: string; fault: UnitRepairFault }[];
const goal =
  "Repair the label-normalizer worker so it compiles, trims labels, drops blanks, and deduplicates ignoring case while preserving the first spelling and order. Preserve the input and the existing test suite. Verify the result with its declared workerd tests.";

export const unitRepairTests: TestCase[] = cases.map(({ name, fault }) => ({
  name,
  category: "unit-diagnostics",
  description:
    "Repair a non-compiling workspace worker and pass its original workerd tests.",
  prompt: goal,
  explicitOnly: true,
  validation: "harness",
  authorityPolicy: { authority: [PANEL_RUNTIME_STATE_AUTHORITY] },
  resources: [PANEL_AUTOMATION_RESOURCE],
  workspaceRepoFixture: {
    kind: "unit-repair-worker",
    section: "workers",
    fault,
  },
  async orchestrate({ runner }) {
    const began = Date.now();
    const { teacher, world, verification } =
      await runner.runUnitRepairTeacher(goal);
    return {
      messages: [],
      duration: Date.now() - began,
      provenance: {
        contextId: world.contextId,
        channelId: null,
        branchId: null,
        agentEntityId: null,
        agentTargetId: null,
      },
      diagnostics: {
        natlangTeacher: teacher,
        unitRepairWorld: world,
        unitRepairVerification: verification,
      },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as
      | {
          trainingEligible?: boolean;
          report?: { status: string; revision: string };
          calls?: { record?: { definition?: { name?: string } } }[];
        }
      | undefined;
    const world = result.diagnostics?.["unitRepairWorld"] as
      | UnitRepairTeacherResult["world"]
      | undefined;
    const verification = result.diagnostics?.["unitRepairVerification"] as
      | UnitRepairTeacherResult["verification"]
      | undefined;
    const names = new Set(
      teacher?.calls?.map((call) => call.record?.definition?.name),
    );
    const stages = [
      "repairUnit",
      "diagnose",
      "explainCause",
      "proposeRepair",
      "verifyRepair",
    ];
    if (
      teacher?.report?.status !== "verified" ||
      teacher.trainingEligible !== true ||
      !world ||
      teacher.report.revision !== world.after ||
      !stages.every((name) => names.has(name))
    ) {
      return {
        passed: false,
        reason:
          "The authored repair did not complete its nested stages and verify the changed revision.",
      };
    }
    return verification?.passed
      ? {
          passed: true,
          details: {
            checks: verification.checks,
            authoredNestedStages: stages,
          },
        }
      : {
          passed: false,
          reason: "The independent compiler and workerd checks did not pass.",
          details: { checks: verification?.checks },
        };
  },
}));
