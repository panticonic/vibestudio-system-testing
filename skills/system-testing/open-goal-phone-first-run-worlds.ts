type Action =
  | "record-ready-evidence"
  | "wait-workspace"
  | "review-startup-failure"
  | "hold-owner"
  | "choose-desktop"
  | "review-release"
  | "review-source"
  | "open-owned-desktop"
  | "continue-existing-install"
  | "inspect-native-evidence";
type Desktop = "linux-source" | "linux-release" | "mac-source" | "mac-release";
type Session =
  | "missing"
  | "await-approval"
  | "reconciled"
  | "disconnected"
  | "owned-error"
  | "reconcile-error"
  | "starting";
type Logs =
  | "none"
  | "older"
  | "connected"
  | "shell"
  | "both"
  | "panel"
  | "login-error"
  | "webview-error"
  | "corrupt"
  | "foreign-process";
type Profile = {
  platform?: "android" | "ios";
  mode?: "auto" | "release" | "source";
  providers?: Desktop[];
  selected?: Desktop;
  paired?: "assigned" | "foreign" | "wrong-workspace";
  session?: Session;
  installed?: "absent" | "release" | "internal";
  logs?: Logs;
  expected: {
    action: Action;
    ready?: "opening" | "ready" | "failed";
    phases?:
      | "unavailable"
      | "rejected"
      | "await-shell"
      | "await-connection"
      | "complete"
      | "failed";
    eligible?: Desktop[];
  };
};
function candidate(
  id: string,
  split: "train" | "test",
  name: string,
  goal: string,
  profile: Profile,
) {
  return {
    id: `phone-first-run-${id}`,
    sourceGroup: `vibestudio:phone-first-run:${id}`,
    split,
    workspace: "system",
    kind: "phoneFirstRun",
    name,
    goal,
    ...profile,
  } as const;
}

