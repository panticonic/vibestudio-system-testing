import { isDeepStrictEqual } from "node:util";
import { contextId, rpc, workspace } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { phoneSetup } from "@workspace-skills/phone-setup";
import type {
  bindInstalledMobileScenario, inspectInternalAndroidApp, listMobileDebugDevices,
} from "@workspace-skills/mobile-system-testing/live-bindings";
import type { MobileAssignment, MobileReport } from "../mobile-system-testing/scenario/types.js";
import { prepareManagedAndroidInstall } from "./android-install-managed.js";
import { prepareManagedAndroidPair } from "./android-pair-managed.js";
import type { AndroidDeliveryWorld } from "./open-goal-android-delivery-worlds.js";

type AndroidScope = { workspace: string; deviceId: string | null; deviceKind: "disposable-emulator"; note: string };

type AndroidBindings = {
  phoneSetup: typeof phoneSetup;
  bind: typeof bindInstalledMobileScenario;
  inventory: typeof listMobileDebugDevices;
  verifyApp: typeof inspectInternalAndroidApp;
};

export async function prepareOpenAndroidDelivery(
  input: { contextId: string; caseId: string; goal: string },
  world: AndroidDeliveryWorld,
  bindings: AndroidBindings,
) {
  if (input.contextId !== contextId || input.caseId !== world.id || input.goal !== world.goal)
    throw new Error("The Android delivery scope belongs to another owned goal");
  const prepared = world.route === "pair"
    ? await prepareManagedAndroidPair(input, await workspace.getActive(), await bindings.phoneSetup(), bindings.bind, world)
    : await (async () => {
      const { workspaceId } = await rpc.call("main", mainRpcMethods["auth.getConnectionInfo"], []);
      if (!workspaceId) throw new Error("The Android development exercise requires an authenticated workspace");
      return prepareManagedAndroidInstall(input, workspaceId, {
        bind: bindings.bind, inventory: bindings.inventory, verifyApp: bindings.verifyApp,
      }, world);
    })();
  const scope: AndroidScope = { workspace: prepared.request.workspace, deviceId: prepared.request.deviceId,
    deviceKind: "disposable-emulator", note: "Use the exact assigned test target and preserve the operation requested by the user." };
  let scoped = false;
  const androidDeliveryScope = {
    async read(goal: string) {
      if (scoped || goal !== world.goal) throw new Error("Use the exact Android delivery goal");
      scoped = true;
      return scope;
    },
  };
  async function verify(value: unknown) {
    const envelope = value as { status?: string; skill?: string; outcome?: {
      scope?: AndroidScope; request?: MobileAssignment; actual?: MobileReport;
    } } | null;
    const outcome = envelope?.outcome;
    const native = await prepared.verify(outcome?.actual ?? null);
    const checks = {
      boundExactAndroidDelivery: scoped && isDeepStrictEqual(outcome?.scope, scope) &&
        isDeepStrictEqual(outcome?.request, prepared.request),
      exactNativeAndroidInventory: native.checks.inventory,
      independentlyVerifiedAndroidResult: native.passed && native.checks.report,
      matchedAndroidDeliveryReport: envelope?.status === "workspace-skill-reviewed" && envelope.skill === "androidDelivery",
    };
    return { ...input, scope, outcome, native, checks, passed: Object.values(checks).every(Boolean) };
  }
  async function qualify() {
    await androidDeliveryScope.read(input.goal);
    const native = await prepared.qualify();
    const checks = {
      boundExactAndroidDelivery: scoped && isDeepStrictEqual(native.request, prepared.request),
      exactNativeAndroidInventory: native.checks.inventory,
      independentlyVerifiedAndroidResult: native.passed && native.checks.report,
      matchedAndroidDeliveryReport: native.checks.report,
    };
    return { ...input, scope, native, checks, passed: Object.values(checks).every(Boolean) };
  }
  return { services: { ...prepared.services, androidDeliveryScope }, verify, qualify };
}
