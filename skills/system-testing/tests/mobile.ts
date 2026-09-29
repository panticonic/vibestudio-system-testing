import { PhoneProvisioningResultSchema, PhoneWorkspaceReadinessSchema } from "@vibestudio/service-schemas/phoneProvisioning";
import { requiringUnits } from "../types.js";
import type { TestCase } from "../types.js";
import {
  completedScenarioEvidence,
  findLastAgentMessage,
  requireCodeOperations,
  walkRecords,
} from "../scenario-validation.js";

export const mobileTests: TestCase[] = requiringUnits(
  ["workers/phone-provisioning"],
  [
    {
      name: "onboarding-desktop-mobile-install-android",
      description:
        "Install and immediately pair the mobile client through onboarding, a connected Electron desktop, and an attached Android device",
      category: "mobile",
      // A cold source install can legitimately consume ten minutes and the
      // readiness probe owns a further three-minute deadline. Keep enough room
      // for model/tool orchestration before those real operations begin.
      timeoutMs: 25 * 60_000,
      resources: ["mobile:android-device"],
      // This scenario crosses real desktop, USB, signaling, and phone boundaries.
      // Its structured tool results are harness-observed protocol evidence, so a
      // prose completion report cannot be the pass/fail authority.
      validation: "harness",
      authorityPolicy: {
        authority: [
          {
            ruleId: "onboarding-desktop-phone-service",
            capability: {
              kind: "exact",
              key: "workspace-service:phone.provisioning",
            },
            resource: {
              kind: "exact",
              key: "do:workers/phone-provisioning:PhoneProvisioningDO:workspace-phone-provisioning",
            },
            tier: "gated",
            decision: "once",
          },
          {
            ruleId: "onboarding-desktop-mobile-discovery",
            capability: {
              kind: "prefix",
              prefix:
                "userland:workers/phone-provisioning/mobile.devices.read#",
            },
            resource: {
              kind: "exact",
              // The worker declares resourceType "mobile-device" for both userland
              // capabilities, so that — not "phone" — is the prompt's resource
              // prefix. A rule keyed to "phone:" matched no prompt this surface
              // raises, and the scenario failed on its own subject.
              key: "mobile-device:do:workers/phone-provisioning:PhoneProvisioningDO:workspace-phone-provisioning",
            },
            tier: "gated",
            decision: "once",
          },
          {
            ruleId: "onboarding-desktop-mobile-provision",
            capability: {
              kind: "prefix",
              prefix: "userland:workers/phone-provisioning/mobile.provision#",
            },
            resource: {
              kind: "exact",
              key: "mobile-device:do:workers/phone-provisioning:PhoneProvisioningDO:workspace-phone-provisioning",
            },
            tier: "gated",
            decision: "once",
          },
        ],
      },
      prompt: [
        "Set up Vibestudio on the Android device attached to my connected desktop.",
        "Install the compatible app if needed, pair the phone, and make sure it finishes connecting to its workspace.",
        "Tell me whether setup completed and whether the phone now appears as a paired device.",
      ].join(" "),
      validate: (result) => {
        const base = completedScenarioEvidence(result);
        if (!base.passed) return base;
        const exercised = requireCodeOperations(base.evidence.evalCode, [
          [
            "vibestudio.phone-provisioning.v1",
            "resolveService",
            '"providers"',
            '"devices"',
            '"provision"',
            "extensions.invoke",
            "mobile-debug",
            "verifyWorkspaceReady",
          ],
          [
            "@workspace-skills/phone-setup",
            "phoneSetup",
            ".providers(",
            ".prepare(",
            ".devices(",
            ".provision(",
            ".waitForWorkspace(",
            "extensions.invoke",
            "mobile-debug",
            "verifyWorkspaceReady",
          ],
        ]);
        if (!exercised.passed) return exercised;

        const records = walkRecords(base.evidence.evalValues);
        const provisioned = records.some((record) => {
          const parsed = PhoneProvisioningResultSchema.safeParse(record);
          return parsed.success && parsed.data.platform === "android";
        });
        const publicWorkspaceReady = records.some((record) => {
          const parsed = PhoneWorkspaceReadinessSchema.safeParse(record);
          return parsed.success && parsed.data.status === "ready";
        });
        const workspaceReady = records.some(
          (record) =>
            record["ready"] === true &&
            record["workspaceConnected"] === true &&
            record["panelHostReady"] === true &&
            Array.isArray(record["issues"]) &&
            record["issues"].length === 0,
        );
        if (!provisioned || !workspaceReady || !publicWorkspaceReady) {
          return {
            passed: false,
            reason:
              "Provisioning results did not prove install compatibility, pairing, a paired Android hub device, and a ready mobile workspace host",
          };
        }

        // This is a harness verdict over observed protocol facts. The base
        // check already requires a completed, non-empty agent response; its
        // wording must not override successfully verified provisioning.
        return { passed: true };
      },
    },
    {
      name: "mobile-extension-install-android",
      description:
        "Install and launch the development mobile client on the attached Android device through sandboxed eval and the mobile-debug extension",
      category: "mobile",
      resources: ["mobile:android-device"],
      authorityPolicy: {
        authority: [
          {
            ruleId: "mobile-native-execution",
            capability: {
              kind: "prefix",
              prefix: "userland:extensions/mobile-debug/native.mobile.execute#",
            },
            resource: {
              kind: "exact",
              key: "native.mobile:extension:@workspace-extensions/mobile-debug",
            },
            tier: "gated",
            decision: "once",
          },
        ],
      },
      prompt: [
        "Install a fresh development Vibestudio mobile client on the single attached ready Android phone or emulator, reset its app data, and launch it.",
        "Confirm that the app is installed and visibly running on that device, then tell me what happened.",
      ].join(" "),
      validate: (result) => {
        const base = completedScenarioEvidence(result);
        if (!base.passed) return base;
        const exercised = requireCodeOperations(base.evidence.evalCode, [
          ["extensions.invoke", "mobile-debug", "installAndroid", "verify"],
        ]);
        if (!exercised.passed) return exercised;

        const records = walkRecords(base.evidence.evalValues);
        const installedPackage = records.some(
          (record) =>
            record["packageName"] === "app.vibestudio.mobile.internal",
        );
        const verified = records.some(
          (record) =>
            record["installed"] === true &&
            record["rendering"] === true &&
            Array.isArray(record["issues"]) &&
            record["issues"].length === 0,
        );
        if (!installedPackage || !verified) {
          return {
            passed: false,
            reason:
              "Extension results did not prove that the internal package was installed, launched, and rendering without issues",
          };
        }

        const final = findLastAgentMessage(result);
        return /android|emulator|device/iu.test(final) &&
          /app\.vibestudio\.mobile\.internal/u.test(final) &&
          /install/iu.test(final) &&
          /render/iu.test(final)
          ? { passed: true }
          : {
              passed: false,
              reason:
                "Final response omitted the selected device, package, install, or rendering evidence",
            };
      },
    },
  ],
);
