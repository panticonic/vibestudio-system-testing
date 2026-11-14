import { describe, expect, it, vi } from "vitest";
import { judgeReportClaims, reportClaimsOf } from "./report-claims.js";
import type { ReportClaimJudge, TestCase, TestExecutionResult } from "./types.js";

const claims = [
  { id: "size", claim: "The size that was checked is reported.", match: /\b\d+\s*bytes?\b/iu },
  { id: "same", claim: "The bytes read back are exactly the bytes stored." },
];

describe("judgeReportClaims", () => {
  it("passes each claim's pattern as source text and records every verdict", async () => {
    const judge = vi.fn<ReportClaimJudge>(async () => ({
      satisfied: true,
      verdicts: [
        { id: "size", verdict: "states", quote: "Checked 8 bytes.", by: "match" },
        { id: "same", verdict: "states", quote: "They were identical.", by: "model" },
      ],
    }));
    const result = await judgeReportClaims(claims, "Checked 8 bytes. They were identical.", judge);
    expect(judge).toHaveBeenCalledWith("Checked 8 bytes. They were identical.", [
      { id: "size", claim: claims[0]!.claim, match: "\\b\\d+\\s*bytes?\\b" },
      { id: "same", claim: claims[1]!.claim },
    ]);
    expect(result).toEqual({ passed: true, details: { reportClaims: (await judge.mock.results[0]!.value).verdicts } });
  });

  it("fails naming each claim that is absent or contradicted, with its quote", async () => {
    const result = await judgeReportClaims(claims, "x", async () => ({
      satisfied: false,
      verdicts: [
        { id: "size", verdict: "absent", by: "model" },
        { id: "same", verdict: "contradicts", quote: "The last two bytes differ.", by: "model" },
      ],
    }));
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(
      'The final report does not state: The size that was checked is reported.; contradicts: The bytes read back are exactly the bytes stored. ("The last two bytes differ.")',
    );
    expect(result.details?.["reportClaims"]).toHaveLength(2);
  });

  it("is a validator failure, not a verdict, when there is no judge or a pattern has other flags", async () => {
    await expect(judgeReportClaims(claims, "x", undefined)).rejects.toThrow(/no claim judge/);
    await expect(
      judgeReportClaims([{ id: "g", claim: "c", match: /a/gu }], "x", async () => ({ satisfied: true, verdicts: [] })),
    ).rejects.toThrow(/flags i and u only/);
  });
});

describe("reportClaimsOf", () => {
  const execution = { messages: [], duration: 1 } as TestExecutionResult;
  const base = { name: "t", description: "", category: "c", prompt: "", validate: () => ({ passed: true }) } satisfies TestCase;

  it("reads a declared list or derives it from the execution", () => {
    expect(reportClaimsOf(base, execution)).toEqual([]);
    expect(reportClaimsOf({ ...base, reportClaims: claims }, execution)).toBe(claims);
    expect(reportClaimsOf({ ...base, reportClaims: (result) => [{ id: "d", claim: `took ${result.duration} ms` }] }, execution)).toEqual([
      { id: "d", claim: "took 1 ms" },
    ]);
  });
});
