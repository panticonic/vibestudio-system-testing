type Decision =
  | "keep-open"
  | "review-ready-update"
  | "defer-update"
  | "inspect-offer"
  | "review-rollback"
  | "restore-layout"
  | "hold-scope"
  | "wait-for-admission";
type Offer = {
  build?: string | null;
  from?: string;
  version?: string;
  identity?: "browser" | "neighbor";
};
type Layout = {
  case?:
    | "standard"
    | "removed"
    | "duplicate-panel"
    | "duplicate-pane"
    | "bad-schema"
    | "other-workspace"
    | "stale-anchor"
    | "oversize"
    | "empty";
  beforeWidth?: number;
  afterWidth?: number;
  focus?: "left" | "right";
  queued?: string;
  pending?: boolean;
};
type Change = "rejected" | "rolled-back" | "status" | "adopted" | "foreign";
type Replay = {
  name: string;
  window?: Layout;
  before?: Offer[];
  current?: Offer[];
  previous?: string[];
  missingCurrentUnit?: boolean;
  events?: Change[];
  active?: string;
  admissionPending?: boolean;
  expected: {
    action: Decision;
    layout?: "wrong-scope" | "invalid";
    currentFocus?: string;
    resident?: string[];
    rightParked?: string[];
    leftParked?: string[];
    before?: Array<string | null>;
    current?: Array<string | null>;
    notices?: string[];
  };
};

function goal(
  id: string,
  split: "train" | "test",
  text: string,
  replay: Replay,
) {
  return {
    id: `desktop-readiness-${id}`,
    kind: "desktopReadiness",
    workspace: "system",
    sourceGroup: `vibestudio:desktop-readiness:${id}`,
    split,
    goal: text,
    ...replay,
  } as const;
}

