import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { observeInvocation } from "./observed-invocation.js";
vi.mock("@vibestudio/content-addressing", () => ({
  sha256HexSyncText: (text: string) => createHash("sha256").update(text).digest("hex"),
}));
const text = JSON.stringify({ answer: "actual recorded result", nested: [1, 2] });
const hash = createHash("sha256").update(text).digest("hex");
function capture() {
  return { evalRunId: "run", rootCallIds: ["root"], captureErrors: [] as string[], calls: [
    { callId: "root", summary: { run_id: "run", owner_key: "owner", owner_kind: "eval" }, record: {
      call_id: "root", parent_call_id: null as string | null, definition: { name: "root", source: "actual source" },
      outcome: "done", output: { complete: true, hash },
    } },
  ] };
}
it("reads complete content-addressed outputs lazily without prescribing helper calls", async () => {
  const read = vi.fn(async () => text);
  const observations = observeInvocation(capture(), read);
  expect(await observations.returns(call => call.definition.name === "optionalAbsentHelper")).toEqual([]);
  expect(read).not.toHaveBeenCalled();
  const returned = await observations.returns();
  expect(returned[0].value).toEqual(JSON.parse(text));
  (returned[0].value as { nested: number[] }).nested.push(3);
  expect((await observations.returns())[0].value).toEqual(JSON.parse(text));
});
it("does not copy retained prompts, replies or events while inspecting return references", async () => {
  const value = capture();
  Object.defineProperty(value.calls[0].record, "model_turns", {
    enumerable: true, get() { throw new Error("Unnecessary full teacher payload read"); },
  });
  const observations = observeInvocation(value, async () => text);
  expect((await observations.returns())[0].value).toEqual(JSON.parse(text));
});
it("rejects missing or corrupt full values instead of using a preview", async () => {
  for (const value of [null, "{}"])
    await expect(observeInvocation(capture(), async () => value).returns()).rejects.toThrow(/Missing or corrupt/);
  const incomplete = capture();
  incomplete.calls[0].record.output.complete = false;
  await expect(observeInvocation(incomplete, async () => text).returns()).rejects.toThrow(/Incomplete recorded/);
});
it("rejects wrong owners, runs, lineage and corrupt captures", () => {
  const variants = [capture(), capture(), capture(), capture()];
  variants[0].calls[0].summary.run_id = "another run";
  variants[1].calls[0].record.parent_call_id = "missing";
  variants[2].calls[0].record.parent_call_id = "root";
  variants[3].captureErrors.push("missing exchanges");
  for (const value of variants) expect(() => observeInvocation(value, async () => text)).toThrow();
  const crossOwner = capture();
  const child = structuredClone(crossOwner.calls[0]);
  child.callId = child.record.call_id = "child";
  child.record.parent_call_id = "root";
  child.summary.owner_key = "another owner";
  crossOwner.calls.push(child);
  expect(() => observeInvocation(crossOwner, async () => text)).toThrow(/owner/);
});
