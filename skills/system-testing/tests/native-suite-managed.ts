import {
  PANEL_AUTOMATION_RESOURCE,
  PANEL_RUNTIME_STATE_AUTHORITY,
} from "../panel-authority.js";
import type { TestAuthorityPolicy, TestCase } from "../types.js";
import type { ManagedNativeSuiteReceiver } from "../native-suite-managed.js";
import { managedNativeSuiteWorlds } from "../native-suite-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedNativeSuiteReceiver["runManagedNativeSuiteTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedNativeSuiteReceiver["qualifyManagedNativeSuite"]>
>;
export const nativeSuiteAuthority: TestAuthorityPolicy = {
  authority: [
    {
      ruleId: "assigned-native-suite",
      capability: {
        kind: "prefix",
        prefix: "userland:extensions/test-runner/native.code.execute-tests#",
      },
      resource: {
        kind: "exact",
        key: "native.code.tests:extension:@workspace-extensions/test-runner",
      },
      tier: "gated",
      decision: "once",
    },
  ],
};
const workerdAuthority: TestAuthorityPolicy = {
  authority: [PANEL_RUNTIME_STATE_AUTHORITY],
};
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["extensions/test-runner"],
};

export const managedNativeSuiteTests: TestCase[] = managedNativeSuiteWorlds.map(
  (world) => ({
    ...settings,
    ...(world.mode === "inspect"
      ? {}
      : world.runtime === "native"
        ? { authorityPolicy: nativeSuiteAuthority }
        : {
            authorityPolicy: workerdAuthority,
            resources: [PANEL_AUTOMATION_RESOURCE],
          }),
    name: `native-suite-live-${world.id}`,
    description: "Review the assigned manifest-declared test suite",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedNativeSuite(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang test suite review");
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
          managedNativeSuite: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedNativeSuite"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }),
);

managedNativeSuiteTests.push({
  ...settings,
  authorityPolicy: {
    authority: [...nativeSuiteAuthority.authority, ...workerdAuthority.authority],
  },
  resources: [PANEL_AUTOMATION_RESOURCE],
  name: "native-suite-oracle-qualification",
  description:
    "Qualify declarations and verification in their installed runtimes without model calls",
  prompt: "Check the declared test routes and focused result receipts.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedNativeSuiteWorlds) {
      const run = await runner.runManagedNativeSuite(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Suite qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { nativeSuiteQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["nativeSuiteQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedNativeSuiteWorlds.length &&
        checks.every(
          ({ verification, rejectsWrongAssignment }) =>
            verification.passed && rejectsWrongAssignment,
        ),
      details: { checks },
    };
  },
});
