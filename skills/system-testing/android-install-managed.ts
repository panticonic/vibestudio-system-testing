import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  bindInstalledMobileScenario,
  inspectInternalAndroidApp,
  listMobileDebugDevices,
} from "../mobile-system-testing/live-bindings.js";
import type {
  AppReadback,
  InstallReceipt,
  MobileAssignment,
  MobileInventory,
  MobileReport,
} from "../mobile-system-testing/scenario/types.js";
import { androidInstallWorlds } from "./android-install-worlds.js";

type Input = { contextId: string; caseId: string };
type NativePorts = {
  bind: typeof bindInstalledMobileScenario;
  inventory: typeof listMobileDebugDevices;
  verifyApp: typeof inspectInternalAndroidApp;
};

export async function prepareManagedAndroidInstall(
  input: Input,
  workspace: string,
  ports: NativePorts,
) {
  const world = androidInstallWorlds.find(({ id }) => id === input.caseId);
  if (!world) throw new Error("Unknown managed Android installation case");
  const devices = await ports.inventory();
  const targets = devices.filter(({ serial, state }) => /^emulator-\d+$/u.test(serial) && state === "device");
  if (targets.length !== 1)
    throw new Error("Connect exactly one ready disposable Android emulator for this case");
  const owned = targets[0]!.serial;
  const missing = owned === "emulator-5554" ? "emulator-5556" : "emulator-5554";
  if (devices.some(({ serial }) => serial === missing))
    throw new Error("The assigned missing target must be absent from the host");
  const before = await ports.verifyApp(owned);
  if (before.installed || before.bundleActive || before.screenshotCaptured)
    throw new Error("The disposable emulator must start without the internal Vibestudio app");

  const foreground = world.mode !== "foreground-hold";
  const request: MobileAssignment = {
    goal: world.goal, workspace, scenario: "development", authority: "execute",
    reset: false, deviceId: world.mode === "target-hold" ? missing : owned,
  };
  const bound = ports.bind(request, { workspace, provider: null, tooling: true, foreground });
  const inventories: MobileInventory[] = [];
  const installs: (InstallReceipt | null)[] = [];
  const readbacks: (AppReadback | null)[] = [];
  const services = {
    mobileInventory: {
      async read() {
        const result = await bound.mobileInventory.read();
        inventories.push(structuredClone(result));
        return result;
      },
    },
    mobileDevelopment: {
      async install(deviceId: string) {
        const result = await bound.mobileDevelopment.install(deviceId);
        installs.push(structuredClone(result));
        return result;
      },
    },
    mobileApp: {
      async verify(deviceId: string, packageName: string) {
        const result = await bound.mobileApp.verify(deviceId, packageName);
        readbacks.push(structuredClone(result));
        return result;
      },
    },
  };

  const installExpected = world.mode === "install";
  const blocker = world.mode === "foreground-hold" ? "foreground-required" : "no-device";
  async function verify(report: MobileReport | null) {
    const after = await ports.verifyApp(owned);
    const inventory = inventories[0], install = installs[0] ?? null, readback = readbacks[0] ?? null;
    const checks = {
      inventory: inventories.length === 1 && inventory?.workspace === workspace &&
        inventory.tooling && inventory.foreground === foreground && inventory.provider === null &&
        isDeepStrictEqual(inventory.devices, installExpected ? [{ id: owned, state: "ready" }] : []),
      execution: installExpected
        ? installs.length === 1 && install?.deviceId === owned &&
          install.packageName === "app.vibestudio.mobile.internal" && install.reset === false &&
          readbacks.length === 1 && readback?.deviceId === owned && readback.packageName === install.packageName
        : installs.length === 0 && readbacks.length === 0,
      device: installExpected
        ? after.installed && after.bundleActive && after.screenshotCaptured &&
          after.screenshotBytes > 0 && after.issues.length === 0 &&
          readback?.installed === true && readback.bundleActive && readback.rendering &&
          readback.screenshotBytes > 0 && readback.issues.length === 0
        : isDeepStrictEqual(after, before),
      report: installExpected
        ? report?.status === "development-ready" && report.deviceId === owned &&
          isDeepStrictEqual(report.receipt, install) && isDeepStrictEqual(report.readback, readback)
        : report?.status === "blocked" && report.blocker === blocker &&
          report.deviceId === request.deviceId && !!report.next.trim(),
    };
    return { ...input, request, owned, inventory, install, readback, before, after, checks, passed: Object.values(checks).every(Boolean) };
  }

  async function qualify() {
    await services.mobileInventory.read();
    if (!installExpected) {
      let denied = false;
      try { await services.mobileDevelopment.install(owned); }
      catch (error) { denied = error instanceof Error && error.message.includes("exact authorized foreground device"); }
      if (!denied) throw new Error("Managed mobile binding admitted an unassigned install");
      return verify({
        status: "blocked", blocker, deviceId: request.deviceId,
        next: "Obtain the assigned foreground device and inspect it before attempting installation.",
      });
    }
    const receipt = await services.mobileDevelopment.install(owned);
    if (!receipt) throw new Error("The native installation returned an invalid receipt");
    const readback = await services.mobileApp.verify(receipt.deviceId, receipt.packageName);
    if (!readback) throw new Error("The native application read returned an invalid receipt");
    return verify({ status: "development-ready", deviceId: owned, receipt, readback });
  }
  return { request, services, qualify, verify };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedAndroidInstall>>;
export interface AndroidInstallReceiver {
  runAndroidInstallTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyAndroidInstall(input: Input): ReturnType<Prepared["qualify"]>;
}
export const androidInstallMethods = createReceiverRpcMethods<AndroidInstallReceiver>([
  "runAndroidInstallTeacher", "qualifyAndroidInstall",
]);
