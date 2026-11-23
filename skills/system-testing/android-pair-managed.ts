import { requireAssignedWorld } from "./assigned-world.js";
import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type { phoneSetup } from "@workspace-skills/phone-setup";
import type { bindInstalledMobileScenario } from "../mobile-system-testing/live-bindings.js";
import type {
  MobileAssignment, MobileInventory, MobileReport, PairReceipt, WorkspaceReadback,
} from "../mobile-system-testing/scenario/types.js";
import { androidPairWorlds } from "./android-pair-worlds.js";

type Input = { contextId: string; caseId: string };
type Phone = Awaited<ReturnType<typeof phoneSetup>>;

export async function prepareManagedAndroidPair(
  input: Input,
  workspace: string,
  phone: Phone,
  bind: typeof bindInstalledMobileScenario,
  assignment?: { id: string; goal: string; mode: (typeof androidPairWorlds)[number]["mode"] },
) {
  const world = requireAssignedWorld(assignment ? [assignment] : androidPairWorlds, input.caseId, "Unknown Android pairing case");
  const providers = (await phone.providers()).filter(({ platforms }) => platforms.includes("android"));
  if (providers.length !== 1)
    throw new Error("Connect exactly one desktop that can provision the Android emulator");
  const provider = providers[0]!.providerId;
  const discovered = await phone.devices(provider, "android");
  const emulators = discovered.devices.filter((device) =>
    device.providerId === provider && device.platform === "android" &&
      device.kind === "emulator" && device.ready,
  );
  if (emulators.length !== 1 || !emulators[0]!.compatibleAppInstalled)
    throw new Error("Connect a single disposable Android emulator with a compatible Vibestudio app");
  const owned = emulators[0]!.deviceId;
  const missing = owned === "emulator-5554" ? "emulator-5556" : "emulator-5554";
  if (discovered.devices.some(({ deviceId }) => deviceId === missing))
    throw new Error("The assigned missing Android target must be absent");
  const target = world.mode === "missing" ? missing : owned;
  const request: MobileAssignment = {
    goal: world.goal, workspace, scenario: "pair", deviceId: target,
    authority: world.mode === "inspect" ? "inspect" : "execute", reset: false,
  };
  const scope = bind(request, { workspace, provider, foreground: true, tooling: true });
  const inventories: MobileInventory[] = [];
  const pairings: (PairReceipt | null)[] = [];
  const readings: (WorkspaceReadback | null)[] = [];
  const services = {
    mobileInventory: {
      async read() {
        const value = await scope.mobileInventory.read();
        inventories.push(structuredClone(value));
        return value;
      },
    },
    mobilePairing: {
      async pair(deviceId: string) {
        const value = await scope.mobilePairing.pair(deviceId);
        pairings.push(structuredClone(value));
        return value;
      },
    },
    mobileWorkspace: {
      async read(pairedDevice: string) {
        const value = await scope.mobileWorkspace.read(pairedDevice);
        readings.push(structuredClone(value));
        return value;
      },
    },
  };

  async function verify(report: MobileReport | null) {
    const inventory = inventories[0], receipt = pairings[0] ?? null, observed = readings[0] ?? null;
    const current = receipt ? await phone.readiness(receipt.pairedDevice) : null;
    const validReceipt = receipt !== null && receipt.provider === provider &&
      receipt.workspace === workspace && receipt.attachedDevice === owned &&
      receipt.pairedDevice !== owned && !!receipt.pairedDevice && receipt.install === "already-compatible";
    const checks = {
      inventory: inventories.length >= 1 && inventory?.workspace === workspace &&
        inventory.provider === provider && inventory.tooling && inventory.foreground &&
        isDeepStrictEqual(inventory.devices, world.mode === "missing" ? [] : [{ id: owned, state: "ready" }]),
      pairing: world.mode === "pair" ? pairings.length === 1 && validReceipt : pairings.length === 0,
      readiness: world.mode === "pair"
        ? readings.length >= 1 && observed?.pairedDevice === receipt?.pairedDevice &&
          observed?.status === "ready" && current?.status === "ready" && !!observed.message
        : readings.length === 0,
      report: world.mode === "pair"
        ? report?.status === "paired-ready" && report.deviceId === owned &&
          isDeepStrictEqual(report.receipt, receipt) && isDeepStrictEqual(report.readback, observed)
        : world.mode === "inspect"
          ? report?.status === "target-ready" && report.deviceId === owned
          : report?.status === "blocked" && report.blocker === "no-device" &&
            report.deviceId === target && !!report.next.trim(),
    };
    return { ...input, request, provider, owned, inventory, receipt, observed, current, checks, passed: Object.values(checks).every(Boolean) };
  }

  async function qualify() {
    await services.mobileInventory.read();
    if (world.mode === "inspect")
      return verify({ status: "target-ready", deviceId: owned });
    if (world.mode === "missing")
      return verify({ status: "blocked", blocker: "no-device", deviceId: missing, next: "Connect the specified emulator." });
    const receipt = await services.mobilePairing.pair(owned);
    if (!receipt) throw new Error("The desktop returned a pairing receipt outside the assigned workspace or target");
    const readback = await services.mobileWorkspace.read(receipt.pairedDevice);
    if (!readback) throw new Error("The paired device produced no workspace readiness receipt");
    return verify({ status: "paired-ready", deviceId: owned, receipt, readback });
  }
  return { request, services, qualify, verify };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedAndroidPair>>;
export interface AndroidPairReceiver {
  runAndroidPairTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyAndroidPair(input: Input): ReturnType<Prepared["qualify"]>;
}
export const androidPairMethods = createReceiverRpcMethods<AndroidPairReceiver>([
  "runAndroidPairTeacher", "qualifyAndroidPair",
]);
