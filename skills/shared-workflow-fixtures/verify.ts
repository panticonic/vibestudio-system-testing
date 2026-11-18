import { isDeepStrictEqual } from "node:util";
import type { SharedWorkflowWorld } from "./worlds.js";

type DomainResult = {
  kind: string;
  domain: string;
  operation: string;
  report: unknown;
};
type Result = { results: DomainResult[]; remaining: string[] };
type Call = { name: string; startedAt: number; endedAt: number };

export function verifySharedWorkflow(
  world: SharedWorkflowWorld,
  result: Result,
  childCalls: Call[],
) {
  const { verdict, evidenceIds, status, next } = world.expected;
  const diagnostic = result.results[0];
  const scheduled = result.results[1];
  const checks = {
    diagnostic:
      diagnostic?.kind === "domain" &&
      diagnostic.domain === "system" &&
      diagnostic.operation === "investigateSystem" &&
      isDeepStrictEqual(diagnostic.report, {
        status,
        findings: [{ code: verdict, evidenceIds }],
      }),
    gatedFollowup: next
      ? result.results.length === 2 &&
        scheduled?.kind === "domain" &&
        scheduled.domain === "automation" &&
        scheduled.operation === "prepareAutomation" &&
        isDeepStrictEqual(scheduled.report, next) &&
        result.remaining.length === 0
      : result.results.length === 1 && result.remaining.length > 0,
    actualOrder:
      childCalls[0]?.name === "investigateSystem" &&
      (next
        ? childCalls.length === 2 &&
          childCalls[1]?.name === "prepareAutomation" &&
          childCalls[0].endedAt <= childCalls[1].startedAt
        : childCalls.length === 1),
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}
