import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {assessObservedApplicationOutcome,type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
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
  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["matchedAndroidDeliveryReport"],"rootPath":[],"producerSourceSuffix":"runMobileScenario.nl","producerPath":[]}];
    const contributions=authored.filter(binding=>{
      let current:unknown=value;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,value,invocation,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(value: unknown, invocation?: InvocationObservations) {
    const envelope = value as {
      scope?: AndroidScope; request?: MobileAssignment; actual?: MobileReport;
    } | null;
    const outcome = envelope;
    const native = await prepared.verify(value as MobileReport | null);
    const checks = {
      boundExactAndroidDelivery: scoped,
      exactNativeAndroidInventory: native.checks.inventory,
      independentlyVerifiedAndroidResult: Object.entries(native.checks).filter(([key])=>key!=="report").every(([,passed])=>passed),
      matchedAndroidDeliveryReport: native.checks.report,
    };
    return {
      incorrectReturnValues:[],
 ...input, scope, outcome, native, checks, passed: Object.values(checks).every(Boolean),
      outcomeContract:{effects:{checks:["boundExactAndroidDelivery", "exactNativeAndroidInventory", "independentlyVerifiedAndroidResult"],rationale:"Independent native state, admission, captured operations and durable readback establish these facts."},
        returnedValue:{checks:["matchedAndroidDeliveryReport"],required:!("receipt" in native&&native.receipt||"install" in native&&native.install),rationale:"A requested query answer is required; a redundant result copy is optional after its requested native effect is established."},
        incidentalValues:{checks:[],rationale:"Known incorrect emitted application values use actual invocation definitions for masking."}}
    };
  }
  async function qualify() {
    await androidDeliveryScope.read(input.goal);
    const native = await prepared.qualify();
    const checks = {
      boundExactAndroidDelivery: scoped && isDeepStrictEqual(native.request, prepared.request),
      exactNativeAndroidInventory: native.checks.inventory,
      independentlyVerifiedAndroidResult: Object.entries(native.checks).filter(([key])=>key!=="report").every(([,passed])=>passed),
      matchedAndroidDeliveryReport: native.checks.report,
    };
    return assessNativeQualification({ ...input, scope, native, checks,outcomeContract:{effects:{checks:["boundExactAndroidDelivery", "exactNativeAndroidInventory", "independentlyVerifiedAndroidResult"],rationale:"Native Android reference procedure establishes the owned inventory and effect."},returnedValue:{checks:["matchedAndroidDeliveryReport"],required:true,rationale:"The reference includes its exact requested native report."}}, passed: Object.values(checks).every(Boolean) });
  }
  return { services: { ...prepared.services, androidDeliveryScope }, verify, qualify };
}
