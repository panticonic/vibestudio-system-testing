import type { SemanticOutcomeContract } from "./semantic-outcome-contract.js";

type Bookmark = { key: string; folder: string; title: string; path: string };
type Visit = { title: string; path: string; time: number };
type Panel = {
  key: string;
  parent: string;
  title: string;
  group?: boolean;
  note?: string;
};
type LibraryStep =
  | { kind: "save"; bookmark: Bookmark }
  | { kind: "rename"; key: string; title: string }
  | { kind: "file"; key: string; folder: string }
  | { kind: "retire"; key: string; keep: string };
type PanelStep =
  | { kind: "note"; panel: string; text: string }
  | { kind: "group"; key: string; parent: string; title: string }
  | { kind: "move"; panel: string; parent: string; after: string | null }
  | { kind: "link"; panel: string; bookmark: string; heading: string };
type Concurrent =
  | { surface: "library"; key: string; title: string }
  | { surface: "collection"; key: string; note: string };

export type PersonalArtifactWorld = {
  id: string;
  kind: "personal-artifacts";
  workspace: "personal";
  split?: "test";
  sourceGroup: string;
  goal: string;
  outcomeContract: SemanticOutcomeContract;
  collectionTitle: string;
  folders: string[];
  bookmarks: Bookmark[];
  visits: Visit[];
  panels: Panel[];
  grants: { library: LibraryStep["kind"][]; collection: PanelStep["kind"][] };
  concurrent?: Concurrent;
  expected: {
    library: LibraryStep[];
    collection: PanelStep[];
    selected: string | null;
    libraryHeld: boolean;
    collectionHeld: boolean;
  };
};
type Inputs = Omit<PersonalArtifactWorld, "kind" | "workspace" | "expected" | "outcomeContract"> & {
  library?: LibraryStep[];
  collection?: PanelStep[];
  selected?: string | null;
  libraryHeld?: boolean;
  collectionHeld?: boolean;
};
function world({
  library = [],
  collection = [],
  selected = null,
  libraryHeld = false,
  collectionHeld = false,
  ...input
}: Inputs): PersonalArtifactWorld {
  return {
    outcomeContract: {
      effects: {
        checks: ["observedOwnedArtifacts", "exactLibraryState", "protectedBrowserRecords", "exactCollectionState", "verifiedBookmarkHandoff", "recoveredFreshBasis"],
        rationale: "These tasks request bookmark and panel changes or preservation. The final native library and panel readbacks independently establish those effects.",
      },
      returnedValue: {
        checks: ["reportedArtifactEvidence"], required: false,
        rationale: "The authored goals request persistent workspace effects. The incidental held flags in the returned receipt are not a requested user answer.",
      },
    },
    kind: "personal-artifacts",
    workspace: "personal",
    ...input,
    expected: { library, collection, selected, libraryHeld, collectionHeld },
  };
}
export const personalArtifactRequiresUnits = [
  "skills/open-user-goal",
  "skills/open-personal-artifacts",
  "skills/browser-library-runtime",
  "skills/collection-conductor-runtime",
  "skills/open-personal-artifacts-runtime",
  "extensions/browser-data",
  "about/collection",
];
export const openPersonalArtifactChecks = [
  "observedOwnedArtifacts",
  "exactLibraryState",
  "protectedBrowserRecords",
  "exactCollectionState",
  "verifiedBookmarkHandoff",
  "recoveredFreshBasis",
  "reportedArtifactEvidence",
] as const;
const bookmark = (
  key: string,
  folder: string,
  title: string,
  relativePath: string,
): Bookmark => ({ key, folder, title, path: relativePath });
const visit = (title: string, relativePath: string, offset: number): Visit => ({
  title,
  path: relativePath,
  time: 1_741_008_600_000 + offset,
});
const leaf = (
  key: string,
  parent: string,
  title: string,
  note?: string,
): Panel => ({ key, parent, title, ...(note === undefined ? {} : { note }) });
const group = (key: string, parent: string, title: string): Panel => ({
  key,
  parent,
  title,
  group: true,
});

