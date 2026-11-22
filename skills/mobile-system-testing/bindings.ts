import type {
  AppReadback,
  InstallReceipt,
  MobileAssignment,
  MobileInventory,
  PairReceipt,
  WorkspaceReadback,
} from "./scenario/types.js";

export const INTERNAL_PACKAGE = "app.vibestudio.mobile.internal";

export type MobilePorts = {
  inventory(): Promise<MobileInventory>;
  pair(deviceId: string, provider: string): Promise<PairReceipt>;
  workspace(pairedDevice: string): Promise<WorkspaceReadback>;
  install(deviceId: string, reset: boolean): Promise<InstallReceipt>;
  app(deviceId: string, packageName: string): Promise<AppReadback>;
};

export type MobileScenarioBinder = (
  assignment: MobileAssignment,
  presence: Omit<MobileInventory, "devices">,
  signal?: AbortSignal,
) => ReturnType<typeof bindMobileScenario>;

/** Bind one attempt to a caller-owned request and the receiver's observed target. */
export function bindMobileScenario(
  request: MobileAssignment,
  ports: MobilePorts,
) {
  const scope = { ...request };
  let discovery: Promise<MobileInventory> | undefined;
  let dispatched = false;
  let inspected = false;
  let pairReceipt: PairReceipt | undefined;
  let installReceipt: InstallReceipt | undefined;

  async function authorize(
    deviceId: string,
    scenario: MobileAssignment["scenario"],
  ) {
    if (
      !discovery ||
      dispatched ||
      scope.authority !== "execute" ||
      scope.scenario !== scenario
    )
      throw new Error(
        "Inspect the assigned inventory before issuing its single authorized Android operation.",
      );
    const inventory = await discovery;
    const matches = inventory.devices.filter((device) =>
      scope.deviceId !== null
        ? device.id === scope.deviceId
        : device.state === "ready",
    );
    if (
      dispatched ||
      inventory.workspace !== scope.workspace ||
      !inventory.foreground ||
      !inventory.tooling ||
      (scenario === "pair" && !inventory.provider) ||
      matches.length !== 1 ||
      matches[0]?.state !== "ready" ||
      matches[0].id !== deviceId
    )
      throw new Error(
        "Use the exact authorized foreground device reported by the assigned workspace.",
      );
    dispatched = true;
    return inventory;
  }

  return {
    mobileInventory: {
      async read() {
        const value = await (discovery ??= ports.inventory());
        return structuredClone(value);
      },
    },
    mobilePairing: {
      async pair(deviceId: string) {
        const inventory = await authorize(deviceId, "pair");
        const receipt = await ports.pair(deviceId, inventory.provider!);
        if (
          receipt.attachedDevice !== deviceId ||
          receipt.provider !== inventory.provider ||
          receipt.workspace !== scope.workspace ||
          !receipt.pairedDevice ||
          !["installed", "already-compatible"].includes(receipt.install)
        )
          return null;
        pairReceipt = { ...receipt };
        return { ...pairReceipt };
      },
    },
    mobileWorkspace: {
      async read(pairedDevice: string) {
        if (
          inspected ||
          !pairReceipt ||
          pairReceipt.pairedDevice !== pairedDevice
        )
          throw new Error(
            "Read the workspace for the paired device from this attempt.",
          );
        inspected = true;
        const result = await ports.workspace(pairedDevice);
        return result.pairedDevice === pairedDevice ? result : null;
      },
    },
    mobileDevelopment: {
      async install(deviceId: string) {
        await authorize(deviceId, "development");
        const receipt = await ports.install(deviceId, scope.reset);
        if (
          receipt.deviceId !== deviceId ||
          receipt.packageName !== INTERNAL_PACKAGE ||
          receipt.reset !== scope.reset
        )
          return null;
        installReceipt = { ...receipt };
        return { ...installReceipt };
      },
    },
    mobileApp: {
      async verify(deviceId: string, packageName: string) {
        if (
          inspected ||
          !installReceipt ||
          installReceipt.deviceId !== deviceId ||
          installReceipt.packageName !== packageName
        )
          throw new Error(
            "Verify the exact device and package from this installation.",
          );
        inspected = true;
        const result = await ports.app(deviceId, packageName);
        return result.deviceId === deviceId &&
          result.packageName === packageName
          ? result
          : null;
      },
    },
  };
}
