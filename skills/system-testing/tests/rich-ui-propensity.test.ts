import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import {
  extractCustomComponents,
  extractMdxTags,
  extractRichUiSignals,
  scoreRichUi,
  type RichUiResponseEvidence,
} from "./rich-ui-signals.js";
import {
  RICH_UI_PROMPTS,
  richUiPropensityTests,
  validatePropensityScore,
  validateSinglePrompt,
} from "./rich-ui-propensity.js";
import { assertSystemTestDeclaration } from "../prompt-contract.js";
import {
  classifyRenderFailures,
  observeFeedbackRepair,
  type FeedbackRepairEvidence,
} from "../real-chat-panel.js";

function agent(content: string, id = "m1") {
  return {
    id,
    kind: "message",
    complete: true,
    content,
    senderId: "agent",
    senderMetadata: { type: "agent" },
  } as never;
}

function inlineCard(id: string) {
  return { id: `card-${id}`, kind: "message", contentType: "inline_ui", inlineUi: { id } } as never;
}

function inlineCall(id: string, receiptId: string, ok = true, isError = false) {
  return {
    id: `call-${id}`,
    kind: "message",
    contentType: "invocation",
    invocation: {
      id: `call-${id}`,
      name: "inline_ui",
      execution: {
        status: "complete",
        isError,
        result: {
          details: {
            protocol: "native-channel-method-outcome.v1",
            value: { ok, id: receiptId },
          },
        },
      },
    },
  } as never;
}

const run = (messages: unknown[]): TestExecutionResult =>
  ({ messages, duration: 1 }) as TestExecutionResult;

describe("extractMdxTags", () => {
  it("finds distinct capitalized tags and ignores code", () => {
    const content = [
      "Here you go <Chart data={[1]} /> and <Stats items={x}>",
      "<Chart type='bar' />",
      "```tsx",
      "<Hidden />",
      "```",
      "~~~",
      "<AlsoHidden />",
      "~~~",
      "inline `<Nope />` and a <div> and <Callout.Root>",
      "a < B and List<string>",
    ].join("\n");
    expect(extractMdxTags(content).sort()).toEqual(
      ["Callout.Root", "Chart", "Stats"].sort(),
    );
  });
});

const WIDGET = [
  'import { useState } from "react"',
  "",
  "export function Widget() {",
  "  const [n, setN] = useState(0)",
  "  return <button onClick={() => setN(n + 1)}>{n}</button>",
  "}",
  "",
  "<Widget />",
].join("\n");

describe("extractCustomComponents", () => {
  it("finds defined-and-used components and hooks", () => {
    expect(extractCustomComponents(WIDGET)).toEqual({ names: ["Widget"], usesHooks: true });
    expect(
      extractCustomComponents("export const Dot = () => <i />\n\n<Dot />"),
    ).toEqual({ names: ["Dot"], usesHooks: false });
  });
  it("ignores definitions that are unused, in fences, or catalog-only", () => {
    expect(extractCustomComponents("export function Unused() {}\n<Other />").names).toEqual([]);
    expect(
      extractCustomComponents("```tsx\n" + WIDGET + "\n```").names,
    ).toEqual([]);
    expect(extractCustomComponents("<Chart data={[]} />").names).toEqual([]);
  });
  it("counts a custom component as rich UI", () => {
    const signals = extractRichUiSignals(run([agent(WIDGET)]));
    expect(signals).toMatchObject({ customComponents: ["Widget"], usesHooks: true, usedRichUi: true });
  });
});

describe("extractRichUiSignals", () => {
  it("matches ok receipts to transcript cards and counts mermaid", () => {
    const signals = extractRichUiSignals(
      run([
        inlineCall("a", "plan"),
        inlineCard("plan"),
        inlineCall("b", "ghost"),
        inlineCall("c", "bad", false),
        inlineCard("bad"),
        agent("```mermaid\ngraph TD\n```\nplain"),
      ]),
    );
    expect(signals.inlineUiCalls).toEqual(["plan"]);
    expect(signals.mermaidFences).toBe(1);
    expect(signals.mdxTags).toEqual([]);
    expect(signals.usedRichUi).toBe(true);
  });

  it("counts a mermaid-only diagram as rich and plain text as not rich", () => {
    expect(
      extractRichUiSignals(run([agent("```mermaid\nx\n```")])).usedRichUi,
    ).toBe(true);
    expect(extractRichUiSignals(run([agent("Lima.")])).usedRichUi).toBe(false);
  });

  it("counts MDX tags from agent messages only", () => {
    const user = { ...(agent("<Chart />") as object), senderMetadata: { type: "panel" } } as never;
    expect(extractRichUiSignals(run([user])).usedRichUi).toBe(false);
    expect(
      extractRichUiSignals(run([agent("<Checklist items={[]} />")])).mdxTags,
    ).toEqual(["Checklist"]);
  });
});

