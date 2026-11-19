import type { TestCase } from "../types.js";
import type { ManagedClientAdmissionReceiver } from "../client-admission-contract.js";
import { managedClientAdmissionWorlds } from "../client-admission-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedClientAdmissionReceiver["runManagedClientAdmissionTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedClientAdmissionReceiver["qualifyManagedClientAdmission"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/clientdev"],
};

export const managedClientAdmissionTests: TestCase[] =
  managedClientAdmissionWorlds.map((world) => ({
    ...settings,
    name: `client-admission-live-${world.id}`,
    description:
      "Review the installed client against the assigned host contract",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedClientAdmission(
        world.id,
        false,
        signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang client admission review");
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
          managedClientAdmission: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedClientAdmission"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }));

function qualifyClientAdmission(
  name: string,
  worlds: readonly { id: string }[],
): TestCase {
  return {
    ...settings,
    name,
    timeoutMs: worlds.length === 1 ? settings.timeoutMs : null,
    description:
      "Qualify published client and host contract readbacks without model calls",
    prompt:
      "Join the assigned client manifest, published trust and build catalog.",
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const checks: Qualification[] = [];
      for (const { id } of worlds) {
        const run = await runner.runManagedClientAdmission(id, true, signal);
        if (run.kind !== "reference")
          throw new Error("Client admission qualification invoked a teacher");
        checks.push(run.result);
      }
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { clientAdmissionQualification: checks },
      };
    },
    validate(result) {
      const checks = result.diagnostics?.["clientAdmissionQualification"] as
        | Qualification[]
        | undefined;
      return {
        passed:
          checks?.length === worlds.length &&
          checks.every(
            ({ verification, rejectedForeignScope, rejectedWrongDecision }) =>
              verification.passed &&
              rejectedForeignScope &&
              rejectedWrongDecision,
          ),
        details: { checks },
      };
    },
  };
}

managedClientAdmissionTests.push(
  qualifyClientAdmission(
    "client-admission-oracle-qualification",
    managedClientAdmissionWorlds,
  ),
  ...managedClientAdmissionWorlds.map((world) =>
    qualifyClientAdmission(`client-admission-oracle-${world.id}`, [world])
  ),
);
