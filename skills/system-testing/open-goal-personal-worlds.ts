const workspace = { kind: "personal", workspace: "personal" } as const;
const project = (key: string, name: string, archived = false) => ({ key, name, archived });
const card = (
  key: string, title: string, project: string, status: "inbox" | "ready" | "active" | "review" | "done" = "inbox",
  ...requires: string[]
) => ({ key, title, project, status, requires });
const authority = (handoff: boolean, ...writes: { key: string; kinds: ("ready" | "relocate" | "prerequisites")[] }[]) =>
  ({ handoff, writes });
const allow = (key: string, ...kinds: ("ready" | "relocate" | "prerequisites")[]) => ({ key, kinds });
const ready = (key: string) => ({ kind: "ready" as const, key });
const relocate = (key: string, destination: string) => ({ kind: "relocate" as const, key, destination });
const prerequisites = (key: string, ...requires: string[]) => ({ kind: "prerequisites" as const, key, requires });
const observed = (key: string) => ({ kind: "observed" as const, key });
const held = (key: string | undefined, ...blockers: string[]) => ({ kind: "held" as const, key, blockers });
type Step = ReturnType<typeof ready | typeof relocate | typeof prerequisites | typeof observed | typeof held>;
const expected = (steps: Step[], ...handoff: string[]) => ({ steps, handoff });

