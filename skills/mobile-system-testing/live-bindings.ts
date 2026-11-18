import { phoneSetup } from "@workspace-skills/phone-setup";
import { extensions } from "@workspace/runtime";
import type { mobileNativeMethods } from "@vibestudio/service-schemas/mobileNative";
import type { z } from "zod";
import { bindMobileScenario, type MobilePorts } from "./bindings.js";
import type {
  MobileAssignment,
  MobileDevice,
  MobileInventory,
} from "./scenario/types.js";

type NativeMethod = "listDevices" | "installAndroid" | "verify";
type NativeValue<M extends NativeMethod> = z.output<
  (typeof mobileNativeMethods)[M]["returns"]
>;

async function mobileDebug<M extends NativeMethod>(
  method: M,
  ...args: z.input<(typeof mobileNativeMethods)[M]["args"]>
): Promise<NativeValue<M>> {
  return (await extensions.invoke(
    "@workspace-extensions/mobile-debug",
    method,
    args,
  )) as NativeValue<M>;
}

function deviceState(state: string, ready: boolean): MobileDevice["state"] {
  return ready
    ? "ready"
    : state === "unauthorized"
      ? "unauthorized"
      : "offline";
}

/** The caller supplies the observed workspace identity, tooling and foreground ownership.
 *  Normal platform approval still applies to the delegated phone and debug APIs. */
export function bindInstalledMobileScenario(
  request: MobileAssignment,
  observed: Omit<MobileInventory, "devices">,
  signal?: AbortSignal,
) {
  let setup: ReturnType<typeof phoneSetup> | undefined;
  const phone = () => (setup ??= phoneSetup());
  const ports: MobilePorts = {
    async inventory() {
      const inventory = { ...observed, devices: [] as MobileDevice[] };
      if (
        !observed.tooling ||
        observed.workspace !== request.workspace ||
        (request.authority === "execute" && !observed.foreground)
      )
        return inventory;
      if (request.scenario === "development") {
        const devices = await mobileDebug("listDevices");
        inventory.devices = devices.map(({ serial, state }) => ({
          id: serial,
          state: deviceState(state, state === "device"),
        }));
      } else if (inventory.provider) {
        const api = await phone();
        const providers = await api.providers();
        const providerId = inventory.provider;
        if (
          !providers.some(
            (provider) =>
              provider.providerId === providerId &&
              provider.platforms.includes("android"),
          )
        ) {
          inventory.provider = null;
          return inventory;
        }
        const discovered = await api.devices(providerId, "android");
        inventory.devices = discovered.devices
          .filter(
            ({ platform, providerId: candidate }) =>
              platform === "android" && candidate === providerId,
          )
          .map(({ deviceId, state, ready }) => ({
            id: deviceId,
            state: deviceState(state, ready),
          }));
      }
      return inventory;
    },
    async pair(deviceId, providerId) {
      signal?.throwIfAborted();
      const receipt = await (
        await phone()
      ).provision({ providerId, platform: "android", deviceId, mode: "auto" });
      return {
        provider: receipt.platform === "android" ? receipt.providerId : "",
        workspace: receipt.workspace,
        attachedDevice: receipt.attachedDeviceId,
        pairedDevice: receipt.pairedDevice.deviceId,
        install: receipt.installStatus,
      };
    },
    async workspace(pairedDevice) {
      return {
        pairedDevice,
        ...(await (await phone()).readiness(pairedDevice, signal)),
      };
    },
    async install(deviceId, reset) {
      signal?.throwIfAborted();
      const receipt = await mobileDebug("installAndroid", {
        device: deviceId,
        resetApp: reset,
        launch: true,
      });
      return { deviceId, packageName: receipt.packageName, reset };
    },
    async app(deviceId, packageName) {
      signal?.throwIfAborted();
      const receipt = await mobileDebug("verify", {
        device: deviceId,
        packageName,
      });
      const { screenshotCaptured, screenshotBytes, ...verified } = receipt;
      return {
        deviceId,
        packageName,
        ...verified,
        screenshotBytes: screenshotCaptured ? screenshotBytes : 0,
      };
    },
  };
  return bindMobileScenario(request, ports);
}