export const openDesktopReadinessWorlds = [
  goal(
    "office-reconnect-same-build",
    "train",
    "Office Desk is reopening on the same desktop build after reconnect. Can I leave it open and continue reviewing, or is there evidence of a different build that needs my attention?",
    {
      name: "Office Desk",
      events: ["status"],
      expected: {
        action: "keep-open",
        currentFocus: "records",
        resident: ["left", "right"],
      },
    },
  ),
  goal(
    "lobby-confirm-ready-offer",
    "train",
    "I'm between shifts at Lobby Desk. Confirm whether the staged desktop update is a different build worth reviewing, and give me the current layout and version distinction without installing it.",
    {
      name: "Lobby Desk",
      current: [{ build: "candidate", from: "4.0", version: " 4.1 " }],
      expected: { action: "review-ready-update", current: ["candidate"] },
    },
  ),
  goal(
    "script-edit-before-new-build",
    "train",
    "Script Desk has an unsaved pane placement edit just as the desktop offers an update. Work out what can wait while I finish the arrangement. Keep the existing window open.",
    {
      name: "Script Desk",
      window: { pending: true },
      current: [{ build: "tools-next" }],
      expected: { action: "defer-update", current: ["tools-next"] },
    },
  ),
  goal(
    "lease-review-pending",
    "train",
    "A new Sidebar build was offered for Venue Desk, but desktop admission is waiting for an owner decision. Tell me whether that blocks taking the offer. Don't change trust or clear the offered build.",
    {
      name: "Venue Desk",
      admissionPending: true,
      current: [{ build: "sidebar" }],
      expected: { action: "wait-for-admission", current: ["sidebar"] },
    },
  ),
  goal(
    "orphan-offer-after-reconnect",
    "train",
    "Dispatch Board showed a desktop update before reconnect. Can I keep using the existing window if that offer has no matching supervised unit now? Check why the offer disappeared.",
    {
      name: "Dispatch Board",
      before: [{ build: "removed-candidate" }],
      current: [{ build: "removed-candidate" }],
      missingCurrentUnit: true,
      expected: { action: "keep-open", before: ["removed-candidate"] },
    },
  ),
  goal(
    "unknown-offer-build",
    "train",
    "Programs Desk has a retained item labeled as a new desktop version but the handoff lacks a build key. Identify what is actually known and what should be checked before trusting it.",
    {
      name: "Programs Desk",
      current: [{ build: null, version: "7.4" }],
      expected: { action: "inspect-offer", current: [null] },
    },
  ),
  goal(
    "neighbor-update-excluded",
    "train",
    "There's a fresh update in the adjacent monitoring window. Check whether Subtitles Desk's own desktop needs any update action before I continue working here.",
    {
      name: "Subtitles Desk",
      current: [{ identity: "neighbor", build: "neighbor-shiny" }],
      expected: { action: "keep-open" },
    },
  ),
  goal(
    "rollback-before-review",
    "train",
    "Projection Booth wants to know whether the previous trusted desktop build is available after an update offer. Identify the retained rollback option and leave the running window alone.",
    {
      name: "Projection Booth",
      current: [{ build: "projection-next" }],
      previous: ["projection-old"],
      expected: { action: "review-rollback", current: ["projection-next"] },
    },
  ),
  goal(
    "rejected-candidate-existing-window",
    "train",
    "Wardrobe Board saw the desktop reject a candidate after reconnect. Figure out which build is still the running one and what to investigate about the failed candidate. Leave the old window in service.",
    {
      name: "Wardrobe Board",
      events: ["rejected"],
      before: [{ build: "failed-v2" }],
      expected: {
        action: "inspect-offer",
        before: ["failed-v2"],
        notices: ["Update not adopted"],
      },
    },
  ),
  goal(
    "rollback-already-complete",
    "train",
    "Sound Check had a request to return to the previous desktop version. Find whether it actually finished already, and avoid proposing another rollback or rebuild if the supervised notice says it did.",
    {
      name: "Sound Check",
      active: "retained-v1",
      current: [{ build: "troubled-v2" }],
      events: ["rolled-back"],
      expected: { action: "keep-open", notices: ["Client rolled back"] },
    },
  ),
  goal(
    "foreign-rejection",
    "train",
    "The lighting controller complained about its new build while Editor Console was working. Determine whether that applies to this desktop shell before I close anything.",
    {
      name: "Editor Console",
      events: ["foreign"],
      expected: { action: "keep-open" },
    },
  ),
  goal(
    "same-build-retained-offer",
    "train",
    "Cut Desk shows an update card for the exact build the window already has. Work out whether I need to take that offer or just keep the running build.",
    {
      name: "Cut Desk",
      current: [{ build: "running" }],
      events: ["adopted"],
      expected: { action: "keep-open", current: ["running"] },
    },
  ),
  goal(
    "rollback-with-no-version",
    "train",
    "I've been asked to roll Quarry Desk back, but the last release history may have no retained predecessor. Check for an exact available target and call out what's missing without taking any update.",
    {
      name: "Quarry Desk",
      current: [{ build: "quarry-next" }],
      expected: { action: "inspect-offer", current: ["quarry-next"] },
    },
  ),
  goal(
    "narrow-room-parked-column",
    "train",
    "Rehearsal Desk is now narrow. The schedule disappeared from view. Find whether it is parked or gone, and tell me how to keep working without rebuilding the client.",
    {
      name: "Rehearsal Desk",
      window: { afterWidth: 840 },
      expected: {
        action: "keep-open",
        currentFocus: "records",
        resident: ["right"],
        leftParked: ["left"],
      },
    },
  ),
  goal(
    "wide-window-recover-column",
    "train",
    "Map Desk moved from a narrow to a wide window. Determine whether the existing arrangement can bring the parked schedule back, preserving the records panel focus.",
    {
      name: "Map Desk",
      window: { beforeWidth: 790, afterWidth: 1400 },
      expected: {
        action: "restore-layout",
        currentFocus: "records",
        resident: ["left", "right"],
      },
    },
  ),
  goal(
    "deleted-focus-recover-survivor",
    "train",
    "At Crew Desk the old notes panel was closed while the layout was retained. Recover which surviving pane can be used instead before anyone restarts desktop.",
    {
      name: "Crew Desk",
      window: { case: "removed" },
      expected: {
        action: "restore-layout",
        currentFocus: "schedule",
        resident: ["left"],
      },
    },
  ),
  goal(
    "duplicate-pane-identities",
    "train",
    "An old window snapshot at Garden Desk appears to contain two placements with the same pane identity. Check whether it is safe to restore at all and report the current recovery boundary.",
    {
      name: "Garden Desk",
      window: { case: "duplicate-pane" },
      expected: { action: "restore-layout", layout: "invalid" },
    },
  ),
  goal(
    "duplicate-panel-placement",
    "train",
    "At Freight Desk the restored layout seems to put one schedule panel in two places. Find how many placements survive validation and which one stays available.",
    {
      name: "Freight Desk",
      window: { case: "duplicate-panel" },
      expected: {
        action: "restore-layout",
        currentFocus: "schedule",
        resident: ["left"],
      },
    },
  ),
  goal(
    "minimum-width-override",
    "train",
    "Transcription Desk should reopen with the editor legible after the window shrank. Does its wider pane still survive, and which other column is parked while I edit?",
    {
      name: "Transcription Desk",
      window: { case: "oversize", afterWidth: 1500 },
      expected: {
        action: "keep-open",
        currentFocus: "records",
        resident: ["right"],
        leftParked: ["left"],
      },
    },
  ),
  goal(
    "stale-viewport-anchor",
    "train",
    "After the old monitor came off line, Backup Desk retained a viewport anchor naming a column that doesn't exist. Work out the current safe placement and where focus lands.",
    {
      name: "Backup Desk",
      window: { case: "stale-anchor", focus: "left", afterWidth: 850 },
      expected: {
        action: "restore-layout",
        currentFocus: "schedule",
        resident: ["left"],
        rightParked: ["right"],
      },
    },
  ),
  goal(
    "wrong-owner-window",
    "train",
    "Control Room's reconnect offered a saved window from another workspace with the same panel labels. Check ownership before declaring any pane ready. Do not restore the foreign arrangement.",
    {
      name: "Control Room",
      window: { case: "other-workspace" },
      current: [{ build: "control-next" }],
      expected: {
        action: "hold-scope",
        layout: "wrong-scope",
        current: ["control-next"],
      },
    },
  ),
  goal(
    "queued-focus-owns-current",
    "train",
    "Index Desk was still loading its layout when I selected the records pane. Check whether that selection survives restore into the narrow window, and tell me if the schedule is just out of view.",
    {
      name: "Index Desk",
      window: { focus: "left", queued: "pane-right", afterWidth: 840 },
      expected: {
        action: "restore-layout",
        currentFocus: "records",
        resident: ["right"],
        leftParked: ["left"],
      },
    },
  ),
  goal(
    "unsupported-layout-version",
    "train",
    "An older Seating Desk snapshot came across the reconnect. Can the current browser restore it, or does this desk need fresh placement evidence? Don't convert or overwrite the old snapshot.",
    {
      name: "Seating Desk",
      window: { case: "bad-schema" },
      expected: { action: "restore-layout", layout: "invalid" },
    },
  ),
  goal(
    "held-retained-and-neighbor",
    "test",
    "At Heritage Desk I can see messages about a rich-text release and a neighboring printer tool release. Determine if either changes the exact desktop build I have open and leave my workspace running.",
    {
      name: "Heritage Desk",
      events: ["adopted"],
      current: [
        { build: "running", version: " 8.0 " },
        { identity: "neighbor", build: "print-green", version: "9.4" },
      ],
      expected: { action: "keep-open", current: ["running"] },
    },
  ),
  goal(
    "held-rollback-blocked-by-open-edits",
    "test",
    "Paper Archive might have a previous trusted build, but I've still got an unpersisted desk arrangement. Confirm the fallback exists and explain whether there is a reason to defer a build change now.",
    {
      name: "Paper Archive",
      window: { pending: true },
      current: [{ build: "archive-next" }],
      previous: ["archive-previous"],
      expected: { action: "defer-update", current: ["archive-next"] },
    },
  ),
  goal(
    "held-only-whitespace-versions",
    "test",
    "Rain Gauge Desk has a valid next build key, but the version fields came through blank. Confirm whether to review that candidate and cite the identity that really exists.",
    {
      name: "Rain Gauge Desk",
      current: [{ build: "gauge-r2", version: "  ", from: "\t" }],
      expected: { action: "review-ready-update", current: ["gauge-r2"] },
    },
  ),
  goal(
    "held-empty-after-prune",
    "test",
    "Record Booth recovered a window manifest for panels that all closed before reconnect. Work out whether that manifest can restore any placements and give the safest next step before choosing a new panel.",
    {
      name: "Record Booth",
      window: { case: "empty" },
      expected: { action: "restore-layout", layout: "invalid" },
    },
  ),
  goal(
    "held-unowned-offer-despite-ready",
    "test",
    "Depot Desk is being handed to another workspace while an exact desktop update is ready. Check whether the retained layout still belongs here before deciding anything about bringing the window over.",
    {
      name: "Depot Desk",
      window: {
        case: "other-workspace",
        afterWidth: 810,
        queued: "pane-right",
      },
      current: [{ build: "ready-dock" }],
      previous: ["retained-dock"],
      expected: {
        action: "hold-scope",
        layout: "wrong-scope",
        current: ["ready-dock"],
      },
    },
  ),
  goal(
    "held-rejected-then-rolled-back",
    "test",
    "The Lab Notes desktop showed a rejected update followed by a rollback. Resolve which event describes the current usable build, and whether the old review offer needs action now.",
    {
      name: "Lab Notes",
      events: ["rejected", "rolled-back"],
      active: "lab-rollback",
      before: [{ build: "lab-failed" }],
      current: [{ build: "lab-failed" }],
      expected: {
        action: "keep-open",
        before: ["lab-failed"],
        notices: ["Update not adopted", "Client rolled back"],
      },
    },
  ),
] as const;

export type DesktopReadinessWorld = (typeof openDesktopReadinessWorlds)[number];
