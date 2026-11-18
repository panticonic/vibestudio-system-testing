import { describe, expect, it } from "vitest";
import { sharedWorkflowWorlds } from "./worlds.js";
import { verifySharedWorkflow } from "./verify.js";

describe("cross-template workflow authorization depends on observed outcome", () => {
  it("requires the System evidence before any dependent Automation call", () => {
    const fixture = sharedWorkflowWorlds[0]!;
    const plan = {
      results: [
        {
          kind: "domain",
          domain: "system",
          operation: "investigateSystem",
          report: {
            status: "attention",
            findings: [
              {
                code: "regression",
                evidenceIds: ["editor-before", "editor-after"],
              },
            ],
          },
        },
        {
          kind: "domain",
          domain: "automation",
          operation: "prepareAutomation",
          report: {
            kind: "launch",
            executor: "notify",
            trigger: { kind: "schedule", everyMs: 2700000 },
            conversation: "continue",
            operations: [],
          },
        },
      ],
      remaining: [],
    };
    const first = { name: "investigateSystem", startedAt: 1, endedAt: 3 };
    const second = { name: "prepareAutomation", startedAt: 4, endedAt: 5 };
    expect(verifySharedWorkflow(fixture, plan, [first, second]).passed).toBe(
      true,
    );
    expect(
      verifySharedWorkflow(fixture, plan, [first, { ...second, startedAt: 2 }])
        .passed,
    ).toBe(false);
    expect(
      verifySharedWorkflow({ ...fixture, id: "alias" }, plan, [first, second])
        .passed,
    ).toBe(true);
  });

  it("rejects even an unreported automation call after incomparable observations", () => {
    const fixture = sharedWorkflowWorlds[2]!;
    const report = {
      results: [
        {
          kind: "domain",
          domain: "system",
          operation: "investigateSystem",
          report: {
            status: "inconclusive",
            findings: [
              { code: "incomparable", evidenceIds: ["boot-cold", "boot-warm"] },
            ],
          },
        },
      ],
      remaining: ["Comparable samples required before preparing the reminder."],
    };
    const first = { name: "investigateSystem", startedAt: 1, endedAt: 3 };
    expect(verifySharedWorkflow(fixture, report, [first]).passed).toBe(true);
    expect(
      verifySharedWorkflow(fixture, report, [
        first,
        { name: "prepareAutomation", startedAt: 4, endedAt: 6 },
      ]).passed,
    ).toBe(false);
  });
});
