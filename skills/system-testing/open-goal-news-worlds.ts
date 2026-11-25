type NewsSeedOperation = {
  method: "news_set_preferences" | "setSchedule" | "setBriefingPaused";
  args: Record<string, unknown>;
};

type CadenceIntent =
  | { kind: "poll"; intervalMs: number }
  | { kind: "interval"; intervalMs: number }
  | { kind: "daily"; at: string; timezone: string }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "manual" };
type ReaderSelection =
  | { kind: "inbox" | "saved" | "backlog" }
  | { kind: "archive"; query: string };
type ReaderCode = "preferences-needed" | "empty-loaded-view";
type ScheduleCode =
  | "poll-confirmed"
  | "poll-mismatch"
  | "poll-interval-too-short"
  | "briefing-confirmed"
  | "briefing-mismatch"
  | "briefing-interval-too-short"
  | "pause-confirmed"
  | "resume-confirmed"
  | "manual-available";
type Grant = "poll" | "briefing" | "pause";
type ScheduleFinding = { intent: CadenceIntent; code: ScheduleCode };

export const newsGoalRequiresUnits = [
  "skills/open-user-goal",
  "skills/news-workflows",
  "packages/news-live-evidence",
  "workers/news-agent",
];
export const openNewsChecks = [
  "readCurrentNews",
  "verifiedCadence",
  "verifiedReaderViews",
  "groundedScheduleFindings",
  "verifiedAuthorizedChanges",
] as const;

export type NewsGoalWorld = {
  kind: "news";
  workspace: "news";
  id: string;
  sourceGroup: string;
  split?: "test";
  goal: string;
  requestedReturnRequired: boolean;
  setup: NewsSeedOperation[];
  grants: Grant[];
  outcome: "reviewed" | "changed" | "blocked";
  applied: CadenceIntent[];
  actions: CadenceIntent[];
  concurrent?: { operation: NewsSeedOperation; change: CadenceIntent };
  schedule: ScheduleFinding[];
  readers: { selection: ReaderSelection; code: ReaderCode }[];
};

const minutes = (value: number) => value * 60_000;
const poll = (minutes_: number): CadenceIntent => ({
  kind: "poll",
  intervalMs: minutes(minutes_),
});
const interval = (minutes_: number): CadenceIntent => ({
  kind: "interval",
  intervalMs: minutes(minutes_),
});
const daily = (at: string, timezone: string): CadenceIntent => ({
  kind: "daily",
  at,
  timezone,
});
const pause = { kind: "pause" } as const;
const resume = { kind: "resume" } as const;
const manual = { kind: "manual" } as const;
const schedule = (args: Record<string, unknown>): NewsSeedOperation => ({
  method: "setSchedule",
  args,
});
const setPaused = (paused: boolean): NewsSeedOperation => ({
  method: "setBriefingPaused",
  args: { paused },
});
const preferences = (text: string): NewsSeedOperation => ({
  method: "news_set_preferences",
  args: { text },
});

type Inputs = Omit<
  NewsGoalWorld,
  | "kind"
  | "workspace"
  | "sourceGroup"
  | "grants"
  | "outcome"
  | "applied"
  | "actions"
  | "schedule"
  | "readers"
> &
  Partial<
    Pick<
      NewsGoalWorld,
      "grants" | "outcome" | "applied" | "actions" | "schedule" | "readers"
    >
  > & { group: string };
function newsGoal({ group, ...input }: Inputs): NewsGoalWorld {
  return {
    kind: "news",
    workspace: "news",
    sourceGroup: `vibestudio:news:open-goal:${group}`,
    grants: [],
    outcome: "reviewed",
    applied: [],
    actions: [],
    schedule: [],
    readers: [],
    ...input,
  };
}