export const openPhoneFirstRunWorlds = [
  candidate(
    "radio-paired-no-visible-session",
    "train",
    "Radio Install",
    "Radio Install previously paired its field phone, but there is no visible workspace to resume yet. Work out how to continue setup without making another invite or reinstalling.",
    {
      paired: "assigned",
      session: "missing",
      expected: { action: "wait-workspace", ready: "opening" },
    },
  ),
  candidate(
    "script-desk-await-owner-approval",
    "train",
    "Script Desk Phone",
    "The Script Desk phone opened the shell and connected, but its own workspace is still awaiting first-run approval. Check the retained handset and tell me what it is safe to do next.",
    {
      paired: "assigned",
      session: "await-approval",
      logs: "both",
      expected: {
        action: "wait-workspace",
        ready: "opening",
        phases: "complete",
      },
    },
  ),
  candidate(
    "reconciled-but-transport-lost",
    "train",
    "Equipment Register",
    "Equipment Register was reconciled on the phone before the transport dropped. Does the prior reconciliation prove initial setup is still ready? Keep the existing pairing.",
    {
      paired: "assigned",
      session: "disconnected",
      logs: "both",
      expected: {
        action: "wait-workspace",
        ready: "opening",
        phases: "complete",
      },
    },
  ),
  candidate(
    "archive-visible-failure-despite-shell",
    "train",
    "Archive Intake",
    "Archive Intake's phone has startup markers from the assigned process, but its visible workspace reports an error. Establish which evidence controls the handoff, without trying another install.",
    {
      paired: "assigned",
      session: "owned-error",
      logs: "both",
      expected: {
        action: "review-startup-failure",
        ready: "failed",
        phases: "complete",
      },
    },
  ),
  candidate(
    "presenter-reconciled-fixture",
    "train",
    "Presenter Phone",
    "Can the retained Presenter Phone rehearsal be signed off at the workspace-ready step? Check both its own visible session evidence and the setup receipt. This is the rehearsal record, not a live phone check.",
    {
      paired: "assigned",
      session: "reconciled",
      logs: "panel",
      expected: {
        action: "record-ready-evidence",
        ready: "ready",
        phases: "complete",
      },
    },
  ),
  candidate(
    "not-the-assigned-workspace",
    "train",
    "Floor Marshal",
    "The Floor Marshal phone is paired to this account, but the handoff may refer to another workspace. Check whether its ready message applies before marking this workspace prepared.",
    {
      paired: "wrong-workspace",
      session: "reconciled",
      logs: "both",
      expected: { action: "hold-owner", phases: "complete" },
    },
  ),
  candidate(
    "retained-foreign-phone",
    "train",
    "Gallery Phone",
    "The Gallery Phone's setup note includes an already paired device with a familiar label. Confirm whether that pairing belongs to our assigned account. Stop before reading readiness if it does not.",
    {
      paired: "foreign",
      session: "reconciled",
      expected: { action: "hold-owner" },
    },
  ),
  candidate(
    "android-source-no-eligible-host",
    "train",
    "Sketchbook Dev Phone",
    "Sketchbook Dev Phone needs the internal source build for Android. The only assigned desktop may lack a full source checkout. Confirm whether it is eligible before suggesting any installation.",
    {
      mode: "source",
      providers: ["linux-release"],
      expected: { action: "open-owned-desktop" },
    },
  ),
  candidate(
    "ios-release-owned-mac",
    "train",
    "Curator iPhone",
    "Find a safe iOS release setup path for the Curator iPhone with the current desktop eligibility. Confirm that we're looking at the declared iOS route and leave installation for the owner.",
    {
      platform: "ios",
      mode: "release",
      providers: ["linux-source", "mac-release"],
      expected: { action: "review-release", eligible: ["mac-release"] },
    },
  ),
  candidate(
    "ios-source-on-linux",
    "train",
    "iOS Source Review",
    "For iOS Source Review I need a compatible development route, not just a Mac label from an old note. Check the retained Linux desktop and the actual System React Native source declaration before choosing a next step.",
    {
      platform: "ios",
      mode: "source",
      providers: ["linux-source"],
      expected: { action: "open-owned-desktop" },
    },
  ),
  candidate(
    "two-source-providers",
    "train",
    "Depot Android Setup",
    "Two desktops may be able to prepare the Depot Android internal build. Compare their exact eligibility so I know what I must choose, and keep both desks untouched.",
    {
      mode: "source",
      providers: ["linux-source", "mac-source"],
      expected: {
        action: "choose-desktop",
        eligible: ["linux-source", "mac-source"],
      },
    },
  ),
  candidate(
    "retired-owner-desktop",
    "train",
    "Remote Training Phone",
    "Use the assigned desktop for Remote Training Phone only if the exact provider is still listed. A different current desktop should not inherit that task even if its platform matches.",
    {
      selected: "linux-source",
      providers: ["mac-source"],
      expected: { action: "open-owned-desktop" },
    },
  ),
  candidate(
    "native-error-after-startup",
    "train",
    "Volunteer Device",
    "The Volunteer Device's debug excerpt suggests a connection completed, then the WebView failed. Explain what the exact excerpt can establish before opening a setup request.",
    {
      logs: "webview-error",
      expected: { action: "review-startup-failure", phases: "failed" },
    },
  ),
  candidate(
    "source-engine-log-corruption",
    "train",
    "Robotics Dev Kit",
    "The Robotics Dev Kit's owned debug excerpt mentions a corrupt payload during startup. Use the native parser and the actual React Native declaration to identify what to inspect. Don't decide from an app-running indicator.",
    {
      logs: "corrupt",
      mode: "source",
      providers: ["linux-source"],
      expected: {
        action: "review-startup-failure",
        phases: "failed",
        eligible: ["linux-source"],
      },
    },
  ),
  candidate(
    "shell-only-excerpt",
    "train",
    "Shift Phone",
    "Can a shell-ready marker alone sign off Shift Phone's first run? Separate the observed phase evidence from what still needs verification on the assigned desktop.",
    {
      logs: "shell",
      providers: ["linux-release"],
      expected: {
        action: "inspect-native-evidence",
        phases: "await-connection",
        eligible: ["linux-release"],
      },
    },
  ),
  candidate(
    "old-epoch-cannot-sign-off",
    "train",
    "Green Room Handset",
    "Green Room Handset's latest log window may only contain yesterday's startup. Determine whether it is usable for this attempt and what evidence is still required without treating the old run as current.",
    {
      logs: "older",
      providers: ["linux-release"],
      expected: {
        action: "inspect-native-evidence",
        eligible: ["linux-release"],
        phases: "await-shell",
      },
    },
  ),
  candidate(
    "fresh-android-release",
    "train",
    "Wardrobe Release",
    "Wardrobe Release wants ordinary Android setup, not a development build. Compare the selected desktop's declared eligibility with the absence of an installed package and tell me the clean release path to review.",
    {
      providers: ["linux-release"],
      installed: "absent",
      expected: { action: "review-release", eligible: ["linux-release"] },
    },
  ),
  candidate(
    "compatible-package-setup-only",
    "train",
    "Staging Rehearsal Phone",
    "Staging Rehearsal Phone already has the compatible release package in its retained inventory. Explain the next setup step without reinstalling or filing a source-build request.",
    {
      installed: "release",
      providers: ["mac-release"],
      expected: {
        action: "continue-existing-install",
        eligible: ["mac-release"],
      },
    },
  ),
  candidate(
    "internal-escalation-candidate",
    "train",
    "Timing Audit Phone",
    "Timing Audit Phone needs the internal Android build for the approved developer workflow. The rehearsal records an owned source-capable desktop and a release app on the target. Identify the exact escalation that would need review, without installing software.",
    {
      mode: "source",
      installed: "release",
      providers: ["linux-source"],
      expected: { action: "review-source", eligible: ["linux-source"] },
    },
  ),
  candidate(
    "different-process-excerpt",
    "train",
    "Localisation Lab",
    "The startup excerpt beside Localisation Lab may belong to another process. Check whether we can use its otherwise healthy markers when deciding how far this assigned rehearsal reached.",
    {
      logs: "foreign-process",
      paired: "assigned",
      session: "starting",
      expected: {
        action: "inspect-native-evidence",
        phases: "rejected",
        ready: "opening",
      },
    },
  ),
  candidate(
    "held-ios-source-specific-owner",
    "test",
    "Orchard iPhone Build",
    "Two desktops are known to Orchard iPhone Build, but the approved source route names one Mac. Confirm that exact provider and where React Native is configured before asking for iOS development approval.",
    {
      platform: "ios",
      mode: "source",
      selected: "mac-source",
      providers: ["mac-release", "mac-source"],
      expected: { action: "review-source", eligible: ["mac-source"] },
    },
  ),
  candidate(
    "held-exact-reconciled-no-invite",
    "test",
    "Intake Rehearsal",
    "Someone proposed a new pairing invitation for Intake Rehearsal after the phone was already paired. Check the visible reconciled session in its retained rehearsal and settle whether the workspace-ready step has already passed.",
    {
      paired: "assigned",
      session: "reconciled",
      expected: { action: "record-ready-evidence", ready: "ready" },
    },
  ),
  candidate(
    "held-login-error-trumps-readiness-marker",
    "test",
    "Badge Reader Phone",
    "Badge Reader Phone's native phase excerpt includes a login error after a ready signal. Check what the exact rehearsal actually supports and keep its original pairing while diagnosing the conflict.",
    {
      paired: "assigned",
      session: "await-approval",
      logs: "login-error",
      expected: {
        action: "review-startup-failure",
        phases: "failed",
        ready: "opening",
      },
    },
  ),
  candidate(
    "held-connection-only-not-shell-proof",
    "test",
    "Council Handset",
    "Council Handset can connect to the workspace server, but I don't have a shell-ready observation. Tell me which startup phase is still missing and leave the rehearsal disconnected from device actions.",
    {
      logs: "connected",
      expected: { action: "inspect-native-evidence", phases: "await-shell" },
    },
  ),
  candidate(
    "held-internal-existing-compatible",
    "test",
    "Meter Developer Phone",
    "Meter Developer Phone already has the compatible internal build according to its exact rehearsal inventory. Check the selected Android source-capable desktop and recommend the remaining setup work without queuing a duplicate install.",
    {
      mode: "source",
      installed: "internal",
      providers: ["linux-source"],
      expected: {
        action: "continue-existing-install",
        eligible: ["linux-source"],
      },
    },
  ),
  candidate(
    "held-reconciliation-failure",
    "test",
    "Map Booth Handset",
    "Map Booth Handset's container is open and its radio is connected, but its visible first-run reconciliation failed. Work through the retained receipt and tell me what is still blocked without repairing the device.",
    {
      paired: "assigned",
      session: "reconcile-error",
      logs: "connected",
      expected: {
        action: "review-startup-failure",
        ready: "failed",
        phases: "await-shell",
      },
    },
  ),
] as const;

export type PhoneFirstRunWorld = (typeof openPhoneFirstRunWorlds)[number];
