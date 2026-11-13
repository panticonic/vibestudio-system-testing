import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { tendrilTests, validateTendrilLoop } from "./tendrils.js";

function run(final: string, evals: { code: string; returnValue: unknown }[]): TestExecutionResult {
  return {
    duration: 0,
    messages: [
      { kind: "message", senderId: "user", complete: true, content: "prompt" },
      ...evals.map((call) => ({
        kind: "message" as const,
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        contentType: "invocation" as const,
        content: JSON.stringify({
          name: "eval",
          arguments: { code: call.code },
          execution: { status: "complete", isError: false, result: { details: { returnValue: call.returnValue } } },
        }),
      })),
      { kind: "message", senderId: "agent", senderMetadata: { type: "agent" }, complete: true, content: final },
    ],
  } as TestExecutionResult;
}

const fullLoop = [
  {
    code: `const { createTendril, listDevices } = await import("@workspace/tendril/agent");
const t = await createTendril({ source: "panels/timer", channelId, contextId, name: "Timer" });
const [device] = await listDevices();
return await t.present(device.deviceId);`,
    returnValue: { state: "presented", slotId: "panel:tree/timer" },
  },
  {
    code: `await t.state.apply([{ op: "set", path: ["minutes"], value: 5 }]);
const shown = await t.eval("document.body.innerText");
await t.call("start");
return await t.update();`,
    returnValue: [{ slotId: "panel:tree/timer", outcome: { failed: { code: "boot_stalled" } } }],
  },
];

describe("tendril-loop", () => {
  it("passes a run that drives the page and sees the broken update go back", () => {
    expect(
      validateTendrilLoop(run("The broken update failed and the page went back to the working version on Phone.", fullLoop)),
    ).toMatchObject({ passed: true });
  });

  it("fails when the agent never presented or updated the page", () => {
    expect(validateTendrilLoop(run("Done.", [fullLoop[0]!])).passed).toBe(false);
  });

  it("fails when no update was reported failed", () => {
    const proven = [fullLoop[0]!, { ...fullLoop[1]!, returnValue: [{ slotId: "panel:tree/timer", outcome: "proven" }] }];
    expect(validateTendrilLoop(run("It went back to the working version.", proven)).passed).toBe(false);
  });

  it("keeps the prompt user-like", () => {
    for (const test of tendrilTests)
      expect(test.prompt).not.toMatch(/createTendril|listDevices|\.present\(|Return (?:only|exactly)/u);
  });
});