function evidence(
  rows: Array<[string, "ui-worthy" | "bespoke" | "plain", boolean]>,
): RichUiResponseEvidence[] {
  return rows.map(([promptId, kind, used]) => ({
    promptId,
    kind,
    signals: {
      inlineUiCalls: [],
      mdxTags: used ? ["Chart"] : [],
      mermaidFences: 0,
      customComponents: [],
      usesHooks: false,
      usedRichUi: used,
    },
    render: cleanRender(),
  }));
}

function cleanRender(): NonNullable<RichUiResponseEvidence["render"]> {
  return {
    panelId: "p",
    feedbackCount: 0,
    initialFailures: [],
    repair: { ran: false, outcome: "not_owed", repairTurnId: null, admittedBy: [], subjects: [] },
    unresolved: [],
    resolved: [],
    repaired: [],
    undelivered: [],
  };
}

const withEvidence = (responses: RichUiResponseEvidence[]) =>
  ({
    messages: [],
    duration: 1,
    diagnostics: { richUiPropensity: { responses } },
  }) as TestExecutionResult;

describe("scoring", () => {
  it("computes rates", () => {
    expect(
      scoreRichUi(
        evidence([
          ["a", "ui-worthy", true],
          ["b", "ui-worthy", false],
          ["c", "plain", true],
          ["d", "plain", false],
        ]),
      ),
    ).toMatchObject({ positiveRate: 0.5, negativeLeak: 1 });
  });

  it("gates on positiveRate and negativeLeak", () => {
    const good: Array<[string, "ui-worthy" | "plain", boolean]> = [
      ["a", "ui-worthy", true],
      ["b", "ui-worthy", true],
      ["c", "ui-worthy", true],
      ["d", "ui-worthy", false],
      ["e", "plain", false],
    ];
    expect(validatePropensityScore(withEvidence(evidence([...good]))).passed).toBe(true);
    const low = validatePropensityScore(
      withEvidence(evidence([["a", "ui-worthy", true], ["b", "ui-worthy", false]])),
    );
    expect(low.passed).toBe(false);
    expect(low.reason).toContain("b");
    const leak = validatePropensityScore(
      withEvidence(evidence([...good, ["f", "plain", true]])),
    );
    expect(leak.passed).toBe(false);
    expect(leak.reason).toContain("f");
    expect(leak.details?.["compileFailureCount"]).toBe(0);
  });

  it("counts unresolved render failures and fails on them", () => {
    const rows = evidence([["a", "ui-worthy", true], ["b", "ui-worthy", true]]);
    const failure = {
      category: "compile_failed",
      subject: "inline_ui:split",
      message: "Unexpected token",
      occurrenceKey: "k",
    };
    rows[0]!.render = { ...cleanRender(), feedbackCount: 2, unresolved: [failure] };
    rows[1]!.render = { ...cleanRender(), feedbackCount: 1, resolved: [failure] };
    const result = validatePropensityScore(withEvidence(rows));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("a: Rich UI failed to render");
    expect(result.details?.["compileFailureCount"]).toBe(1);
    expect(result.details).toMatchObject({ repairedCount: 1, unrepairedCount: 1 });
    rows[0]!.render = cleanRender();
    expect(validatePropensityScore(withEvidence(rows)).passed).toBe(true);
    delete rows[0]!.render;
    const unmeasured = validatePropensityScore(withEvidence(rows));
    expect(unmeasured.passed).toBe(false);
    expect(unmeasured.details?.["compileFailureCount"]).toBeNull();
  });

  it("gates bespoke prompts on custom components or inline_ui", () => {
    const rows = (flags: boolean[]) => {
      const r = evidence(flags.map((_, i): [string, "bespoke", boolean] => [`b${i}`, "bespoke", true]));
      r.forEach((row, i) => {
        row.signals.mdxTags = ["Chart"];
        if (flags[i]) row.signals.customComponents = ["Widget"];
      });
      return r;
    };
    const ok = validatePropensityScore(withEvidence(rows([true, true, false])));
    expect(ok.passed).toBe(true);
    expect(ok.details?.["bespokeCustomRate"]).toBeCloseTo(2 / 3);
    const low = validatePropensityScore(withEvidence(rows([true, false, false])));
    expect(low.passed).toBe(false);
    expect(low.reason).toContain("bespokeCustomRate");
    const single = rows([false]);
    expect(validateSinglePrompt(withEvidence(single)).passed).toBe(false);
    single[0]!.signals.inlineUiCalls = ["x"];
    expect(validateSinglePrompt(withEvidence(single)).passed).toBe(true);
  });

  it("fails sessions that errored", () => {
    const rows = evidence([["a", "ui-worthy", true]]);
    rows[0]!.error = "boom";
    expect(validatePropensityScore(withEvidence(rows)).passed).toBe(false);
  });

  it("keeps fixed bill arithmetic plain and classifies variable split scenarios as UI-worthy", () => {
    const fixed = RICH_UI_PROMPTS.find((prompt) => prompt.id === "bill-split");
    const whatIf = RICH_UI_PROMPTS.find((prompt) => prompt.id === "bill-split-what-if");
    expect(fixed?.kind).toBe("plain");
    expect(whatIf?.kind).toBe("ui-worthy");

    const score = scoreRichUi([
      ...evidence([["bill-split", "plain", false]]),
      ...evidence([["bill-split-what-if", "ui-worthy", true]]),
    ]);
    expect(score).toMatchObject({
      positiveRate: 1,
      negativeLeak: 0,
      uiWorthyCount: 1,
      plainCount: 1,
    });
  });

  it("single-prompt validator checks the expected direction and never accepts broken rich UI", () => {
    expect(validateSinglePrompt(withEvidence(evidence([["a", "ui-worthy", true]]))).passed).toBe(true);
    expect(validateSinglePrompt(withEvidence(evidence([["a", "plain", false]]))).passed).toBe(true);
    expect(validateSinglePrompt(withEvidence(evidence([["a", "plain", true]]))).passed).toBe(false);
    expect(validateSinglePrompt(withEvidence([])).passed).toBe(false);

    const broken = evidence([["fixed-bill", "plain", true]]);
    broken[0]!.render = {
      ...cleanRender(),
      feedbackCount: 1,
      unresolved: [{
        category: "props_invalid",
        subject: "message:m1",
        message: "Calculator fields must be a non-empty array",
        occurrenceKey: "broken-calculator",
      }],
    };
    const failed = validateSinglePrompt(withEvidence(broken));
    expect(failed.passed).toBe(false);
    expect(failed.reason).toContain("Rich UI failed to render");
  });
});

