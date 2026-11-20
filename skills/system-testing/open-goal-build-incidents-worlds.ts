type Focus = "build-time" | "initial-payload" | "cache" | "compiler" | "compare" | "runtime-memory";
type Content = "compact" | "rich" | "broken";
type Slot = "current" | "baseline" | "neighbor" | "incomplete" | "withdrawn";
export type BuildIncidentWorld = {
  id: string; kind: "build-incident"; workspace: "system"; sourceGroup: string; split?: "test";
  title: string; owner: string; goal: string; focus: Focus; content: Content; budget?: number;
  slots: Slot[]; localHandoffAllowed: boolean;
  expected: { current: boolean; baseline: boolean; stage: boolean;
    blocker: null | "no-approved-current-checkpoint" | "no-comparable-baseline" | "wrong-measurement-boundary" | "native-build-failed" };
};
export const buildIncidentRequiresUnits = [
  "skills/open-user-goal", "skills/performance", "skills/performance-build-bindings", "skills/scratch-handoff-bindings",
];

function scenario(
  name: string, title: string, owner: string, goal: string, focus: Focus,
  options: { content?: Content; slots?: Slot[]; budget?: number; local?: boolean; held?: true;
    blocker?: NonNullable<BuildIncidentWorld["expected"]["blocker"]> } = {},
): BuildIncidentWorld {
  const slots = options.slots ?? ["current"];
  const blocker = options.blocker ?? null;
  return {
    id: "retained-build-" + name, kind: "build-incident", workspace: "system",
    sourceGroup: "vibestudio:retained-build:" + name, ...(options.held ? { split: "test" } : {}),
    title, owner, goal, focus, content: options.content ?? "compact", slots, localHandoffAllowed: options.local ?? false,
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    expected: { current: slots.includes("current"), baseline: focus === "compare" && slots.includes("baseline"),
      stage: Boolean(options.local) && blocker === null, blocker },
  };
}

