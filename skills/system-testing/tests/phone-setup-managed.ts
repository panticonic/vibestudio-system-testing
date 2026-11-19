import type { TestCase } from "../types.js";
import {
  phoneSetupUnavailable,
  type ManagedPhoneSetupReceiver,
} from "../phone-setup-managed.js";

type Teacher = Awaited<
  ReturnType<ManagedPhoneSetupReceiver["runManagedPhoneSetupTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedPhoneSetupReceiver["qualifyManagedPhoneSetup"]>
>;

const phoneProvider =
  "do:workers/phone-provisioning:PhoneProvisioningDO:workspace-phone-provisioning";
const settings = {
  category: "mobile",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/phone-setup", "workers/phone-provisioning"],
  authorityPolicy: {
    authority: [
      {
        ruleId: "read-assigned-phone-provider-service",
        capability: {
          kind: "exact" as const,
          key: "workspace-service:phone.provisioning",
        },
        resource: { kind: "exact" as const, key: phoneProvider },
        tier: "gated" as const,
        decision: "once" as const,
      },
      {
        ruleId: "read-assigned-phone-providers",
        capability: {
          kind: "prefix" as const,
          prefix: "userland:workers/phone-provisioning/mobile.devices.read#",
        },
        resource: {
          kind: "exact" as const,
          key: `mobile-device:${phoneProvider}`,
        },
        tier: "gated" as const,
        decision: "once" as const,
      },
    ],
  },
};

export const managedPhoneSetupTests: TestCase[] = [
  {
    ...settings,
    name: phoneSetupUnavailable.id,
    description:
      "Hold phone setup after reading the live account's empty eligible desktop list",
    prompt: phoneSetupUnavailable.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedPhoneSetup(
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected authored phone setup");
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
          managedPhoneSetup: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const verification = result.diagnostics?.["managedPhoneSetup"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification,
      };
    },
  },
  {
    ...settings,
    name: "phone-setup-oracle-qualification",
    description:
      "Verify live read access to the phone provider and reject a foreign assignment",
    prompt: "Inspect the headless account's iOS desktop providers.",
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedPhoneSetup(
        true,
        context.signal,
      );
      if (run.kind !== "reference")
        throw new Error("Qualification invoked a teacher");
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { phoneSetupQualification: run.result },
      };
    },
    validate(result) {
      const qualification = result.diagnostics?.["phoneSetupQualification"] as
        | Qualification
        | undefined;
      return {
        passed: Boolean(
          qualification?.verification.passed &&
          qualification.rejectsForeignReceipt,
        ),
        details: qualification,
      };
    },
  },
];
