import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type { AndroidAuditReport, AndroidAuditRequest, AndroidRuntimeObservation, AndroidTargetObservation } from "../mobile-runtime-audit/types.js";
import { androidAuditWorlds } from "./android-audit-worlds.js";

export type AndroidAuditInput = { contextId: string; caseId: string };
type Device = { serial: string; state: "device" | "unauthorized" | "offline" };
type Binder = (assignment: Omit<AndroidAuditRequest, "operationId">) => {
  request: AndroidAuditRequest;
  services: {
    androidRuntimeAudit: {
      observeTarget(id: string): Promise<AndroidTargetObservation>;
      observeApplication(id: string): Promise<AndroidRuntimeObservation>;
    };
  };
};

export async function prepareManagedAndroidAudit(
  input: AndroidAuditInput,
  listDevices: () => Promise<Device[]>,
  bind: Binder,
) {
  const world = androidAuditWorlds.find(({ id }) => id === input.caseId);
  if (!world) throw new Error("Unknown Android audit assignment");
  const initial = await listDevices();
  const emulators = initial.filter(({ serial, state }) => /^emulator-\d+$/u.test(serial) && state === "device");
  if (emulators.length !== 1)
    throw new Error("This case requires exactly one ready disposable Android emulator");
  const owned = emulators[0]!.serial;
  const absentSerial = "emulator-0";
  if (initial.some(({ serial }) => serial === absentSerial))
    throw new Error("The reserved absent emulator coordinate is present");
  const target = world.mode === "foreign" ? absentSerial : owned;
  const bound = bind({ goal: world.goal, target, intent: world.mode === "target" ? "device" : "application" });
  const targets: AndroidTargetObservation[] = [];
  const applications: AndroidRuntimeObservation[] = [];
  const services = {
    androidRuntimeAudit: {
      async observeTarget(id: string) {
        const observation = await bound.services.androidRuntimeAudit.observeTarget(id);
        targets.push(structuredClone(observation));
        return observation;
      },
      async observeApplication(id: string) {
        const observation = await bound.services.androidRuntimeAudit.observeApplication(id);
        applications.push(structuredClone(observation));
        return observation;
      },
    },
  };
  const targetReview = world.mode === "foreign" ? "target-absent" : "target-ready";
  const shouldObserveApp = world.mode === "application";

  async function verify(report: AndroidAuditReport | null) {
    const after = await listDevices();
    const observed = targets[0];
    const application = applications[0] ?? null;
    const checks = {
      target: targets.length === 1 && observed?.target === target &&
        observed.state === (world.mode === "foreign" ? null : "device") &&
        report?.targetObservation?.target === observed.target && report.targetObservation.state === observed.state &&
        report.targetReview === targetReview,
      lineage: after.some(({ serial, state }) => serial === owned && state === "device") &&
        !after.some(({ serial }) => serial === absentSerial),
      application: shouldObserveApp
        ? applications.length === 1 && application?.target === owned &&
          application.packageName === "app.vibestudio.mobile.internal" && !application.installed &&
          !application.processObserved && !application.screenshotCaptured && application.screenshotBytes === 0 &&
          application.issues.length > 0
        : applications.length === 0,
      report: shouldObserveApp
        ? report?.runtime?.status === "app-absent" && report.runtime.image === "unavailable" &&
          isDeepStrictEqual(report.runtime.observation, application)
        : report?.runtime === null,
    };
    return { ...input, request: bound.request, owned, observed, application, checks, passed: Object.values(checks).every(Boolean) };
  }

  async function qualify() {
    const targetObservation = await services.androidRuntimeAudit.observeTarget(bound.request.operationId);
    const runtime = shouldObserveApp ? {
      observation: await services.androidRuntimeAudit.observeApplication(bound.request.operationId),
      status: "app-absent" as const,
      image: "unavailable" as const,
    } : null;
    return verify({ targetObservation, targetReview, runtime });
  }
  return { request: bound.request, services, qualify, verify };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedAndroidAudit>>;
export interface AndroidAuditReceiver {
  runAndroidAuditTeacher(input: AndroidAuditInput & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyAndroidAudit(input: AndroidAuditInput): ReturnType<Prepared["qualify"]>;
}
export const androidAuditMethods = createReceiverRpcMethods<AndroidAuditReceiver>([
  "runAndroidAuditTeacher", "qualifyAndroidAudit",
]);