export const openBuildIncidentWorlds = [
  scenario("warehouse-roster-phase", "Warehouse roster display", "warehouse desk",
    "The Warehouse roster display took longer to build than the morning team expected. What part of its current recorded build can actually explain the delay? Leave the warehouse desk a local note identifying the observed boundary.", "build-time",
    { local: true, slots: ["current", "baseline"] }),
  scenario("artwork-preview-initial-limit", "Artwork preview", "exhibit desk",
    "Before loading Artwork preview on the visitor station, check whether its current initial download fits the exhibit desk's 8 KiB allowance. Identify a contributor only if this is really the current preview, and leave the evidence locally.", "initial-payload",
    { content: "rich", budget: 8_192, slots: ["current", "neighbor"], local: true }),
  scenario("route-board-cache-attestation", "Route board", "dispatch",
    "Verify the saved Route board repeat reached the same build artifacts as the first run. I want a readback of the cache evidence only, without another build or note.", "cache"),
  scenario("visitor-notice-source-error", "Visitor notice", "facility desk",
    "The facility desk saw two similarly named Visitor notice build outcomes. Find the exact compile diagnostic on the current one and leave it for the owner to review. A successful sibling is irrelevant.", "compiler",
    { content: "broken", local: true, slots: ["neighbor", "current"] }),
  scenario("dispatch-two-measured-revisions", "Dispatch clock", "maintenance",
    "Compare the retained versions of Dispatch clock after the maintenance change. Did the same thing get measured in both runs? Leave a short local handoff tying each observation to its own revision.", "compare",
    { slots: ["baseline", "current"], content: "rich", local: true }),
  scenario("video-budget-lazy-is-not-initial", "Video cues", "production desk",
    "The production desk quotes the whole Video cues payload as the startup download. Use the saved current run to check the 64 KiB startup budget. Keep lazy bytes distinct and avoid leaving anything new.", "initial-payload",
    { budget: 65_536 }),
  scenario("storage-host-memory-not-build-phases", "Storage queue indicator", "operator",
    "The Storage queue indicator owner says the retained build phase proves why the process tree ran out of memory. Check the available current evidence and say what it can support. Make a note only if the specific memory claim is established.", "runtime-memory",
    { blocker: "wrong-measurement-boundary", local: true }),
  scenario("cache-before-owner-edit-is-stale", "Evening timetable", "transport desk",
    "Is the current Evening timetable build cache verified? The transport desk has one retained repeat but changed its source afterward. A report from the prior revision should not authorize a current cache claim.", "cache",
    { slots: ["baseline"], blocker: "no-approved-current-checkpoint" }),
  scenario("failed-route-board-never-verified", "Emergency route board", "yard desk",
    "Check whether Emergency route board completed a verified repeat. If the current checkpoint actually failed, explain the supported blocker and leave the proposed yard desk handoff empty.", "cache",
    { content: "broken", slots: ["current"], blocker: "native-build-failed", local: true }),
  scenario("hold-late-open-checkpoint", "Status summary", "meeting desk",
    "The saved Status summary measurement was interrupted after it opened. The meeting desk needs the current verified elapsed time. If no terminal receipt survived, say so and leave no handoff.", "build-time",
    { slots: ["incomplete"], blocker: "no-approved-current-checkpoint", local: true }),
  scenario("dom-initial-before-sealed-source", "Signage rotation", "design desk",
    "What can the current Signage rotation checkpoint establish about initial payload? I need the shipped startup size, not the size of sealed executable source or the emitted file inventory. Leave a local record if it is tied to this panel.", "initial-payload",
    { content: "rich", slots: ["current", "neighbor"], local: true }),
  scenario("same-title-exact-cache", "Crew notice panel", "shift lead",
    "Someone filed two Crew notice panel receipts under the same title. Which one measures the shift lead's current panel and does its repeat reuse exactly the same build keys? No new evidence run.", "cache",
    { slots: ["neighbor", "current"] }),
  scenario("compare-neighbor-is-not-baseline", "Tour status", "guest desk",
    "The guest desk asked for a before-and-after comparison of Tour status. The second check in the archive may be from another panel. Explain whether the comparison is supportable before leaving a note.", "compare",
    { local: true, slots: ["current", "neighbor"], blocker: "no-comparable-baseline" }),
  scenario("current-diagnostic-with-old-failure", "Seating image", "usher desk",
    "Two Seating image revisions may have reported the same error at a glance. Recover exactly what the current build observed for the usher desk. Keep the earlier revision out of the diagnostic note.", "compiler",
    { content: "broken", slots: ["baseline", "current"], local: true }),
  scenario("owner-rescinded-completed-report", "Council agenda board", "records desk",
    "The records desk revoked permission to use the completed Council agenda board report. Confirm whether a released current checkpoint survived. Don't use a withdrawn report for the technical handoff.", "build-time",
    { slots: ["withdrawn", "neighbor"], blocker: "no-approved-current-checkpoint", local: true }),
  scenario("compare-healthy-baseline-and-broken-latest", "Exhibit route map", "floor desk",
    "Can the floor desk infer the new Exhibit route map builds faster than its saved baseline? Compare the two exact revisions if both succeeded and explain any current failure holding the claim.", "compare",
    { content: "broken", slots: ["baseline", "current"], blocker: "native-build-failed", held: true }),
  scenario("held-same-owner-wrong-repository", "Winter storage panel", "stores desk",
    "The stores desk needs the current Winter storage panel's build duration. They own another panel with the same title and there is a complete receipt for that one. Verify the exact source before reporting a timing conclusion.", "build-time",
    { slots: ["neighbor", "incomplete"], blocker: "no-approved-current-checkpoint", held: true }),
  scenario("held-fresh-build-not-cache-hypothesis", "Archive digest display", "archive editor",
    "The archive editor wants to know whether the current Archive digest display build spent measurable time on compilation and whether the precise repeat reused its keys. Leave a note grounded in the saved first-run class and repeat.", "build-time",
    { slots: ["current"], local: true, held: true }),
  scenario("held-source-bytes-cannot-measure-rss", "Roster chart", "office desk",
    "The office desk suggests that a reduction in the retained Roster chart's emitted bytes proves lower peak renderer RSS. Check exactly what was measured before endorsing that conclusion. Do not create a memory-savings note based on bytes alone.", "runtime-memory",
    { content: "rich", slots: ["baseline", "current"], blocker: "wrong-measurement-boundary", local: true, held: true }),
  scenario("held-withdrawn-old-closure-current-diagnostic", "Shipment banner", "dock supervisor",
    "The Shipment banner's current change failed to build after the dock supervisor withdrew its earlier review. Record the current compiler problem if the closest retained evidence really matches the active source, without touching the old approval.", "compiler",
    { content: "broken", slots: ["baseline", "current", "incomplete"], local: true, held: true }),
];
