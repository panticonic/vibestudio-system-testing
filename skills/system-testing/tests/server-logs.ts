import type {
  TestAuthorityPolicy,
  TestCase,
  TestExecutionResult,
} from "../types.js";
import {
  NativeServerLogObservationSchema,
  type NativeServerLogObservation,
} from "@vibestudio/service-schemas/serverLog";
import {
  findLastAgentMessage,
  getToolCalls,
  hasLoadedSkill,
  noIncompleteInvocations,
} from "./_helpers.js";

const serverLogReadAuthority: TestAuthorityPolicy = {
  authority: [
    {
      ruleId: "inspect-server-host-logs",
      capability: { kind: "exact", key: "server-logs.read" },
      resource: { kind: "exact", key: "server-logs.read" },
      tier: "gated",
      decision: "once",
    },
  ],
};

function exactNumber(message: string, value: number): boolean {
  const normalized = message.replace(/\b\d{1,3}(?:,\d{3})+\b/gu, (number) =>
    number.replaceAll(",", ""),
  );
  return new RegExp(`(?:^|\\D)${value}(?:\\D|$)`, "u").test(normalized);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read facts are recorded by native dispatch before guest projection/mutation. */
function observations(
  result: TestExecutionResult,
): NativeServerLogObservation[] {
  return getToolCalls(result).flatMap((call) => {
    if (
      call.name !== "eval" ||
      call.execution?.status !== "complete" ||
      call.execution.isError
    )
      return [];
    const details = record(record(call.execution.result)?.["details"]);
    const journal = record(details?.["operationJournal"]);
    if (
      journal?.["protocol"] !== "workspace-operations.v1" ||
      journal["truncated"] !== false ||
      !Array.isArray(journal["entries"])
    )
      return [];
    return journal["entries"].flatMap((entry) => {
      const value = record(entry);
      if (value?.["type"] !== "server-log.observation") return [];
      const parsed = NativeServerLogObservationSchema.safeParse(
        value["receipt"],
      );
      return parsed.success ? [parsed.data] : [];
    });
  });
}

function startupDiagnosisChecked(result: TestExecutionResult) {
  if (!hasLoadedSkill(result, "server-logs"))
    return {
      passed: false,
      reason: "The vague incident did not route through server-log guidance",
    };
  const final = findLastAgentMessage(result);
  const snapshots = observations(result).filter(
    (receipt) => receipt.kind === "records",
  );
  if (
    !snapshots.some(
      (receipt) =>
        final.includes(receipt.serverBootId) &&
        [receipt.latestSeq, receipt.firstSeq, receipt.lastSeq].some(
          (seq) => seq !== null && exactNumber(final, seq),
        ),
    ) ||
    !/start|startup|boot|slow|delay|build|normal|warn|error|incident/iu.test(
      final,
    )
  )
    return {
      passed: false,
      reason:
        "The diagnosis did not preserve observed boot/sequence coordinates and explain the startup evidence",
    };
  return noIncompleteInvocations(result);
}

function queryStatsChecked(result: TestExecutionResult) {
  const receipts = observations(result);
  const samples = receipts.filter(
    (
      receipt,
    ): receipt is Extract<NativeServerLogObservation, { kind: "records" }> =>
      receipt.kind === "records" &&
      receipt.method === "query" &&
      ["warn", "error"].includes(receipt.minimumLevel ?? ""),
  );
  const stats = receipts.filter((receipt) => receipt.kind === "stats");
  const final = findLastAgentMessage(result);
  const reportsSample = samples.some(
    (sample) =>
      exactNumber(final, sample.count) ||
      (sample.count === 0 &&
        /no (?:warnings|errors)|zero (?:warnings|errors)/iu.test(final)),
  );
  // A later tail sequence is not the earlier statistics total. Join the
  // captured total to the clause which actually reports overall statistics.
  const statsClauses = final
    .split(/\.\s|\n/gu)
    .filter(
      (clause) =>
        /captur|total|overall|stat/iu.test(clause) &&
        /records?|entries|captur|buffer|total/iu.test(clause),
    );
  const reportsStats = stats.some((snapshot) =>
    statsClauses.some((clause) => exactNumber(clause, snapshot.totalCaptured)),
  );
  return reportsSample &&
    reportsStats &&
    /server|host/iu.test(final) &&
    /warn|error/iu.test(final)
    ? noIncompleteInvocations(result)
    : {
        passed: false,
        reason:
          "Final response did not report the observed warning sample and actual statistics total",
      };
}

function tailChecked(result: TestExecutionResult) {
  const final = findLastAgentMessage(result);
  const tails = observations(result).filter(
    (
      receipt,
    ): receipt is Extract<NativeServerLogObservation, { kind: "records" }> =>
      receipt.kind === "records" && receipt.method === "tail",
  );
  return /newest|latest|tail/iu.test(final) &&
    tails.some(
      (tail) =>
        exactNumber(final, tail.count) &&
        (tail.newestLevel
          ? final.toLowerCase().includes(tail.newestLevel)
          : /none|no entries|empty/iu.test(final)),
    )
    ? noIncompleteInvocations(result)
    : {
        passed: false,
        reason:
          "Final response did not report the observed tail count and newest severity",
      };
}

export const serverLogTests: TestCase[] = [
  {
    name: "server-log-startup-diagnosis",
    description:
      "Use recent host logs to distinguish a concrete startup incident from normal activity",
    category: "server-logs",
    authorityPolicy: serverLogReadAuthority,
    prompt:
      "Something in this workspace seemed slow to start a moment ago. Can you check the recent server logs and tell me what happened?",

    validate: startupDiagnosisChecked,
  },
  {
    name: "server-log-query-stats",
    description:
      "Query recent server host logs bounded and report log statistics",
    category: "server-logs",
    authorityPolicy: serverLogReadAuthority,
    prompt:
      "Inspect a bounded recent sample of the server's own host logs at warning level or higher, and summarize both what the sample contains and the overall log statistics.",
    validate: queryStatsChecked,
  },
  {
    name: "server-log-tail",
    description: "Tail the newest server host log entries",
    category: "server-logs",
    authorityPolicy: serverLogReadAuthority,
    prompt:
      "Look at only the newest few entries in the server's host-log tail. Tell me how many you observed and the severity of the newest entry.",
    validate: tailChecked,
  },
];
