/** Infrastructure acknowledgement only; this is not an authored task or task outcome. */
export const NATIVE_STARTUP_DIAGNOSTIC_CASE = "scheduled-recovery-retime-without-release";
export type NativeStartupDiagnostic = { epoch: string };
export type NativeStartupAcknowledgement = {
  schema: "native-startup-diagnostic/1";
  diagnosticOnly: true;
  epoch: string;
  caseId: string;
  runId: string;
  evalScope: string;
  phase: "receiver-entered";
  modelCallsRequested: 0;
};
export function validateNativeStartupDiagnostic(
  input: { startupDiagnostic?: unknown; qualification?: unknown; caseId: string; goal: string },
  world?: { id: string; goal: string },
): NativeStartupDiagnostic | undefined {
  if (input.startupDiagnostic === undefined) return undefined;
  const diagnostic = input.startupDiagnostic;
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic) ||
      Object.keys(diagnostic).length !== 1 || !("epoch" in diagnostic) ||
      typeof diagnostic.epoch !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,95}$/.test(diagnostic.epoch) ||
      input.qualification !== true || input.caseId !== NATIVE_STARTUP_DIAGNOSTIC_CASE ||
      world?.id !== NATIVE_STARTUP_DIAGNOSTIC_CASE || input.goal !== world.goal)
    throw new Error("Native startup diagnostic requires its exact scheduled world, original goal, qualification=true and one bounded epoch");
  return { epoch: diagnostic.epoch };
}
export function nativeStartupDiagnosticCode(input: {
  epoch: string; contextId: string; caseId: string; runId: string; evalScope: string;
}): string {
  const acknowledgement: NativeStartupAcknowledgement = {
    schema: "native-startup-diagnostic/1", diagnosticOnly: true, epoch: input.epoch,
    caseId: input.caseId, runId: input.runId, evalScope: input.evalScope,
    phase: "receiver-entered", modelCallsRequested: 0,
  };
  return `
    import {contextId as actualContextId} from "@workspace/runtime";
    if (actualContextId !== ${JSON.stringify(input.contextId)}) throw new Error("Native diagnostic belongs to another context");
    const startupDiagnostic=${JSON.stringify(acknowledgement)};
    console.info(JSON.stringify({...startupDiagnostic, side:"receiver", at:Date.now()}));
    const utilityValue={contextId:actualContextId,teacher:null,verification:null,verificationErrors:[],diagnosticOnly:true,startupDiagnostic};
  `;
}