export const newsGoalWorlds = [
  newsGoal({
    id: "explain-news-first-empty-inbox",
    group: "reader-setup",
    goal: "The newsroom inbox looks empty on this new workspace. Can the editor start looking for stories now, or does someone need to finish setup first? Leave my reader settings alone.",
    requestedReturnRequired: true,
    setup: [],
    readers: [{ selection: { kind: "inbox" }, code: "preferences-needed" }],
  }),
  newsGoal({
    id: "reconcile-saved-and-current-news-views",
    group: "configured-views",
    goal: "Yesterday's handoff said this reader was unconfigured. Before we resend setup instructions, see whether the current inbox and saved stories can actually load. Tell me which views are simply empty. Please don't change the feed or briefing.",
    requestedReturnRequired: true,
    setup: [preferences("Follow county budgets and regional rail.")],
    readers: [
      { selection: { kind: "inbox" }, code: "empty-loaded-view" },
      { selection: { kind: "saved" }, code: "empty-loaded-view" },
    ],
  }),
  newsGoal({
    id: "audit-paused-berlin-briefing",
    group: "daily-owner-readback",
    goal: "The opening shift thinks Berlin's automatic 07:45 briefing paused feed checks too. Check whether the 90-minute poll and the daily Berlin schedule are still in place, whether automatic delivery is paused, and whether they can request a manual briefing. Inspect only.",
    requestedReturnRequired: true,
    setup: [
      schedule({
        pollIntervalMs: minutes(90),
        briefingAt: "07:45",
        timezone: "Europe/Berlin",
      }),
      setPaused(true),
    ],
    schedule: [
      { intent: poll(90), code: "poll-confirmed" },
      { intent: daily("07:45", "Europe/Berlin"), code: "briefing-confirmed" },
      { intent: pause, code: "pause-confirmed" },
      { intent: manual, code: "manual-available" },
    ],
  }),
  newsGoal({
    id: "accelerate-source-checks-with-chicago-slot-protected",
    group: "feed-poll-reconciliation",
    goal: "For election week we need fresh sources every twenty minutes. Change the feed polling rate and check it actually took. Keep the Chicago 08:30 daily briefing paused exactly as it is.",
    requestedReturnRequired: false,
    setup: [
      schedule({
        pollIntervalMs: minutes(70),
        briefingAt: "08:30",
        timezone: "America/Chicago",
      }),
      setPaused(true),
    ],
    grants: ["poll"],
    outcome: "changed",
    actions: [poll(20)],
    applied: [poll(20)],
    schedule: [{ intent: poll(20), code: "poll-confirmed" }],
  }),
  newsGoal({
    id: "replace-overnight-slot-with-interval",
    group: "briefing-mode-transition",
    goal: "The Singapore team no longer wants a fixed overnight slot. Move the briefing to a three-hour interval, but don't resume delivery or touch feed polling. Confirm the new cadence for the handoff.",
    requestedReturnRequired: true,
    setup: [
      schedule({
        pollIntervalMs: minutes(40),
        briefingAt: "02:15",
        timezone: "Asia/Singapore",
      }),
      setPaused(true),
    ],
    grants: ["briefing"],
    outcome: "changed",
    actions: [interval(180)],
    applied: [interval(180)],
    schedule: [{ intent: interval(180), code: "briefing-confirmed" }],
  }),
  newsGoal({
    id: "resume-keep-interval-and-reader-setup",
    group: "pause-resume-state",
    goal: "We are back from holiday. Resume automatic delivery if it is still paused, preserve the 90-minute briefing cadence and 40-minute feed poll, and check whether we have to fill in News preferences before using the inbox.",
    requestedReturnRequired: true,
    setup: [
      schedule({
        pollIntervalMs: minutes(40),
        briefingIntervalMs: minutes(90),
      }),
      setPaused(true),
    ],
    grants: ["pause"],
    outcome: "changed",
    actions: [resume],
    applied: [resume],
    schedule: [{ intent: resume, code: "resume-confirmed" }],
    readers: [{ selection: { kind: "inbox" }, code: "preferences-needed" }],
  }),
  newsGoal({
    id: "decline-unavailable-rapid-briefing",
    group: "unsupported-briefing-cadence",
    goal: "Can we shorten the automatic briefing to five minutes? Only apply that if the installed scheduler supports it. Otherwise confirm that the paused Tokyo 19:00 slot is still configured.",
    requestedReturnRequired: true,
    setup: [
      schedule({
        pollIntervalMs: minutes(65),
        briefingAt: "19:00",
        timezone: "Asia/Tokyo",
      }),
      setPaused(true),
    ],
    grants: ["briefing"],
    outcome: "blocked",
    actions: [interval(5)],
    schedule: [
      { intent: interval(5), code: "briefing-interval-too-short" },
      { intent: daily("19:00", "Asia/Tokyo"), code: "briefing-confirmed" },
      { intent: pause, code: "pause-confirmed" },
    ],
  }),
  newsGoal({
    id: "keep-sufficient-poll-cadence",
    group: "conditional-noop",
    goal: "Our publisher asked for a source check every 25 minutes. If that's already what is running, leave it alone and confirm the existing setting. Also check the saved-story view without opening a briefing.",
    requestedReturnRequired: true,
    setup: [
      schedule({
        pollIntervalMs: minutes(25),
        briefingIntervalMs: minutes(140),
      }),
      preferences("Follow public health and bus networks."),
    ],
    grants: ["poll"],
    actions: [poll(25)],
    schedule: [{ intent: poll(25), code: "poll-confirmed" }],
    readers: [{ selection: { kind: "saved" }, code: "empty-loaded-view" }],
  }),
  newsGoal({
    id: "pause-then-speed-up-storm-desk",
    group: "multi-lane-storm-desk",
    goal: "We're following a storm on the live desk. First pause automatic briefings so alerts don't go out to the wrong list. Then increase feed checks to every fifteen minutes. Preserve the New York 06:50 briefing time for when the desk resumes, and confirm manual briefings are still available.",
    requestedReturnRequired: true,
    setup: [
      schedule({
        pollIntervalMs: minutes(45),
        briefingAt: "06:50",
        timezone: "America/New_York",
      }),
    ],
    grants: ["poll", "pause"],
    outcome: "changed",
    actions: [pause, poll(15)],
    applied: [pause, poll(15)],
    schedule: [
      { intent: pause, code: "pause-confirmed" },
      { intent: poll(15), code: "poll-confirmed" },
      { intent: manual, code: "manual-available" },
    ],
  }),
  newsGoal({
    id: "preserve-desk-poll-while-moving-briefing",
    group: "concurrent-owner-update",
    goal: "Please move the paused briefing to 06:40 London time. The feed team is adjusting their poll rate separately, so preserve whichever rate they have saved when the briefing change goes through. Confirm what is actually installed.",
    requestedReturnRequired: true,
    setup: [
      schedule({
        pollIntervalMs: minutes(45),
        briefingAt: "07:20",
        timezone: "Europe/London",
      }),
      setPaused(true),
    ],
    grants: ["briefing"],
    outcome: "changed",
    actions: [daily("06:40", "Europe/London")],
    applied: [daily("06:40", "Europe/London")],
    concurrent: {
      operation: schedule({ pollIntervalMs: minutes(55) }),
      change: poll(55),
    },
    schedule: [
      { intent: daily("06:40", "Europe/London"), code: "briefing-confirmed" },
    ],
  }),
  newsGoal({
    id: "check-weekend-archive-and-cadence",
    group: "weekend-retained-archive",
    split: "test",
    goal: "For the weekend shift, see whether this reader's archive has anything saved under 'estuary restoration'. A colleague said sources refresh every 45 minutes, so verify that against the live schedule and report the actual interval. Leave this workspace alone.",
    requestedReturnRequired: true,
    setup: [
      schedule({
        pollIntervalMs: minutes(75),
        briefingIntervalMs: minutes(160),
      }),
      preferences("Follow estuary restoration and municipal permitting."),
    ],
    schedule: [{ intent: poll(45), code: "poll-mismatch" }],
    readers: [
      {
        selection: { kind: "archive", query: "estuary restoration" },
        code: "empty-loaded-view",
      },
    ],
  }),
  newsGoal({
    id: "move-held-briefing-to-local-wall-clock",
    group: "held-local-wall-clock",
    split: "test",
    goal: "The Toronto team is replacing its rolling briefing with a daily 06:25 local handoff. Move only that schedule to the new time. Automatic delivery is supposed to stay paused while they verify the reader. Keep the current feed poll and confirm the actual saved timezone.",
    requestedReturnRequired: true,
    setup: [
      schedule({
        pollIntervalMs: minutes(35),
        briefingIntervalMs: minutes(210),
      }),
      setPaused(true),
    ],
    grants: ["briefing"],
    outcome: "changed",
    actions: [daily("06:25", "America/Toronto")],
    applied: [daily("06:25", "America/Toronto")],
    schedule: [
      { intent: daily("06:25", "America/Toronto"), code: "briefing-confirmed" },
      { intent: pause, code: "pause-confirmed" },
    ],
  }),
] as const;