export const openPersonalArtifactWorlds = [
  world({
    id: "recover-current-corridor-brief-for-shift",
    sourceGroup: "vibestudio:personal-artifacts:corridor-shift",
    goal: "The evening desk lost its corridor brief. Recover the newest Corridor brief we actually visited into Desk, call it Current corridor brief, and leave its link on the Shift panel under ‘Evening reference’. Preserve other bookmarks and notes.",
    collectionTitle: "Evening desk",
    folders: ["/Intake", "/Desk"],
    bookmarks: [bookmark("old", "/Intake", "Service notice", "/notice")],
    visits: [
      visit("Corridor brief revision 1", "/corridor/1", 5),
      visit("Corridor brief revision 2", "/corridor/2", 9),
    ],
    panels: [
      leaf("shift", "root", "Shift"),
      leaf("support", "root", "Support", "Do not reopen settled incidents"),
    ],
    grants: { library: ["save"], collection: ["link"] },
    library: [
      {
        kind: "save",
        bookmark: bookmark(
          "brief",
          "/Desk",
          "Current corridor brief",
          "/corridor/2",
        ),
      },
    ],
    collection: [
      {
        kind: "link",
        panel: "shift",
        bookmark: "brief",
        heading: "Evening reference",
      },
    ],
    selected: "brief",
  }),
  world({
    id: "archive-exhibit-checklist-and-link-review",
    sourceGroup: "vibestudio:personal-artifacts:exhibit-readiness",
    goal: "Get the exhibit checklist out of Inbox and into Archive under the title Approved exhibit checklist. Put its link on the Agenda under Review with the heading Exhibit evidence. The Agenda under Intake belongs to a different team.",
    collectionTitle: "Gallery opening",
    folders: ["/Inbox", "/Archive"],
    bookmarks: [
      bookmark("actual", "/Inbox", "Exhibit checklist", "/exhibit/checklist"),
      bookmark(
        "older",
        "/Archive",
        "Old exhibit checklist",
        "/exhibit/preliminary",
      ),
    ],
    visits: [],
    panels: [
      group("review", "root", "Review"),
      group("intake", "root", "Intake"),
      leaf("review-agenda", "review", "Agenda"),
      leaf("intake-agenda", "intake", "Agenda", "Recheck admissions"),
    ],
    grants: { library: ["rename", "file"], collection: ["link"] },
    library: [
      { kind: "rename", key: "actual", title: "Approved exhibit checklist" },
      { kind: "file", key: "actual", folder: "/Archive" },
    ],
    collection: [
      {
        kind: "link",
        panel: "review-agenda",
        bookmark: "actual",
        heading: "Exhibit evidence",
      },
    ],
    selected: "actual",
  }),
  world({
    id: "dedupe-verifiable-courier-route",
    sourceGroup: "vibestudio:personal-artifacts:courier-same-url",
    goal: "There are two copies of the courier route. Remove the temporary one from Inbox only if the Register copy is an exact URL match. Then link the retained copy on Dispatch using the heading Retained courier route.",
    collectionTitle: "Dispatch board",
    folders: ["/Inbox", "/Register"],
    bookmarks: [
      bookmark("temp", "/Inbox", "Courier route temporary", "/dispatch/route"),
      bookmark("keep", "/Register", "Courier route", "/dispatch/route"),
      bookmark(
        "decoy",
        "/Register",
        "Courier route evening",
        "/dispatch/alternate",
      ),
    ],
    visits: [],
    panels: [
      leaf("dispatch", "root", "Dispatch"),
      leaf("intake", "root", "Intake", "Keep the original log"),
    ],
    grants: { library: ["retire"], collection: ["link"] },
    library: [{ kind: "retire", key: "temp", keep: "keep" }],
    collection: [
      {
        kind: "link",
        panel: "dispatch",
        bookmark: "keep",
        heading: "Retained courier route",
      },
    ],
    selected: "keep",
  }),
  world({
    id: "preserve-safety-note-during-handoff-replan",
    sourceGroup: "vibestudio:personal-artifacts:collection-concurrent-note",
    goal: "Link the existing route confirmation on the Handover panel as Confirmed route. The supervisor is also updating the Safety panel, so refresh if needed and preserve whichever safety note is current when you write.",
    collectionTitle: "Morning response",
    folders: ["/Confirmed"],
    bookmarks: [
      bookmark(
        "route",
        "/Confirmed",
        "Route confirmation",
        "/response/confirmed",
      ),
    ],
    visits: [],
    panels: [
      leaf("handover", "root", "Handover"),
      leaf("safety", "root", "Safety", "Use old cordon"),
    ],
    grants: { library: [], collection: ["link"] },
    concurrent: {
      surface: "collection",
      key: "safety",
      note: "Use the revised eastern cordon",
    },
    collection: [
      {
        kind: "link",
        panel: "handover",
        bookmark: "route",
        heading: "Confirmed route",
      },
    ],
    selected: "route",
  }),
  world({
    id: "retain-billing-owner-edit-while-filing-brief",
    sourceGroup: "vibestudio:personal-artifacts:library-concurrent-label",
    goal: "File the ownership brief in Reviews and put its link on Owner Review under Ownership brief. Billing is renaming its own reference in parallel. Don't undo the billing change if your library snapshot has gone stale.",
    collectionTitle: "Monthly ownership",
    folders: ["/Intake", "/Reviews"],
    bookmarks: [
      bookmark("brief", "/Intake", "Ownership brief", "/owner/brief"),
      bookmark("billing", "/Reviews", "Billing draft", "/billing/current"),
    ],
    visits: [],
    panels: [leaf("owner", "root", "Owner Review")],
    grants: { library: ["file"], collection: ["link"] },
    concurrent: {
      surface: "library",
      key: "billing",
      title: "Billing figures verified",
    },
    library: [{ kind: "file", key: "brief", folder: "/Reviews" }],
    collection: [
      {
        kind: "link",
        panel: "owner",
        bookmark: "brief",
        heading: "Ownership brief",
      },
    ],
    selected: "brief",
  }),
  world({
    id: "hold-tied-lease-visits-and-record-review-action",
    sourceGroup: "vibestudio:personal-artifacts:latest-lease-tie",
    goal: "Recover the latest Lease reference into Agreements and link it on Legal only if there is a clear latest visit. If the Lease visits tie, leave the library and Legal alone and put ‘Lease reference pending review’ in Follow-up.",
    collectionTitle: "Agreement intake",
    folders: ["/Agreements"],
    bookmarks: [
      bookmark("other", "/Agreements", "Collections policy", "/lease/policy"),
    ],
    visits: [
      visit("Lease reference east", "/lease/east", 20),
      visit("Lease reference west", "/lease/west", 20),
    ],
    panels: [
      leaf("legal", "root", "Legal"),
      leaf("follow", "root", "Follow-up"),
    ],
    grants: { library: ["save"], collection: ["link", "note"] },
    collection: [
      { kind: "note", panel: "follow", text: "Lease reference pending review" },
    ],
    libraryHeld: true,
    collectionHeld: true,
  }),
  world({
    id: "set-up-aftercare-group-and-retain-prepared-reference",
    sourceGroup: "vibestudio:personal-artifacts:aftercare-panel-group",
    goal: "The Aftercare board needs a separate Follow-ups group. Create it, move Callback into it, and link the already saved Callback instructions on the moved panel under Aftercare instructions. Don’t change the library.",
    collectionTitle: "Aftercare board",
    folders: ["/Care"],
    bookmarks: [
      bookmark("callback", "/Care", "Callback instructions", "/aftercare/call"),
    ],
    visits: [],
    panels: [
      leaf("callback", "root", "Callback"),
      leaf("initial", "root", "Intake", "Use the desk number"),
    ],
    grants: { library: [], collection: ["group", "move", "link"] },
    collection: [
      { kind: "group", key: "follow", parent: "root", title: "Follow-ups" },
      { kind: "move", panel: "callback", parent: "follow", after: null },
      {
        kind: "link",
        panel: "callback",
        bookmark: "callback",
        heading: "Aftercare instructions",
      },
    ],
    selected: "callback",
  }),
  world({
    id: "stop-before-replacing-distinct-library-sources",
    split: "test",
    sourceGroup: "vibestudio:personal-artifacts:held-water-duplicate",
    goal: "Facilities asked whether the Archived treatment guide replaces the Active treatment guide. Remove the Active copy and hand off the Archived one under Confirmed guide only if both URLs match. Otherwise preserve both and leave the Signoff note untouched.",
    collectionTitle: "Water team handoff",
    folders: ["/Active", "/Archive"],
    bookmarks: [
      bookmark("active", "/Active", "Treatment guide", "/water/current"),
      bookmark("archive", "/Archive", "Treatment guide", "/water/historical"),
    ],
    visits: [],
    panels: [leaf("signoff", "root", "Signoff", "Waiting on Facilities")],
    grants: { library: ["retire"], collection: ["link"] },
    libraryHeld: true,
    collectionHeld: true,
  }),
  world({
    id: "choose-correct-archive-note-for-education-shift",
    split: "test",
    sourceGroup: "vibestudio:personal-artifacts:held-education-shift",
    goal: "The education shift wants the original field sheet for comparison. Recover the earliest version of the Field sheet we visited into History and link it on Comparison under Original field sheet. Leave the newer edition alone.",
    collectionTitle: "Field education",
    folders: ["/History", "/Team"],
    bookmarks: [
      bookmark("newer", "/Team", "Field sheet current", "/field/sheet3"),
    ],
    visits: [
      visit("Field sheet original", "/field/sheet1", 3),
      visit("Field sheet revised", "/field/sheet2", 8),
    ],
    panels: [
      leaf("comparison", "root", "Comparison"),
      leaf("materials", "root", "Materials"),
    ],
    grants: { library: ["save"], collection: ["link"] },
    library: [
      {
        kind: "save",
        bookmark: bookmark(
          "original",
          "/History",
          "Field sheet original",
          "/field/sheet1",
        ),
      },
    ],
    collection: [
      {
        kind: "link",
        panel: "comparison",
        bookmark: "original",
        heading: "Original field sheet",
      },
    ],
    selected: "original",
  }),
] as const;
