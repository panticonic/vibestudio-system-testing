export type MobileScenario = "pair" | "development";
export type MobileAssignment = {
  goal: string;
  workspace: string;
  scenario: MobileScenario;
  deviceId: string | null;
  authority: "inspect" | "execute";
  reset: boolean;
};
export type MobileDevice = {
  id: string;
  state: "ready" | "unauthorized" | "offline";
};
export type MobileInventory = {
  workspace: string;
  provider: string | null;
  foreground: boolean;
  tooling: boolean;
  devices: MobileDevice[];
};
export type MobileBlocker =
  | "wrong-workspace"
  | "missing-tooling"
  | "foreground-required"
  | "no-provider"
  | "no-device"
  | "ambiguous-device"
  | "device-unauthorized"
  | "device-offline"
  | "invalid-receipt"
  | "workspace-opening"
  | "workspace-failed"
  | "app-unverified";
export type TargetSelection =
  | { status: "ready"; deviceId: string }
  | { status: "blocked"; blocker: MobileBlocker };
export type PairReceipt = {
  provider: string;
  workspace: string;
  attachedDevice: string;
  pairedDevice: string;
  install: "installed" | "already-compatible";
};
export type WorkspaceReadback = {
  pairedDevice: string;
  status: "opening" | "ready" | "failed";
  message: string;
};
export type InstallReceipt = {
  deviceId: string;
  packageName: string;
  reset: boolean;
};
export type AppReadback = {
  deviceId: string;
  packageName: string;
  installed: boolean;
  bundleActive: boolean;
  rendering: boolean;
  screenshotBytes: number;
  issues: string[];
};
export type MobileReport =
  | {
      status: "blocked";
      deviceId: string | null;
      blocker: MobileBlocker;
      next: string;
    }
  | { status: "target-ready"; deviceId: string }
  | {
      status: "paired-ready";
      deviceId: string;
      receipt: PairReceipt;
      readback: WorkspaceReadback;
    }
  | {
      status: "development-ready";
      deviceId: string;
      receipt: InstallReceipt;
      readback: AppReadback;
    };
