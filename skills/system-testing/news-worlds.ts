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

type Assignment = Parameters<typeof scenario>[3];
type Repair = { index: number; before: string; write: boolean };
export type NewsCadenceHandoff = {
  source: string;
};
export const newsHandoffWork = [
  { kind: "domain", domain: "news", operation: "reviewNews" },
  { kind: "domain", domain: "scratchHandoff", operation: "assembleHandoff" },
] as const;
export type NewsCadenceSettings = {
  poll: { intervalMs: number } | null;
  briefing: {
    kind: string;
    at?: string | null;
    timezone?: string | null;
    intervalMs?: number | null;
  } | null;
  owner: { paused: boolean };
};

export function projectNewsCadenceSource(
  settings: NewsCadenceSettings | null | undefined,
) {
  if (!settings) return null;
  const { poll, briefing, owner } = settings;
  if (!poll || !Number.isSafeInteger(poll.intervalMs) || poll.intervalMs <= 0)
    return null;
  let briefingLine: string;
  if (briefing?.kind === "daily" && briefing.at && briefing.timezone) {
    briefingLine = `Daily briefing: ${briefing.at} ${briefing.timezone}.`;
  } else if (
    briefing?.kind === "interval" &&
    typeof briefing.intervalMs === "number" &&
    Number.isSafeInteger(briefing.intervalMs) &&
    briefing.intervalMs > 0
  ) {
    briefingLine = `Briefing interval: ${briefing.intervalMs / 60_000} minutes.`;
  } else {
    return null;
  }
  return [
    `Feed polling interval: ${poll.intervalMs / 60_000} minutes.`,
    briefingLine,
    `Automatic briefing: ${owner.paused ? "paused" : "active"}.`,
    "",
  ].join("\n");
}

function cadenceSource(
  pollMs: number,
  briefing: NewsCadenceSettings["briefing"],
  paused: boolean,
) {
  const source = projectNewsCadenceSource({
    poll: { intervalMs: pollMs },
    briefing,
    owner: { paused },
  });
  if (!source)
    throw new Error("The handoff needs a concrete cadence assignment");
  return source;
}

export function newsHandoffSchedule<T extends { kind: string }>(
  observations: readonly T[] | undefined,
  repair?: { index: number },
): T | undefined {
  return repair
    ? observations?.[repair.index]
    : observations?.slice().reverse().find(({ kind }) => kind === "schedule");
}

function repair(
  id: string,
  goal: string,
  setup: Setup[],
  assigned: Assignment,
  index: number,
  before: string,
  write = true,
): ReturnType<typeof scenario> & { repair: Repair } {
  if (assigned[index]?.[0].kind !== "schedule")
    throw new Error("Cadence repair must select a schedule check");
  return {
    ...scenario(`reconcile-${id}`, goal, setup, assigned),
    repair: { index, before, write },
  };
}

const pollReady = (minutes: number): Assignment[number] => [
  timing("poll", minutes),
  "ready",
  "poll-confirmed",
];
const intervalReady = (minutes: number): Assignment[number] => [
  timing("interval", minutes),
  "ready",
  "briefing-confirmed",
];
const dailyReady = (at: string, timezone: string): Assignment[number] => [
  daily(at, timezone),
  "ready",
  "briefing-confirmed",
];
const pauseReady: Assignment[number] = [
  control("pause"),
  "ready",
  "pause-confirmed",
];
const resumeReady: Assignment[number] = [
  control("resume"),
  "ready",
  "resume-confirmed",
];
const manualReady: Assignment[number] = [
  control("manual"),
  "ready",
  "manual-available",
];

