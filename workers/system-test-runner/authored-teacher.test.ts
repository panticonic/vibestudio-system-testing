import { describe, expect, it } from "vitest";
import { authoredTeacherCode } from "./authored-teacher.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const options = { programPath: "program/root.nl", rootName: "root", serviceName: "assigned", executorModel: "provider:teacher", request: { goal: "task" }, bindingCode: "const assignedService={};" };
async function capture(rootOutcome: string, childParent = "root", wrongModel = false) {
  const rows = [{ callId: "root", parentCallId: null }, { callId: "child", parentCallId: "root" }];
  return new AsyncFunction("natlang", authoredTeacherCode(options, "run-one") + "\nreturn utilityValue;")({
    captureModelTurns() {}, load: async () => async () => ({ status: "verified" }),
    calls: async ({ after }: { after?: string }) => after ? [] : rows,
    trace: async (id: string) => ({ callId: id, summary: { run_id: "run-one", owner_key: "owner", owner_kind: "test" },
      events: [{ kind: "action", outcome: "error" }],
      record: { call_id: id, parent_call_id: id === "root" ? null : childParent,
        definition: { name: id }, outcome: id === "root" ? rootOutcome : "error",
        model_turns: [{ kind: "generation", reply: { raw_response: { vibestudio: { model: wrongModel ? "other:model" : "provider:teacher" } } } }] } }),
  });
}
describe("authored teacher capture eligibility", () => {
  it("retains recovered failed children and actions when the authored root succeeds", async () => {
    const result = await capture("done");
    expect(result.trainingEligible).toBe(true);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[1].record.outcome).toBe("error");
    expect(result.calls[0].events[0].outcome).toBe("error");
  });
  it("excludes a failed root while preserving its available records", async () => {
    const result = await capture("error");
    expect(result.trainingEligible).toBe(false);
    expect(result.calls).toHaveLength(2);
  });
  it("rejects inconsistent lineage", async () => { expect((await capture("done", "missing")).trainingEligible).toBe(false); });
  it("rejects another actual teacher", async () => { expect((await capture("done", "root", true)).trainingEligible).toBe(false); });
});
