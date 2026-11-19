import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

import { phoneSetupUnavailable } from "./phone-setup-world.js";
export { phoneSetupUnavailable } from "./phone-setup-world.js";

type Observation = {
  receipt: string;
  platform: string;
  providerId: string | null;
  deviceId: string | null;
  desktops: unknown[];
  pairedDeviceId: string | null;
};
type SetupReport = {
  status?: unknown;
  guidance?: unknown;
  evidenceIds?: unknown;
  pairedDeviceId?: unknown;
};

export function verifyDesktopUnavailable(
  contextId: string,
  request: { goal: string; operationId: string },
  observed: Observation | null,
  report: SetupReport | null,
) {
  const checks = {
    assignedStart:
      request.goal === phoneSetupUnavailable.goal &&
      observed?.receipt === `${request.operationId}:assignment` &&
      observed.platform === phoneSetupUnavailable.platform &&
      observed.providerId === null &&
      observed.deviceId === null,
    noEligibleDesktop:
      observed?.desktops.length === 0 && observed.pairedDeviceId === null,
    reportMatches:
      observed !== null &&
      report?.status === "desktop-unavailable" &&
      report.pairedDeviceId === null &&
      Array.isArray(report.evidenceIds) &&
      report.evidenceIds.length === 1 &&
      report.evidenceIds[0] === observed.receipt &&
      typeof report.guidance === "string" &&
      report.guidance.trim().length > 0,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    caseId: phoneSetupUnavailable.id,
    contextId,
    request,
    observed,
    checks,
  };
}

type PhoneSetupInput = { contextId: string };
export interface ManagedPhoneSetupReceiver {
  runManagedPhoneSetupTeacher(
    input: PhoneSetupInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<typeof verifyDesktopUnavailable>;
  }>;
  qualifyManagedPhoneSetup(input: PhoneSetupInput): Promise<{
    verification: ReturnType<typeof verifyDesktopUnavailable>;
    rejectsForeignReceipt: boolean;
  }>;
}

export const managedPhoneSetupMethods =
  createReceiverRpcMethods<ManagedPhoneSetupReceiver>([
    "runManagedPhoneSetupTeacher",
    "qualifyManagedPhoneSetup",
  ]);
