import type {
  AppReadback,
  InstallReceipt,
  MobileAssignment,
  MobileBlocker,
  MobileInventory,
  MobileReport,
  PairReceipt,
  WorkspaceReadback,
} from "../mobile-system-testing/scenario/types.js";

type Expected = {
  status: MobileReport["status"];
  blocker?: MobileBlocker;
  deviceId: string | null;
  operations: string[];
};
export type MobileWorld = {
  id: string;
  request: MobileAssignment;
  inventory: MobileInventory;
  pair: PairReceipt;
  workspace: WorkspaceReadback;
  install: InstallReceipt;
  app: AppReadback;
  expected: Expected;
};

const workspaceId = "field-lab";
const provider = "lab-desktop";
const android = "bench-phone";
const paired = "paired-bench";
const packageName = "app.vibestudio.mobile.internal";
const ready = { id: android, state: "ready" } as const;
const emulator = { id: "emulator-5554", state: "ready" } as const;
const offline = { id: "detached-phone", state: "offline" } as const;
const unauthorized = { id: "awaiting-trust", state: "unauthorized" } as const;
const inventory: MobileInventory = {
  workspace: workspaceId,
  provider,
  foreground: true,
  tooling: true,
  devices: [ready],
};

const pair: PairReceipt = {
  provider,
  workspace: workspaceId,
  attachedDevice: android,
  pairedDevice: paired,
  install: "installed",
};
const workspace: WorkspaceReadback = {
  pairedDevice: paired,
  status: "ready",
  message: "Panel host connected.",
};
const install: InstallReceipt = { deviceId: android, packageName, reset: true };
const app: AppReadback = {
  deviceId: android,
  packageName,
  installed: true,
  bundleActive: true,
  rendering: true,
  screenshotBytes: 120384,
  issues: [],
};

const discover = ["inventory"];
const provision = [...discover, `pair:${android}:${provider}`];
const verifyPair = [...provision, `workspace:${paired}`];
const installOnly = [...discover, `install:${android}:true`];
const verifyApp = [...installOnly, `app:${android}:${packageName}`];

function caseOf(
  id: string,
  goal: string,
  expected: Expected,
  config: Partial<
    Omit<MobileWorld, "id" | "request" | "expected" | "inventory">
  > & {
    request?: Partial<MobileAssignment>;
    inventory?: Partial<MobileInventory>;
  } = {},
): MobileWorld {
  const { request, inventory: sightings, ...receipts } = config;
  return {
    id: `mobile-system-${id}`,
    request: {
      goal,
      workspace: workspaceId,
      scenario: "pair",
      deviceId: null,
      authority: "execute",
      reset: false,
      ...request,
    },
    inventory: { ...inventory, ...sightings },
    pair,
    workspace,
    install,
    app,
    ...receipts,
    expected,
  };
}

function blocked(
  blocker: MobileBlocker,
  deviceId: string | null = null,
  operations = discover,
): Expected {
  return { status: "blocked", blocker, deviceId, operations };
}