describe("classifyRenderFailures", () => {
  const feedback = (
    occurrenceKey: string,
    refs: Record<string, string>,
    category = "compile_failed",
  ) => ({
    payload: {
      protocol: "agentic.trajectory.v1",
      target: { kind: "agent", id: "a" },
      category,
      refs,
      error: { message: occurrenceKey },
      occurrenceKey,
    },
  }) as never;

  it("resolves a failure only when its subject re-rendered without it", () => {
    const events = [
      feedback("ui:r1", { inlineUiId: "split" }),
      feedback("ui:r1", { inlineUiId: "split" }),
      feedback("chart:r1", { inlineUiId: "chart" }, "props_invalid"),
      feedback("mdx:m1", { messageId: "m1" }),
      feedback("gone:r1", { inlineUiId: "gone" }),
      feedback("orphan", {}),
      feedback("stall", { inlineUiId: "split" }, "load_stalled"),
    ];
    const { unresolved, resolved } = classifyRenderFailures(events, {
      reports: [
        { occurrenceKey: "chart:r1", category: "props_invalid", delivery: "sent" },
        { occurrenceKey: "mdx:m1", category: "compile_failed", delivery: "sent" },
      ],
      subjects: ["inline_ui:split", "inline_ui:chart", "message:m1"],
    });
    const keys = (list: Array<{ payload: { occurrenceKey: string } }>) =>
      list.map((event) => event.payload.occurrenceKey);
    expect(keys(resolved)).toEqual(["ui:r1"]);
    expect(keys(unresolved)).toEqual(["chart:r1", "mdx:m1", "gone:r1", "orphan"]);
  });

  const P = "native-run:4:58";
  const R = "native-run:4:74";
  const repair = (
    subjects: string[],
    outcome: FeedbackRepairEvidence["outcome"] = "completed",
  ): FeedbackRepairEvidence => ({
    turnId: P,
    admittedBy: ["mdx:m1"],
    repairTurnId: outcome === "not_owed" ? null : R,
    outcome,
    subjects,
  });
  const keys = (list: Array<{ payload: { occurrenceKey: string } }>) =>
    list.map((event) => event.payload.occurrenceKey);
  const mdxFailure = feedback("mdx:m1", { messageId: "m1", turnId: P });
  const shownMdx = { occurrenceKey: "mdx:m1", category: "compile_failed", delivery: "sent" as const };

  it("counts an MDX failure repaired by the repair turn's new message", () => {
    const settled = { reports: [shownMdx], subjects: ["message:m1", "message:m2"] };
    const result = classifyRenderFailures([mdxFailure], settled, repair(["message:m2"]));
    expect(keys(result.repaired)).toEqual(["mdx:m1"]);
    expect(result.unresolved).toEqual([]);
    // Without the repair turn the same failed message stays unresolved.
    expect(keys(classifyRenderFailures([mdxFailure], settled).unresolved)).toEqual(["mdx:m1"]);
  });

  it("does not repair when the repair turn's own output fails, and never repairs that output", () => {
    const own = feedback("mdx:m2", { messageId: "m2", turnId: R }, "render_failed");
    const result = classifyRenderFailures(
      [mdxFailure, own],
      {
        reports: [shownMdx, { occurrenceKey: "mdx:m2", category: "render_failed", delivery: "sent" }],
        subjects: ["message:m1", "message:m2"],
      },
      repair(["message:m2"]),
    );
    expect(keys(result.unresolved)).toEqual(["mdx:m1", "mdx:m2"]);
    expect(result.repaired).toEqual([]);
  });

  it("resolves an inline UI failure re-rendered cleanly under the same id", () => {
    const ui = feedback("ui:r1", { inlineUiId: "split", turnId: P });
    const result = classifyRenderFailures(
      [ui],
      { reports: [], subjects: ["inline_ui:split"] },
      repair(["inline_ui:split"]),
    );
    expect(keys(result.resolved)).toEqual(["ui:r1"]);
    expect(result.repaired).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("leaves failures unresolved without a completed, productive repair turn", () => {
    const settled = { reports: [shownMdx], subjects: ["message:m1"] };
    for (const evidence of [
      repair([], "not_owed"),
      repair(["message:m2"], "failed"),
      repair([]),
      // Produced output the panel never rendered.
      repair(["message:m2"]),
    ])
      expect(keys(classifyRenderFailures([mdxFailure], settled, evidence).unresolved)).toEqual([
        "mdx:m1",
      ]);
  });
});

describe("observeFeedbackRepair", () => {
  const AGENT = "agent-participant";
  const P = "native-run:4:58";
  const answer = { id: "m1", senderId: AGENT, turnId: P } as never;
  const failure = (turnId: string | undefined, participantId = AGENT) => ({
    payload: {
      target: { kind: "agent", id: AGENT, participantId },
      category: "compile_failed",
      refs: { messageId: "m1", ...(turnId ? { turnId } : {}) },
      error: { message: "x" },
      occurrenceKey: "mdx:m1",
    },
  });
  const session = (
    uiFeedback: unknown[],
    turns: Record<string, { turnId: string; status: string; reason?: string }>,
    messages: unknown[] = [],
  ) =>
    ({
      uiFeedback,
      messages,
      channelView: { turns, actionBars: {} },
      waitUntil: <T>(read: () => T | undefined) => {
        const value = read();
        return value === undefined
          ? Promise.reject(new Error("would wait for the repair turn"))
          : Promise.resolve(value);
      },
    }) as never;

  it("joins the closed repair run and records what it produced", async () => {
    const R = "native-run:4:74";
    const evidence = await observeFeedbackRepair(
      session(
        [failure(P)],
        {
          [P]: { turnId: P, status: "closed" },
          [R]: { turnId: R, status: "closed" },
          "native-run:9:99": { turnId: "native-run:9:99", status: "open" },
        },
        [
          { ...(agent("fixed", "m2") as object), turnId: R },
          { id: "c", kind: "message", contentType: "inline_ui", inlineUi: { id: "u", turnId: R } },
        ],
      ),
      answer,
    );
    expect(evidence).toMatchObject({
      repairTurnId: R,
      outcome: "completed",
      admittedBy: ["mdx:m1"],
      subjects: ["message:m2", "inline_ui:u"],
    });
  });

  it("reports a failed repair run by its close reason", async () => {
    const R = "native-run:4:74";
    const evidence = await observeFeedbackRepair(
      session([failure(P)], { [R]: { turnId: R, status: "closed", reason: "work_failed" } }),
      answer,
    );
    expect(evidence).toMatchObject({ outcome: "failed", closeReason: "work_failed" });
  });

  it("owes no repair turn when no delivered feedback names the answered turn for the agent", async () => {
    for (const [events, reason] of [
      [[], "no feedback was delivered"],
      [[failure(undefined)], "named no ordinary turn"],
      [[failure(P, "someone-else")], "addressed to someone-else"],
    ] as const) {
      const evidence = await observeFeedbackRepair(session([...events], {}), answer);
      expect(evidence.repairTurnId).toBeNull();
      expect(evidence.outcome).toBe("not_owed");
      expect(evidence.notOwed).toContain(reason);
    }
  });
});

describe("declarations", () => {
  it("are explicit-only user-level cases", () => {
    expect(richUiPropensityTests).toHaveLength(RICH_UI_PROMPTS.length + 1);
    for (const test of richUiPropensityTests) {
      expect(test.explicitOnly).toBe(true);
      expect(test.category).toBe("rich-ui-propensity");
      expect(() => assertSystemTestDeclaration(test)).not.toThrow();
    }
  });
});
