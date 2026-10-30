import { defineEvaluationSuite } from "@workspace/natlang/evaluation";
import {
  executorIdentityForChoice,
  loadModelConfiguration,
} from "@workspace/natlang/model";
import type { Failure, FailureClass, SignalSource, Triage } from "./types.js";

type CaseInput = { failure: Failure };
type CaseExpected = { class: FailureClass; decisive: SignalSource };

// Gates for porting (DECOMPOSITION.md): the class is right on at least 0.85 of validation and of the locked test split.
export default defineEvaluationSuite<CaseInput, CaseExpected>({
  id: "triage-failure-v1",
  program: { root: ".", id: "triage-failure", entry: "natlang.ts" },
  components: "lambda-only",
  cases: "./cases.jsonl",
  models: { executor: "default" },
  executorIdentity: executorIdentityForChoice(
    loadModelConfiguration("default").choice,
  ),
  policy: {
    codeEdits: "deny",
    settings: { maxTurns: 6, turnTokens: 512, contextTokens: 8192 },
  },
  budget: { maxRollouts: 60, maxProposals: 0, maxModelCalls: 400 },
  fixture: {
    async create(testCase, context) {
      const app = (await context.loadFreshProgram()) as {
        triageFailure: { triage(failure: Failure): Promise<Triage> };
      };
      return {
        execute: () =>
          context.runtime.run(() =>
            app.triageFailure.triage(testCase.input.failure),
          ),
      };
    },
  },
  score(testCase, observation, outcome) {
    const result = (observation as { result?: Triage }).result;
    const expected = testCase.expected!;
    if (outcome.kind !== "returned" || !result) {
      return {
        quality: 0,
        gates: { completed: false, evidenced: false },
        feedback: `No triage: ${outcome.error?.message ?? "no result"}`,
      };
    }
    const correct = result.class === expected.class;
    const quotesDecisive = result.evidence.some(
      (signal) => signal.source === expected.decisive,
    );
    return {
      quality: correct ? 1 : 0,
      metrics: { decisiveEvidence: quotesDecisive ? 1 : 0 },
      gates: { completed: true, evidenced: result.evidence.length > 0 },
      feedback: correct
        ? "Correct."
        : `Expected ${expected.class}; observed ${result.class}.`,
    };
  },
  feedback(testCase, result) {
    return {
      input: testCase.input.failure.name,
      actual: result.outcome.value ?? null,
    };
  },
});