export const mobileScenarioWorlds = [
  caseOf(
    "pair-new",
    "Set up the sole attached Android phone and verify that its workspace opens.",
    { status: "paired-ready", deviceId: android, operations: verifyPair },
  ),
  caseOf(
    "explicit-compatible",
    "Use the explicitly assigned bench device even with a ready emulator beside it. Verify the existing compatible install through pairing.",
    { status: "paired-ready", deviceId: android, operations: verifyPair },
    {
      request: { deviceId: android },
      inventory: { devices: [emulator, ready] },
      pair: { ...pair, install: "already-compatible" },
    },
  ),
  caseOf(
    "wrong-workspace",
    "Check the requested lab setup while only the ordinary workspace is open.",
    blocked("wrong-workspace"),
    { inventory: { workspace: "ordinary" } },
  ),
  caseOf(
    "tooling-missing",
    "Diagnose the correct workspace after its mobile provisioning worker failed its build.",
    blocked("missing-tooling"),
    { inventory: { tooling: false } },
  ),
  caseOf(
    "background-install",
    "Decide whether the development reinstall can run from this detached session.",
    blocked("foreground-required"),
    {
      request: { scenario: "development", reset: true },
      inventory: { foreground: false },
    },
  ),
  caseOf(
    "desktop-disconnected",
    "Pair the bench phone if its desktop is available.",
    blocked("no-provider"),
    { inventory: { provider: null } },
  ),
  caseOf(
    "no-cable",
    "Find out why no device can be paired even though the desktop provider is connected.",
    blocked("no-device"),
    { inventory: { devices: [] } },
  ),
  caseOf(
    "ambiguous",
    "The phone and emulator are both ready. Proceed only if the assignment identifies one of them.",
    blocked("ambiguous-device"),
    { inventory: { devices: [ready, emulator] } },
  ),
  caseOf(
    "specific-offline",
    "Check the assigned offline handset. The ready emulator is a different test target.",
    blocked("device-offline", offline.id),
    {
      request: { deviceId: offline.id },
      inventory: { devices: [ready, offline] },
    },
  ),
  caseOf(
    "awaiting-trust",
    "Determine what USB action the assigned handset still needs before setup.",
    blocked("device-unauthorized", unauthorized.id),
    {
      request: { deviceId: unauthorized.id },
      inventory: { devices: [unauthorized, ready] },
    },
  ),
  caseOf(
    "inspect-only",
    "Identify the only ready device during review. Do not pair it.",
    { status: "target-ready", deviceId: android, operations: discover },
    {
      request: { authority: "inspect" },
      inventory: { foreground: false, devices: [offline, ready] },
    },
  ),
  caseOf(
    "receipt-other-usb",
    "Hold setup if the paired receipt refers to a different attached phone.",
    blocked("invalid-receipt", android, provision),
    { pair: { ...pair, attachedDevice: offline.id } },
  ),
  caseOf(
    "opening-after-pair",
    "Install and pair once, then report the workspace's actual progress.",
    blocked("workspace-opening", android, verifyPair),
    {
      workspace: {
        ...workspace,
        status: "opening",
        message: "Workspace approval pending.",
      },
    },
  ),
  caseOf(
    "workspace-error",
    "Report the reason the existing pairing has not reached a working workspace.",
    blocked("workspace-failed", android, verifyPair),
    {
      workspace: {
        ...workspace,
        status: "failed",
        message: "Panel host rejected connection.",
      },
    },
  ),
  caseOf(
    "stale-workspace-reply",
    "Decline a workspace-ready response bound to an earlier pairing of another device.",
    blocked("invalid-receipt", android, verifyPair),
    { workspace: { ...workspace, pairedDevice: "earlier-pair" } },
  ),
  caseOf(
    "development-reset",
    "Install, reset, launch, and verify the assigned development Android app.",
    { status: "development-ready", deviceId: android, operations: verifyApp },
    { request: { scenario: "development", reset: true } },
  ),
  caseOf(
    "preserve-data",
    "Install and launch the internal build while retaining current app data.",
    {
      status: "development-ready",
      deviceId: android,
      operations: [
        ...discover,
        `install:${android}:false`,
        `app:${android}:${packageName}`,
      ],
    },
    {
      request: { scenario: "development" },
      install: { ...install, reset: false },
    },
  ),
  caseOf(
    "wrong-package",
    "Verify the internal package only. A release package receipt does not satisfy the test.",
    blocked("invalid-receipt", android, installOnly),
    {
      request: { scenario: "development", reset: true },
      install: { ...install, packageName: "app.vibestudio.mobile" },
    },
  ),
  caseOf(
    "native-not-rendering",
    "After the launch, verify that the installed app actually renders.",
    blocked("app-unverified", android, verifyApp),
    {
      request: { scenario: "development", reset: true },
      app: { ...app, rendering: false, issues: ["WebView did not paint."] },
    },
  ),
  caseOf(
    "screenshot-empty",
    "Require the independent rendering probe to return a nonempty screenshot before accepting the run.",
    blocked("app-unverified", android, verifyApp),
    {
      request: { scenario: "development", reset: true },
      app: { ...app, screenshotBytes: 0 },
    },
  ),
  caseOf(
    "previous-emulator-probe",
    "The readback must come from the assigned handset and package, even if the previous emulator report was fully ready.",
    blocked("invalid-receipt", android, verifyApp),
    {
      request: { scenario: "development", reset: true },
      app: { ...app, deviceId: emulator.id },
    },
  ),
];
