function audit(
  id: string,
  split: "train" | "test",
  goal: string,
  mode: "target" | "foreign" | "application",
  expectedStatus?: "app-absent" | "process-absent" | "workspace-unverified",
) {
  return {
    id: "android-audit-" + id,
    sourceGroup: "vibestudio:android-audit:" + id,
    kind: "android-audit",
    workspace: "system",
    split,
    goal,
    mode,
    expectedStatus,
    requiresAndroidEmulator: true,
  } as const;
}

export const openAndroidAuditWorlds = [
  audit("record-assigned-connection", "train",
    "The operator just changed which disposable Android emulator is on the bench. Confirm the assigned connection before posting the desk handoff. Leave the internal app and its display alone.",
    "target"),
  audit("blank-image-before-internal-build", "train",
    "Check whether the assigned fresh Android emulator already has our internal app. If it isn't installed, report the package evidence and leave the emulator ready for a separate install request.",
    "application", "app-absent"),
  audit("installed-copy-between-shifts", "train",
    "The internal client was left shut down between shifts. Check the assigned emulator and distinguish an installed package from a running process. Keep it stopped for the next operator.",
    "application", "process-absent"),
  audit("held-previous-bench-coordinate", "test",
    "The handoff names the emulator from the previous bench. Check for our internal app only if that exact emulator is reachable. A different connected Android target is outside this review.",
    "foreign"),
  audit("held-process-and-display-do-not-certify-workspace", "test",
    "For the assigned running test emulator, verify the internal app process and whether we have a captured device display. The handoff calls the workspace ready. Tell me what the device evidence actually supports without opening a workspace or changing the app.",
    "application", "workspace-unverified"),
];
