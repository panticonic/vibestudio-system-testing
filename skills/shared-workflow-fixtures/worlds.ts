type Evidence = {
  id: string;
  boundary: "panel-action" | "workspace-boot" | "build" | "agent-reply";
  cache: "cold" | "warm";
  workload: string;
  elapsedMs: number[];
};
type Comparison = {
  goal: string;
  baseline: Evidence;
  candidate: Evidence;
  budget: number;
  verdict:
    | "regression"
    | "incomparable"
    | "within-budget"
    | "insufficient-samples";
};

function authored(
  id: string,
  goal: string,
  comparison: Comparison,
  followup: string,
  trigger: number,
) {
  const prepare = comparison.verdict === "regression";
  return {
    id: `combined-${id}`,
    sourceGroups: [`vibestudio:combined:diagnosis-before-automation:${id}`],
    request: {
      goal,
      work: [
        {
          kind: "domain",
          domain: "automation",
          operation: "prepareAutomation",
          input: {
            goal: followup,
            timezone: "Europe/Berlin",
            now: "2026-11-18T09:00:00Z",
            visible: [],
            availableOperations: [],
          },
        },
        {
          kind: "domain",
          domain: "system",
          operation: "investigateSystem",
          input: {
            kind: "performance",
            goal: comparison.goal,
            baseline: comparison.baseline,
            candidate: comparison.candidate,
            regressionBudgetPercent: comparison.budget,
          },
        },
      ],
    },
    expected: {
      verdict: comparison.verdict,
      evidenceIds: [comparison.baseline.id, comparison.candidate.id],
      status: prepare
        ? "attention"
        : comparison.verdict === "within-budget"
          ? "ready"
          : "inconclusive",
      next: prepare
        ? {
            kind: "launch",
            executor: "notify",
            trigger: { kind: "schedule", everyMs: trigger },
            conversation: "continue",
            operations: [],
          }
        : null,
    },
  };
}

export const sharedWorkflowWorlds = [
  authored(
    "editor-latency-followup",
    "Compare the recorded editor opening samples. If and only if they establish a regression above budget, draft the requested reminder for this conversation. A proposal is enough.",
    {
      goal: "Compare warm editor opening runs.",
      baseline: {
        id: "editor-before",
        boundary: "panel-action",
        cache: "warm",
        workload: "open-editor",
        elapsedMs: [116, 119, 121],
      },
      candidate: {
        id: "editor-after",
        boundary: "panel-action",
        cache: "warm",
        workload: "open-editor",
        elapsedMs: [163, 165, 166],
      },
      budget: 20,
      verdict: "regression",
    },
    "Every 45 minutes in this conversation send exactly ‘Retest the editor opening’, as a fixed reminder.",
    2700000,
  ),
  authored(
    "build-followup-within-budget",
    "Compare the new build measurements with the previous revision. Draft the follow-up reminder only if the measured regression exceeds the allowed budget.",
    {
      goal: "Check budget for SDK build.",
      baseline: {
        id: "sdk-before",
        boundary: "build",
        cache: "warm",
        workload: "sdk-build",
        elapsedMs: [515, 526, 530],
      },
      candidate: {
        id: "sdk-after",
        boundary: "build",
        cache: "warm",
        workload: "sdk-build",
        elapsedMs: [528, 535, 541],
      },
      budget: 10,
      verdict: "within-budget",
    },
    "In this conversation send the fixed reminder ‘Recheck SDK build’ every 20 minutes.",
    1200000,
  ),
  authored(
    "cold-and-warm-samples-hold",
    "Use the startup profile evidence to decide if startup regressed. Keep the reminder unprepared unless a comparable measurement shows a regression.",
    {
      goal: "Compare the startup timings.",
      baseline: {
        id: "boot-cold",
        boundary: "workspace-boot",
        cache: "cold",
        workload: "start-workspace",
        elapsedMs: [2100, 2220, 2300],
      },
      candidate: {
        id: "boot-warm",
        boundary: "workspace-boot",
        cache: "warm",
        workload: "start-workspace",
        elapsedMs: [2850, 2900, 3000],
      },
      budget: 15,
      verdict: "incomparable",
    },
    "In this conversation every two hours send the fixed reminder ‘Check fresh startup’.",
    7200000,
  ),
  authored(
    "undersampled-interaction-hold",
    "Determine whether the command interaction slowed enough to warrant a recurring check. Prepare the proposed check only when the independent comparison establishes a regression.",
    {
      goal: "Compare repeated reply times for the same immediate-turn capture.",
      baseline: {
        id: "reply-paired",
        boundary: "agent-reply",
        cache: "warm",
        workload: "short-turn",
        elapsedMs: [231, 245, 255],
      },
      candidate: {
        id: "reply-single",
        boundary: "agent-reply",
        cache: "warm",
        workload: "short-turn",
        elapsedMs: [593],
      },
      budget: 15,
      verdict: "insufficient-samples",
    },
    "Every 25 minutes remind me here with exactly ‘Retest short reply’.",
    1500000,
  ),
];

export type SharedWorkflowWorld = (typeof sharedWorkflowWorlds)[number];