export const managedNewsWorlds: (ReturnType<typeof scenario> & {
  repair?: Repair;
  handoff?: NewsCadenceHandoff;
})[] = [
  {
    ...scenario(
      "handoff-stale-feed-cadence",
      "Check whether the old 30-minute feed poll is still installed. Stage a scratch handoff with the actual poll rate and the paused Berlin briefing schedule. Leave both schedules alone.",
      [
        pause(true),
        schedule({
          pollIntervalMs: 5_400_000,
          briefingAt: "07:45",
          timezone: "Europe/Berlin",
        }),
      ],
      [
        [timing("poll", 30), "attention", "poll-mismatch"],
        dailyReady("07:45", "Europe/Berlin"),
        pauseReady,
      ],
    ),
    handoff: {
      source: cadenceSource(
        5_400_000,
        { kind: "daily", at: "07:45", timezone: "Europe/Berlin" },
        true,
      ),
    },
  },
  {
    ...repair(
      "handoff-after-feed-change",
      "Change feed checks to twenty minutes and leave the paused briefing in its Chicago slot. Stage a scratch handoff from the verified post-change mission settings.",
      [
        pause(true),
        schedule({ briefingAt: "08:30", timezone: "America/Chicago" }),
      ],
      [dailyReady("08:30", "America/Chicago"), pollReady(20), pauseReady],
      1,
      "poll-mismatch",
    ),
    handoff: {
      source: cadenceSource(
        1_200_000,
        { kind: "daily", at: "08:30", timezone: "America/Chicago" },
        true,
      ),
    },
  },
  {
    ...repair(
      "handoff-after-switching-to-interval",
      "Replace the fixed Singapore briefing slot with a three-hour interval while automatic delivery stays paused. Give the next shift the actual briefing mode, pause state and feed cadence.",
      [
        pause(true),
        schedule({
          briefingAt: "09:15",
          timezone: "Asia/Singapore",
          pollIntervalMs: 2_400_000,
        }),
      ],
      [pauseReady, intervalReady(180), pollReady(40)],
      1,
      "briefing-mismatch",
    ),
    handoff: {
      source: cadenceSource(
        2_400_000,
        { kind: "interval", intervalMs: 10_800_000 },
        true,
      ),
    },
  },
  {
    ...repair(
      "handoff-after-declining-unsupported-cadence",
      "Change the paused briefing to five minutes only if supported. Hand the next shift the verified settings after the decision, including the separate 75-minute feed poll.",
      [
        pause(true),
        schedule({ briefingIntervalMs: 9_000_000, pollIntervalMs: 4_500_000 }),
      ],
      [
        pollReady(75),
        [timing("interval", 5), "blocked", "briefing-interval-too-short"],
        pauseReady,
        intervalReady(150),
      ],
      1,
      "briefing-interval-too-short",
      false,
    ),
    handoff: {
      source: cadenceSource(
        4_500_000,
        { kind: "interval", intervalMs: 9_000_000 },
        true,
      ),
    },
  },
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
  repair(
    "quieter-poll",
    "Cut source traffic by checking every two hours. Keep the active daily-interval briefing on its existing cadence.",
    [],
    [intervalReady(1440), pollReady(120), resumeReady],
    1,
    "poll-mismatch",
  ),
  repair(
    "faster-poll-while-paused",
    "Change feed checking to twenty minutes while keeping the daily Berlin briefing paused.",
    [pause(true), schedule({ briefingAt: "07:45", timezone: "Europe/Berlin" })],
    [pauseReady, dailyReady("07:45", "Europe/Berlin"), pollReady(20)],
    2,
    "poll-mismatch",
  ),
  repair(
    "minimum-supported-poll",
    "Set the source check to one minute and leave the paused briefing policy alone.",
    [pause(true)],
    [pollReady(1), pauseReady, intervalReady(1440)],
    0,
    "poll-mismatch",
  ),
  repair(
    "decline-subminute-poll",
    "Try a 45-second poll only if supported. Confirm the hourly poll is still installed if the request is refused.",
    [schedule({ pollIntervalMs: 3_600_000 })],
    [
      [timing("poll", 0.75), "blocked", "poll-interval-too-short"],
      pollReady(60),
      resumeReady,
    ],
    0,
    "poll-interval-too-short",
    false,
  ),
  repair(
    "same-poll-no-rewrite",
    "Make sure the feed poll is hourly. Avoid a redundant edit and confirm the briefing still runs every two hours.",
    [schedule({ pollIntervalMs: 3_600_000, briefingIntervalMs: 7_200_000 })],
    [intervalReady(120), pollReady(60)],
    1,
    "poll-confirmed",
    false,
  ),
  repair(
    "choose-local-clock",
    "Switch briefings to 08:15 New York time. Keep the current source-check rate and the existing pause.",
    [pause(true), schedule({ pollIntervalMs: 2_700_000 })],
    [dailyReady("08:15", "America/New_York"), pollReady(45), pauseReady],
    0,
    "briefing-mismatch",
  ),
  repair(
    "preserve-wall-clock-change-zone",
    "Keep the 08:30 local clock time but move the paused briefing from New York to Chicago.",
    [
      pause(true),
      schedule({ briefingAt: "08:30", timezone: "America/New_York" }),
    ],
    [pollReady(30), dailyReady("08:30", "America/Chicago"), pauseReady],
    1,
    "briefing-mismatch",
  ),
  repair(
    "preserve-zone-change-clock",
    "Move the existing Berlin briefing to 17:35 local time. Keep automatic delivery paused and leave the poll alone.",
    [pause(true), schedule({ briefingAt: "14:20", timezone: "Europe/Berlin" })],
    [pauseReady, pollReady(30), dailyReady("17:35", "Europe/Berlin")],
    2,
    "briefing-mismatch",
  ),
  repair(
    "exact-daily-no-rewrite",
    "If the configured briefings are already at 06:15 Los Angeles time leave them alone. Check that a manual run is still available while paused.",
    [
      pause(true),
      schedule({ briefingAt: "06:15", timezone: "America/Los_Angeles" }),
    ],
    [manualReady, dailyReady("06:15", "America/Los_Angeles")],
    1,
    "briefing-confirmed",
    false,
  ),
  repair(
    "leave-wall-clock-for-interval",
    "Replace the fixed UTC slot with a three-hour briefing cadence. Leave the automatic briefing paused for now.",
    [pause(true), schedule({ briefingAt: "13:45", timezone: "UTC" })],
    [pauseReady, intervalReady(180), pollReady(30)],
    1,
    "briefing-mismatch",
  ),
  repair(
    "minimum-supported-briefing",
    "Set the fastest supported ten-minute briefing interval without resuming delivery. Verify the cadence independently of feed checks.",
    [pause(true), schedule({ pollIntervalMs: 4_500_000 })],
    [intervalReady(10), pollReady(75), pauseReady],
    0,
    "briefing-mismatch",
  ),
  repair(
    "decline-too-short-briefing",
    "Only change automatic briefings to five minutes if supported. Otherwise confirm the paused 19:00 Tokyo slot is still installed.",
    [pause(true), schedule({ briefingAt: "19:00", timezone: "Asia/Tokyo" })],
    [
      dailyReady("19:00", "Asia/Tokyo"),
      [timing("interval", 5), "blocked", "briefing-interval-too-short"],
      pauseReady,
    ],
    1,
    "briefing-interval-too-short",
    false,
  ),
  repair(
    "pause-keep-daily-anchor",
    "Pause automatic delivery while preserving the daily 18:00 London time and the option to request a briefing manually.",
    [schedule({ briefingAt: "18:00", timezone: "Europe/London" })],
    [dailyReady("18:00", "Europe/London"), pauseReady, manualReady],
    1,
    "pause-state-mismatch",
  ),
  repair(
    "resume-keep-interval",
    "Resume the paused 90-minute briefing. Check that the 40-minute source check is still independent.",
    [
      pause(true),
      schedule({ briefingIntervalMs: 5_400_000, pollIntervalMs: 2_400_000 }),
    ],
    [pollReady(40), resumeReady, intervalReady(90)],
    1,
    "pause-state-mismatch",
  ),
  repair(
    "already-paused-reader-scan",
    "Leave delivery paused if it already is. Confirm that the configured saved-story view and manual briefing access are still available.",
    [pause(true), preference("Follow housing and municipal finance.")],
    [[reader("saved"), "ready", "empty-loaded-view"], pauseReady, manualReady],
    1,
    "pause-confirmed",
    false,
  ),
  repair(
    "already-running-reader-setup",
    "Resume automatic delivery only if needed. Independently tell me whether News still needs preferences before the inbox can be used.",
    [],
    [resumeReady, [reader("inbox"), "waiting", "preferences-needed"]],
    0,
    "resume-confirmed",
    false,
  ),
];