export const openGoalPersonalWorlds = [
  {
    ...workspace, id: "explain-museum-gallery-readiness",
    goal: "I'm handing the night shift the state of the Galleries board. Is Gallery lighting still waiting on anything, and where does the Visitor route review stand? Check Gallery lighting first and leave the board alone.",
    sourceGroup: "vibestudio:personal:gallery-operations-readiness",
    projects: [project("galleries", "Galleries"), project("exhibit", "Exhibit Production")],
    cards: [
      card("fixtures", "Fixture delivery", "exhibit", "review"),
      card("light", "Gallery lighting", "galleries", "inbox", "fixtures"),
      card("route", "Visitor route review", "galleries", "done"),
    ],
    authority: authority(false),
    expected: expected([held("light", "fixtures"), observed("route")]),
  },
  {
    ...workspace, id: "hold-ambiguous-badge-cutover-and-prepare-selected-card",
    goal: "There are several Badge cutover cards in the board cleanup. Don't guess which unqualified one I meant. Do prepare the Facilities Badge cutover for Ready if its gates are complete, then stage a handoff for the Facilities card only.",
    sourceGroup: "vibestudio:personal:badge-card-disambiguation",
    projects: [project("security", "Security"), project("facilities", "Facilities")],
    cards: [
      card("audit", "Access audit", "security", "done"),
      card("security_cutover", "Badge cutover", "security", "inbox", "audit"),
      card("facilities_cutover", "Badge cutover", "facilities", "inbox", "audit"),
    ],
    authority: authority(true, allow("facilities_cutover", "ready")),
    expected: expected([held(undefined, "target-not-unique"), ready("facilities_cutover")], "facilities_cutover"),
  },
  {
    ...workspace, id: "move-chiller-review-and-queue-on-receiving-board",
    goal: "The Site Operations team is taking over the Chiller temperature review from Deployment. Move that same card to Site Operations, then put it in Ready there when its completed sensor calibration permits it. Stage a handoff of the moved review and its calibration.",
    sourceGroup: "vibestudio:personal:chiller-reassignment",
    projects: [project("deployment", "Deployment"), project("site", "Site Operations"), project("archive", "Completed Rollouts", true)],
    cards: [
      card("sensor", "Sensor calibration", "deployment", "done"),
      card("retired", "Chiller temperature review", "archive", "done"),
      card("review", "Chiller temperature review", "deployment", "inbox", "sensor"),
    ],
    authority: authority(true, allow("review", "relocate", "ready")),
    expected: expected([relocate("review", "site"), ready("review")], "review", "sensor"),
  },
  {
    ...workspace, id: "rebase-clinic-opening-readiness-on-owner-note",
    goal: "Put the Clinic opening checklist in Ready if the signed Safety sweep is complete. The ward coordinator may be updating the card notes while we're doing this. Keep any newer note, take the action against the latest revision, and stage the final checklist handoff.",
    sourceGroup: "vibestudio:personal:clinic-concurrent-note",
    projects: [project("care", "Clinical Operations"), project("inspection", "Inspection")],
    cards: [
      card("safety", "Safety sweep", "inspection", "done"),
      card("coordinator", "Clinic opening checklist", "care", "inbox", "safety"),
    ],
    authority: authority(true, allow("coordinator", "ready")),
    concurrent: { key: "coordinator", description: "Ward coordinator: use the side entrance.", attempt: ready("coordinator") },
    expected: expected([ready("coordinator")], "coordinator"),
  },
  {
    ...workspace, id: "hold-warehouse-dispatch-after-new-blocker",
    goal: "Queue Warehouse dispatch only if its actual current prerequisites are all complete. A shift lead is changing which checks govern dispatch. If one is newly unfinished, keep dispatch on hold and stage a handoff of the dispatch card with its current gate status.",
    sourceGroup: "vibestudio:personal:warehouse-changing-gate",
    projects: [project("warehouse", "Warehouse"), project("safety", "Safety Inspections")],
    cards: [
      card("dock", "Dock inspection", "safety", "done"),
      card("alarm", "Freezer alarm validation", "safety", "active"),
      card("dispatch", "Warehouse dispatch", "warehouse", "inbox", "dock"),
    ],
    authority: authority(true, allow("dispatch", "ready")),
    concurrent: { key: "dispatch", requires: ["dock", "alarm"], attempt: ready("dispatch") },
    expected: expected([held("dispatch", "alarm")], "dispatch"),
  },
  {
    ...workspace, id: "exclude-vendor-dependency-loop-and-stage-companion",
    goal: "Make Vendor agreement depend on the Invoice packet only if that leaves the dependency graph acyclic. Independently prepare the Catalog handoff checklist for Ready if its completed product verification is enough. I need these assessed in that order.",
    sourceGroup: "vibestudio:personal:vendor-dependency-cycle",
    projects: [project("buying", "Procurement"), project("payments", "Accounts Payable"), project("catalog", "Catalog")],
    cards: [
      card("agreement", "Vendor agreement", "buying"),
      card("legal", "Legal approval", "buying", "inbox", "agreement"),
      card("invoice", "Invoice packet", "payments", "inbox", "legal"),
      card("product", "Product verification", "catalog", "done"),
      card("handoff", "Catalog handoff checklist", "catalog", "inbox", "product"),
    ],
    authority: authority(false, allow("agreement", "prerequisites"), allow("handoff", "ready")),
    expected: expected([held("agreement", "cycle"), ready("handoff")]),
  },
  {
    ...workspace, id: "replace-press-review-gates-and-stage-evidence",
    goal: "For Communications, the signed Story approval and Legal sign-off replace the obsolete Early outline gate for Release copy. Keep them in that order, put the copy in Ready only when both are accepted, and stage a handoff of that card.",
    sourceGroup: "vibestudio:personal:press-gate-replacement",
    projects: [project("comms", "Communications"), project("legal", "Legal")],
    cards: [
      card("outline", "Early outline", "comms", "active"),
      card("story", "Story approval", "comms", "done"),
      card("signoff", "Legal sign-off", "legal", "done"),
      card("copy", "Release copy", "comms", "inbox", "outline"),
    ],
    authority: authority(true, allow("copy", "prerequisites", "ready")),
    expected: expected([prerequisites("copy", "story", "signoff"), ready("copy")], "copy"),
  },
  {
    ...workspace, id: "handoff-marina-repairs-and-report-unfinished-check", split: "test",
    goal: "Prepare a shift handoff for Fuel line inspection and Gate controller repair in Marina Maintenance, in that order. Tell the crew what still blocks the controller repair and keep both cards as they are.",
    sourceGroup: "vibestudio:personal:marina-night-shift-handoff",
    projects: [project("marina", "Marina Maintenance"), project("electrical", "Electrical")],
    cards: [
      card("supply", "Supply isolation", "electrical", "ready"),
      card("fuel", "Fuel line inspection", "marina", "done"),
      card("gate", "Gate controller repair", "marina", "inbox", "supply"),
    ],
    authority: authority(true),
    expected: expected([observed("fuel"), held("gate", "supply")], "fuel", "gate"),
  },
  {
    ...workspace, id: "skip-archived-auditor-destination-and-queue-training", split: "test",
    goal: "Try to transfer Permit audit to Past Compliance only if that project still takes work. Either way, check whether Inspector training in Field Team can go into Ready after the completed Roster approval. Report the permit decision before the training outcome.",
    sourceGroup: "vibestudio:personal:permit-archive-destination",
    projects: [project("compliance", "Current Compliance"), project("past", "Past Compliance", true), project("field", "Field Team")],
    cards: [
      card("audit", "Permit audit", "compliance"),
      card("roster", "Roster approval", "compliance", "done"),
      card("training", "Inspector training", "field", "inbox", "roster"),
      card("past_training", "Inspector training", "past", "done"),
    ],
    authority: authority(false, allow("audit", "relocate"), allow("training", "ready")),
    expected: expected([held("audit", "destination-not-unique"), ready("training")]),
  },
] as const;
