type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;
export type IntegrationFileSeed = {
  path: string;
  baseline: JsonObject;
  local: JsonObject;
  incoming: JsonObject;
  ownership?: Record<string, "local" | "incoming">;
};

const isolated =
  "Keep all untouched fields and leave the integration in the assigned workspace without publishing.";

const multiFileWorlds: Array<{
  id: string;
  sourceGroup: string;
  goal: string;
  files: IntegrationFileSeed[];
}> = [
  {
    id: "notification-rollout",
    sourceGroup: "notification-rollout",
    goal: "Integrate the email rollout and retry policy as a pair. Keep the local three-person review quorum and bounded six worker slots. Take the incoming email enablement and retry interval of 30 seconds.",
    files: [
      {
        path: "notifications/channels.json",
        baseline: { enabled: false, quorum: 1, sender: "workspace" },
        local: { quorum: 3 },
        incoming: { enabled: true },
      },
      {
        path: "notifications/retries.json",
        baseline: { workers: 2, intervalSeconds: 10, attempts: [1, 2, 4] },
        local: { workers: 6 },
        incoming: { intervalSeconds: 30 },
      },
    ],
  },
  {
    id: "locale-catalog",
    sourceGroup: "locale-catalog",
    goal: "Integrate the regional catalog with its renderer settings. Keep the workspace's selected French locale and density. Take the incoming fallback locale list and bundled Unicode font.",
    files: [
      {
        path: "catalog/locales.json",
        baseline: { active: "en", fallbacks: ["en"], rightToLeft: false },
        local: { active: "fr-CA" },
        incoming: { fallbacks: ["fr", "en"] },
      },
      {
        path: "catalog/render.json",
        baseline: { density: "regular", font: "System", textScale: 1 },
        local: { density: "compact" },
        incoming: { font: "Noto Sans" },
      },
    ],
  },
  {
    id: "ingest-routes",
    sourceGroup: "ingest-routes",
    goal: "Integrate the revised ingest route and retention settings. Keep private visibility and a seven-day local retention cap. Adopt the incoming normalized export route and keep its explicit legal hold enabled.",
    files: [
      {
        path: "intake/route.json",
        baseline: {
          visibility: "team",
          export: { path: "/raw", kind: "json" },
          queue: "ingest",
        },
        local: { visibility: "private" },
        incoming: { export: { path: "/normalized", kind: "jsonl" } },
      },
      {
        path: "intake/retention.json",
        baseline: { days: 30, legalHold: false, snapshots: ["daily"] },
        local: { days: 7 },
        incoming: { legalHold: true },
      },
    ],
  },
  {
    id: "approved-shared-overrides",
    sourceGroup: "approved-shared-overrides",
    goal: "Integrate both rollout files. For the conflicting delivery batch size use the local cap of 10, while adding the incoming retry schedule. For the conflicting preview mode use the incoming shadow mode, while keeping the local audience limited to moderators.",
    files: [
      {
        path: "rollout/delivery.json",
        baseline: { batchSize: 20, retrySeconds: [10], review: true },
        local: { batchSize: 10 },
        incoming: { batchSize: 40, retrySeconds: [15, 45] },
        ownership: { batchSize: "local" },
      },
      {
        path: "rollout/preview.json",
        baseline: { mode: "off", audience: "team", publish: false },
        local: { mode: "internal", audience: "moderators" },
        incoming: { mode: "shadow" },
        ownership: { mode: "incoming" },
      },
    ],
  },
  {
    id: "paired-limits",
    sourceGroup: "paired-limits",
    goal: "Integrate the storage and viewer limits together. Keep the locally reduced cache size and the local seven-result page size. Adopt the incoming cache priority list and the incoming high-contrast setting.",
    files: [
      {
        path: "viewer/cache.json",
        baseline: { sizeMb: 256, priority: ["recent"], persistent: true },
        local: { sizeMb: 96 },
        incoming: { priority: ["pinned", "recent"] },
      },
      {
        path: "viewer/display.json",
        baseline: {
          pageSize: 20,
          highContrast: false,
          labels: { empty: "Nothing found" },
        },
        local: { pageSize: 7 },
        incoming: { highContrast: true },
      },
    ],
  },
  {
    id: "three-stage-review",
    sourceGroup: "three-stage-review",
    goal: "Integrate the intake, triage and export settings as one review. Preserve local restricted intake, two-reviewer triage, and disabled automatic export. Adopt the incoming source-ID requirement, ordered severity levels, and NDJSON report format.",
    files: [
      {
        path: "review/intake.json",
        baseline: {
          visibility: "team",
          requireSourceId: false,
          requiredLabel: "review",
        },
        local: { visibility: "restricted" },
        incoming: { requireSourceId: true },
      },
      {
        path: "review/triage.json",
        baseline: { reviewers: 1, levels: ["high"], receipt: true },
        local: { reviewers: 2 },
        incoming: { levels: ["critical", "high", "low"] },
      },
      {
        path: "review/export.json",
        baseline: { automatic: true, format: "csv", destination: "archive" },
        local: { automatic: false },
        incoming: { format: "ndjson" },
      },
    ],
  },
];

const settings =
  "Integrate the assigned incoming source, preserving the independently requested local and incoming changes and all untouched settings. Do not publish.";
export const workspaceIntegrationWorlds = [
  {
    id: "theme-locale",
    sourceGroup: "settings-conflict",
    goal: settings,
    theme: "dark",
    locale: "es",
  },
  {
    id: "theme-locale-alias",
    sourceGroup: "settings-conflict",
    goal: settings,
    theme: "solarized",
    locale: "fr",
  },
  ...multiFileWorlds.map((world) => ({
    ...world,
    goal: `${world.goal} ${isolated}`,
  })),
];

export function workspaceIntegrationSeeds(
  id: string,
  seed: string,
): IntegrationFileSeed[] {
  const world = workspaceIntegrationWorlds.find((item) => item.id === id);
  if (!world) throw new Error(`Unknown managed integration world ${id}`);
  if ("files" in world) return structuredClone(world.files);
  const suffix = seed.replace(/[^a-z0-9]/giu, "").toLowerCase();
  const theme = `theme_${suffix}`;
  const locale = `locale_${suffix}`;
  return [
    {
      path: "settings.json",
      baseline: {
        [theme]: "light",
        [locale]: "en",
        [`keep_${suffix}`]: `preserved-${seed}`,
      },
      local: { [theme]: world.theme },
      incoming: { [locale]: world.locale },
    },
  ];
}

export function expectedIntegratedFile(file: IntegrationFileSeed) {
  const expected = { ...file.baseline, ...file.local, ...file.incoming };
  for (const [key, side] of Object.entries(file.ownership ?? {}))
    if (side === "local") expected[key] = file.local[key]!;
  return expected;
}
