/**
 * Judge a test's report claims against the agent's final report. `validate` keeps the exact checks; a claim is a fact
 * whose wording the agent chooses, so it is judged by meaning (the Base `claimCheck` natlang program), with each
 * claim's own pattern as the first, model-free reading. Every verdict is recorded in the result.
 */
import type {
  ReportClaim,
  ReportClaimJudge,
  TestCase,
  TestExecutionResult,
  TestResult,
} from "./types.js";

function patternSource(claim: ReportClaim): string | undefined {
  if (!claim.match) return undefined;
  if (/[^iu]/u.test(claim.match.flags)) {
    throw new Error(
      `report claim ${claim.id}: its pattern may use the flags i and u only, not "${claim.match.flags}"`,
    );
  }
  return claim.match.source;
}

/** The claims a test declares for this execution, or none. */
export function reportClaimsOf(
  test: TestCase,
  execution: TestExecutionResult,
): readonly ReportClaim[] {
  const declared = test.reportClaims;
  if (!declared) return [];
  return typeof declared === "function" ? declared(execution) : declared;
}

/**
 * The verdict of the report claims: passed when every claim is stated. Throws when claims exist but no judge was
 * given, or when the judge fails: either is a failure of the validator, not of the agent.
 */
export async function judgeReportClaims(
  claims: readonly ReportClaim[],
  report: string,
  judge: ReportClaimJudge | undefined,
): Promise<TestResult> {
  if (!judge) {
    throw new Error(
      "This test declares report claims, and the runner was given no claim judge (the runner's eval loads it from the natlang provider)",
    );
  }
  const checked = await judge(
    report,
    claims.map((claim) => {
      const match = patternSource(claim);
      return { id: claim.id, claim: claim.claim, ...(match !== undefined ? { match } : {}) };
    }),
  );
  const details = { reportClaims: checked.verdicts };
  if (checked.satisfied) return { passed: true, details };
  const missing = checked.verdicts.flatMap((verdict) => {
    if (verdict.verdict === "states") return [];
    const claim = claims.find((candidate) => candidate.id === verdict.id);
    const quote = verdict.quote ? ` ("${verdict.quote.slice(0, 160)}")` : "";
    return [`${verdict.verdict === "absent" ? "does not state" : "contradicts"}: ${claim?.claim ?? verdict.id}${quote}`];
  });
  return {
    passed: false,
    reason: `The final report ${missing.join("; ")}`,
    details,
  };
}

/** The claims whose own pattern does not occur in the report: those the judge's model decides. */
export function claimsLeftToJudge(claims: readonly ReportClaim[], report: string): ReportClaim[] {
  return claims.filter((claim) => !claim.match || !new RegExp(claim.match.source, claim.match.flags).test(report));
}
