import { expect, it } from "vitest";
import {
  clientDiagnosticsMeaningReview,
  clientDiagnosticsObservations,
  requestedClientAnswer,
} from "./client-diagnostics-meaning.js";

it("requires the requested answer without an authored outcome enum or receipt echo", () => {
  const answer = "Visitors wait by Sand Door; staff report to Pump Room.";
  for (const outcome of ["healthy", "local-disagreement", "held", undefined]) {
    expect(
      requestedClientAnswer({
        decision: { outcome, answer, evidenceIds: ["diagnostic-only"] },
      }),
    ).toBe(answer);
  }
  for (const value of [
    null,
    {},
    { decision: {} },
    { decision: { answer: " " } },
    { decision: { answer: 7 } },
  ])
    expect(requestedClientAnswer(value)).toBe(null);
});

it("a nonempty unsupported answer requires independent meaning review rather than passing a word gate", () => {
  const observations = {
    views: [{ audience: "Visitors", text: "Wait by Sand Door." }],
    trace: [],
    handoff: null,
  };
  const result = clientDiagnosticsMeaningReview(
    "Where do visitors wait?",
    observations,
    { decision: { outcome: "healthy", answer: "Invented destination" } },
  );
  expect(result.semanticReviewRequired).toBe(true);
  expect(result.semanticReviewInput.actual).toEqual({
    goal: "Where do visitors wait?",
    observations,
    requestedAnswer: "Invented destination",
  });
  expect(result.semanticReviewInput.expected).toEqual({
    goal: "Where do visitors wait?",
    requestedAnswerRequired: true,
  });
  expect(JSON.stringify(result.semanticReviewInput.expected)).not.toContain(
    "healthy",
  );
});

it("binds the actual answer and native chronology/handoff without giving the reviewer gold phrases", () => {
  const observations = {
    catalog: [{ id: "owned" }],
    views: [{ id: "v1", text: "Sand Door" }],
    trace: [{ kind: "observe", surface: "owned" }],
    journal: [{ method: "observe", args: ["owned"] }],
    final: { owned: { text: "Sand Door" } },
    channel: null,
    handoff: { audience: "crew", answer: "Use Sand Door" },
  };
  const review = clientDiagnosticsMeaningReview(
    "Inspect the owned display and leave the crew a note.",
    observations,
    { decision: { answer: "Use the Sand Door." } },
  );
  expect(review.semanticReviewInput.actual.observations).toBe(observations);
  expect(review.semanticReviewInput.actual.requestedAnswer).toBe(
    "Use the Sand Door.",
  );
  expect(Object.keys(review.semanticReviewInput.expected)).toEqual([
    "goal",
    "requestedAnswerRequired",
  ]);
});

it("an actual retained handoff does not require an incidental final return", () => {
  const observations = {
    handoff: { audience: "crew", answer: "Wait by Sand Door" },
  };
  const review = clientDiagnosticsMeaningReview(
    "Leave the crew a local shift note.",
    observations,
    null,
    false,
  );
  expect(review.semanticReviewRequired).toBe(true);
  expect(review.semanticReviewInput.actual.requestedAnswer).toBe(null);
  expect(review.semanticReviewInput.expected.requestedAnswerRequired).toBe(
    false,
  );
});

it("derives review observations only from actual native reads and retained handoff bytes", () => {
  const first = { surface: { id: "owned" }, text: "Sand Door" };
  const proof = {
    catalog: { surfaces: [{ id: "owned" }] },
    trace: [],
    journal: [
      {
        service: "clientDiagnostics",
        method: "observe",
        args: ["foreign"],
        result: null,
      },
      {
        service: "clientDiagnostics",
        method: "observe",
        args: ["owned"],
        result: first,
      },
      {
        service: "gadConversation",
        method: "read",
        args: ["owned"],
        result: { text: "Actual publication" },
      },
    ],
    final: { owned: first },
    durable: [],
    handoff: { audience: "crew", decision: { answer: "Native stored note" } },
  };
  const observations = clientDiagnosticsObservations(proof);
  expect(observations.views).toEqual([first]);
  expect(observations.channel.tail).toEqual({ text: "Actual publication" });
  expect(observations.handoff).toEqual({
    audience: "crew",
    answer: "Native stored note",
  });
});
