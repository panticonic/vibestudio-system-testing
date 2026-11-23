import { describe, expect, it } from "vitest";
import { ownedSkillMaintenanceNative } from "./open-goal-skill-maintenance-native.js";
import type { EvalCall } from "@vibestudio/service-schemas/eval";

const criterion = { expected: [], absent: [], requiredSelectors: null };
describe("owned finite compiler witness lifetime", () => {
  it.each([undefined, 12345])("uses the enclosing lifetime unless an explicit deadline is requested (%s)", async timeoutMs => {
    let input: any;
    const value = {path: "skills/fixture", revision: "revision", satisfied: true, failures: []};
    const result = {success:true, returnValue:value};
    const call = (async (method: string, args: any[]) => {
      if (method === "eval.start") { input = args[0]; return {runId:input.runId,snapshot:{status:"done",result}}; }
      if (method === "eval.receipt") return {runId:input.runId,runDigest:"run",resultDigest:"result",result};
      if (method === "eval.dispose") return null;
      throw new Error(`Unexpected call ${method}`);
    }) as EvalCall;
    const native = ownedSkillMaintenanceNative(call, "owned", {probeTimeoutMs:timeoutMs});
    const observed = await native.observe(value.path, value.revision, criterion);
    expect(observed.check.satisfied).toBe(true);
    if (timeoutMs === undefined) expect(input).not.toHaveProperty("timeoutMs");
    else expect(input.timeoutMs).toBe(timeoutMs);
    expect(input.authority).toEqual({effects:"read-only",approvals:"pregranted-only"});
    await native.close();
  });
  it("cancels a pending witness and disposes its scope when its owner closes", async () => {
    let started!: () => void;
    const admitted = new Promise<void>(resolve => { started = resolve; });
    const methods: string[] = [];
    const call = (async (method: string, args: any[]) => {
      methods.push(method);
      if (method === "eval.start") {started();return {runId:args[0].runId,status:"running"};}
      if (method === "eval.get") return {runId:args[0].runId,status:"running"};
      if (method === "eval.cancel" || method === "eval.dispose") return null;
      throw new Error(`Unexpected call ${method}`);
    }) as EvalCall;
    const native = ownedSkillMaintenanceNative(call,"owned");
    const observed = native.observe("skills/fixture","revision",criterion);
    const rejected = expect(observed).rejects.toThrow("Owned skill witness scope closed");
    await admitted;
    await native.close();
    await rejected;
    expect(methods).toContain("eval.cancel");
    expect(methods).toContain("eval.dispose");
  });
});
