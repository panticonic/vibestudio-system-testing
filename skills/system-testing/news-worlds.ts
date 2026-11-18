export const newsPanel = "panels/news";
export const newsWorker = "workers/news-agent";
type Status = "ready" | "attention" | "waiting" | "blocked";
type Intent =
  | { kind: "poll" | "interval"; intervalMs: number }
  | { kind: "daily"; at: string; timezone: string }
  | { kind: "pause" | "resume" | "manual" };
type Check =
  | { kind: "reader"; view: "inbox" | "saved" | "backlog" }
  | { kind: "reader"; view: "archive"; query: string }
  | { kind: "schedule"; intent: Intent };
type Setup = {
  method: "news_set_preferences" | "setSchedule" | "setBriefingPaused";
  args: Record<string, unknown>;
};

const preference = (text: string): Setup => ({
  method: "news_set_preferences",
  args: { text },
});
const schedule = (args: Setup["args"]): Setup => ({
  method: "setSchedule",
  args,
});
const pause = (paused: boolean): Setup => ({
  method: "setBriefingPaused",
  args: { paused },
});
const timing = (kind: "poll" | "interval", minutes: number): Check => ({
  kind: "schedule",
  intent: { kind, intervalMs: minutes * 60_000 },
});
const daily = (at: string, timezone: string): Check => ({
  kind: "schedule",
  intent: { kind: "daily", at, timezone },
});
const control = (kind: "pause" | "resume" | "manual"): Check => ({
  kind: "schedule",
  intent: { kind },
});
const reader = (view: "inbox" | "saved" | "backlog"): Check => ({
  kind: "reader",
  view,
});

function scenario(
  id: string,
  goal: string,
  setup: Setup[],
  assigned: [Check, Status, string][],
  panel = false,
) {
  return {
    id,
    goal,
    setup,
    panel,
    checks: assigned.map(([check]) => check),
    expected: assigned.map(([, status, code]) => ({ status, code })),
  };
}

export const managedNewsWorlds = [
  scenario(
    "before-preferences",
    "Distinguish initial preference setup from a settled empty inbox.",
    [],
    [[reader("inbox"), "waiting", "preferences-needed"]],
    true,
  ),
  scenario(
    "configured-quiet-inbox",
    "Review the inbox after reading preferences are saved, before adding a source.",
    [preference("Prefer public transport reporting and concise summaries.")],
    [[reader("inbox"), "ready", "empty-loaded-view"]],
    true,
  ),
  scenario(
    "saved-and-archive-empty",
    "Check separately for saved stories and archival findings about ferry repairs.",
    [preference("Focus on ferry maintenance.")],
    [
      [reader("saved"), "ready", "empty-loaded-view"],
      [
        { kind: "reader", view: "archive", query: "ferry repairs" },
        "ready",
        "empty-loaded-view",
      ],
    ],
  ),
  scenario(
    "baseline-dual-cadence",
    "Verify the new curator's separate polling and briefing cadences.",
    [],
    [
      [timing("poll", 30), "ready", "poll-confirmed"],
      [timing("interval", 1440), "ready", "briefing-confirmed"],
    ],
  ),
  scenario(
    "poll-edit",
    "Verify the edited polling cadence and confirm that the briefing interval stayed independent.",
    [schedule({ pollIntervalMs: 45 * 60_000 })],
    [
      [timing("poll", 45), "ready", "poll-confirmed"],
      [timing("interval", 1440), "ready", "briefing-confirmed"],
    ],
  ),
  scenario(
    "stale-poll-expectation",
    "Tell me whether the old poll preference still matches the installed mission.",
    [schedule({ pollIntervalMs: 90 * 60_000 })],
    [[timing("poll", 30), "attention", "poll-mismatch"]],
  ),
  scenario(
    "daily-local-time",
    "Verify the morning briefing's wall-clock time and timezone separately from the feed cadence.",
    [pause(true), schedule({ briefingAt: "07:45", timezone: "Europe/Berlin" })],
    [
      [daily("07:45", "Europe/Berlin"), "ready", "briefing-confirmed"],
      [timing("poll", 30), "ready", "poll-confirmed"],
    ],
  ),
  scenario(
    "daily-wrong-zone",
    "Check whether the same clock time in a different timezone satisfies the briefing request.",
    [
      pause(true),
      schedule({ briefingAt: "08:30", timezone: "America/New_York" }),
    ],
    [[daily("08:30", "America/Chicago"), "attention", "briefing-mismatch"]],
  ),
  scenario(
    "manual-while-paused",
    "Verify the pause, then decide if a human can still request a manual briefing.",
    [pause(true)],
    [
      [control("pause"), "ready", "pause-confirmed"],
      [control("manual"), "ready", "manual-available"],
    ],
  ),
  scenario(
    "resumed-interval",
    "After resuming automatic briefings, verify the chosen two-hour briefing interval.",
    [pause(true), schedule({ briefingIntervalMs: 120 * 60_000 }), pause(false)],
    [
      [control("resume"), "ready", "resume-confirmed"],
      [timing("interval", 120), "ready", "briefing-confirmed"],
    ],
  ),
  scenario(
    "daily-to-interval",
    "Verify that clearing the daily clock time switches the briefing to its ordinary interval.",
    [
      pause(true),
      schedule({ briefingAt: "16:00", timezone: "UTC" }),
      schedule({ briefingAt: null }),
    ],
    [
      [timing("interval", 1440), "ready", "briefing-confirmed"],
      [daily("16:00", "UTC"), "attention", "briefing-mismatch"],
    ],
  ),
  scenario(
    "bounded-refresh-intent",
    "Review an overly frequent poll request alongside the configured reader's backlog.",
    [preference("Track river flood warnings and infrastructure notices.")],
    [
      [timing("poll", 0.5), "blocked", "poll-interval-too-short"],
      [reader("backlog"), "ready", "empty-loaded-view"],
    ],
  ),
  scenario(
    "bounded-briefing-intent",
    "Review a five-minute briefing request while confirming the existing hourly poll.",
    [schedule({ pollIntervalMs: 60 * 60_000 })],
    [
      [timing("interval", 5), "blocked", "briefing-interval-too-short"],
      [timing("poll", 60), "ready", "poll-confirmed"],
    ],
  ),
  scenario(
    "saved-and-paused",
    "Review the saved tab and independently verify the automatic-break period.",
    [preference("Prefer context-rich explainers."), pause(true)],
    [
      [reader("saved"), "ready", "empty-loaded-view"],
      [control("pause"), "ready", "pause-confirmed"],
    ],
  ),
];
