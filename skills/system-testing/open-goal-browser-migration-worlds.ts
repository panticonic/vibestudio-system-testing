type Categories = Array<"bookmarks" | "history">;
type Bookmark = { title: string; url: string };

const both: Categories = ["bookmarks", "history"];
const bookmarks: Categories = ["bookmarks"];
const journal = (section: string, title: string): Bookmark => ({
  title,
  url: `https://migration.example.test/${section}`,
});
const totals = (categories: Categories, counts: number[]) =>
  categories.map((category, i) => ({ category, total: counts[i]! }));
const preview = (
  categories: Categories,
  counts: number[],
  warningCount = 0,
) => ({
  status: "previewed" as const,
  totals: totals(categories, counts),
  warningCount,
});

function inspect(
  id: string,
  label: string,
  device: string,
  categories: Categories,
  counts: number[],
  warnings = 0,
) {
  const source = { state: "available" as const, categories: both };
  const observed = preview(categories, counts, warnings);
  return {
    profile: {
      id,
      label,
      device,
      categories: both,
      approved: [],
      retained: null,
    },
    import: {
      id,
      goal: "",
      kind: "preview",
      categories,
      source,
      dropSourceBeforePreview: false,
      preview: observed,
      job: null,
      reads: ["source", "preview"],
      expected: {
        next: "review-preview",
        source,
        totals: observed.totals,
        progress: [],
      },
    },
  } as const;
}

function execute(
  id: string,
  label: string,
  device: string,
  entries: Bookmark[],
  hold?: "totals" | "warnings" | "owner",
) {
  const source = { state: "available" as const, categories: both };
  const approvedPreview = preview(bookmarks, [entries.length]);
  const observed = preview(
    bookmarks,
    [entries.length + (hold === "totals" ? 1 : 0)],
    hold === "warnings" ? 1 : 0,
  );
  const progress = hold
    ? []
    : [
        {
          category: "bookmarks" as const,
          stored: entries.length,
          skipped: 0,
          errors: 0,
        },
      ];
  return {
    profile: {
      id,
      label,
      device,
      categories: both,
      approved: bookmarks,
      retained: null,
    },
    loseOwnershipBeforeStart: hold === "owner",
    import: {
      id,
      goal: "",
      kind: "execute",
      categories: bookmarks,
      source,
      dropSourceBeforePreview: false,
      preview: observed,
      job: hold ? null : { phase: "complete", resumable: false, progress },
      execution: {
        approvedPreview,
        start: hold === "owner" ? "held" : hold ? null : "started",
        bookmarks: hold ? [] : entries,
      },
      reads:
        hold === "owner"
          ? ["source", "preview", "start"]
          : hold
            ? ["source", "preview"]
            : ["source", "preview", "start", "history"],
      expected: {
        next: hold ? "use-inspector" : "keep-results",
        source,
        totals: observed.totals,
        progress,
      },
    },
  } as const;
}

function recover(
  id: string,
  label: string,
  device: string,
  entries: Bookmark[],
  cancelled: boolean,
) {
  const phase = cancelled ? "cancelled" : "complete";
  const progress = [
    {
      category: "bookmarks" as const,
      stored: entries.length,
      skipped: cancelled ? 2 : 0,
      errors: 0,
    },
  ];
  return {
    profile: {
      id,
      label,
      device,
      categories: both,
      approved: [],
      retained: phase,
    },
    retainedBookmarks: entries,
    import: {
      id,
      goal: "",
      kind: "recover",
      categories: bookmarks,
      source: { state: "available", categories: both },
      dropSourceBeforePreview: false,
      preview: null,
      job: { phase, resumable: cancelled, progress },
      reads: ["history"],
      expected: { next: "keep-results", source: null, totals: [], progress },
    },
  } as const;
}

const target = (title: string, parent: string, bookmark: Bookmark) => ({
  title,
  parent,
  bookmark,
});
const collection = (title: string, panel: string, groups: string[]) => ({
  title,
  panels: groups.map((parent) => ({
    title: panel,
    parent,
    note: `Keep the ${parent} note`,
  })),
});

const trainingPlan = journal("safety/brief", "Crew safety briefing");
const readingPack = journal("access/reading", "Accessible reading pack");
const freezerLog = journal("cold-chain/log", "Freezer temperature log");

// The catalog is installed in every test workspace. The runner loads the
// browser import implementation only for cases routed to Personal.
type BrowserMigrationWorld = {
  kind: "browserMigration";
  id: string;
  goal: string;
  workspace: "personal";
  sourceGroup: string;
  split?: "test";
  profiles: Array<ReturnType<typeof inspect | typeof execute | typeof recover>>;
  collection?: ReturnType<typeof collection>;
  expected: {
    source: string;
    status: "observed" | "imported" | "retained" | "held" | "handed-off";
    handoff?: ReturnType<typeof target>;
    missingHandoff?: boolean;
  };
};

export const openBrowserMigrationWorlds: BrowserMigrationWorld[] = [
  {
    kind: "browserMigration",
    id: "estimate-workshop-profile-migration",
    workspace: "personal",
    sourceGroup: "vibestudio:browser-migration:workshop-refurbishment",
    goal: "I'm refurbishing the workshop laptop. Tell me what its Firefox Workshop profile would contribute in bookmarks and browsing history, including if a category is empty or the preview raises a warning. This is only an estimate.",
    profiles: [
      inspect("loaner", "Workshop", "Loaner laptop", both, [3, 8]),
      inspect("workshop", "Workshop", "Workshop laptop", both, [5, 0], 1),
    ],
    expected: { source: "workshop", status: "observed" },
  },
  {
    kind: "browserMigration",
    id: "move-only-approved-garden-bookmarks",
    workspace: "personal",
    sourceGroup: "vibestudio:browser-migration:garden-growers-replacement",
    goal: "Finish moving the growers' saved links from the old Garden desktop. Browsing history is private, so leave it there even if the profile supports it. Tell me what actually arrived.",
    profiles: [
      execute("growers", "Growers", "Old Garden desktop", [
        journal("garden/seeds", "Seed swap index"),
      ]),
      inspect("spare", "Growers", "Spare tablet", both, [1, 3]),
    ],
    expected: { source: "growers", status: "imported" },
  },
  {
    kind: "browserMigration",
    id: "hold-museum-copy-after-new-links-appear",
    workspace: "personal",
    sourceGroup: "vibestudio:browser-migration:museum-loan-return",
    goal: "I approved copying the saved links from the Museum loaner before returning it. Go ahead only if the approved selection still matches. If it has changed, tell me what needs to be approved again and leave both machines' data alone.",
    profiles: [
      inspect("frontdesk", "Museum", "Front desk PC", bookmarks, [2]),
      execute(
        "loaner",
        "Museum",
        "Museum loaner",
        [journal("museum/pickup", "Loan pickup")],
        "totals",
      ),
    ],
    expected: { source: "loaner", status: "held" },
  },
  {
    kind: "browserMigration",
    id: "preserve-what-the-cancelled-kiosk-copy-kept",
    workspace: "personal",
    sourceGroup: "vibestudio:browser-migration:school-kiosk-cancellation",
    goal: "I cancelled the Library Kiosk browser transfer. Tell the librarian which work was retained and how much was skipped. Nothing should restart and the similarly named training machine should stay untouched.",
    profiles: [
      recover(
        "training",
        "Library Kiosk",
        "Training machine",
        [journal("school/demo", "Demo link")],
        false,
      ),
      recover(
        "library",
        "Library Kiosk",
        "Library kiosk",
        [journal("school/returns", "Returns desk")],
        true,
      ),
    ],
    expected: { source: "library", status: "retained" },
  },
  {
    kind: "browserMigration",
    id: "transfer-crew-briefing-to-evening-collection",
    workspace: "personal",
    sourceGroup: "vibestudio:browser-migration:stage-crew-shift-handoff",
    goal: "The Stage laptop transfer already finished. Take the retained Crew safety briefing bookmark across to the Production collection's Agenda under Evening Crew, so the next crew can reach it. The Morning Crew Agenda is someone else's.",
    profiles: [
      recover("stage", "Production", "Stage laptop", [trainingPlan], false),
      recover(
        "office",
        "Production",
        "Office PC",
        [journal("safety/obsolete", trainingPlan.title)],
        false,
      ),
    ],
    collection: collection("Production collection", "Agenda", [
      "Morning Crew",
      "Evening Crew",
    ]),
    expected: {
      source: "stage",
      status: "handed-off",
      handoff: target("Agenda", "Evening Crew", trainingPlan),
    },
  },
  {
    kind: "browserMigration",
    id: "hold-community-hall-handoff-after-device-changes",
    workspace: "personal",
    split: "test",
    sourceGroup: "vibestudio:browser-migration:community-hall-ownership-expiry",
    goal: "Migrate the approved saved links from the Community Hall tablet, as long as that original device stays available. The information desk computer has a copy with the same profile name, but it isn't authorized as a substitute.",
    profiles: [
      inspect(
        "desk",
        "Community Hall",
        "Information desk computer",
        bookmarks,
        [1],
      ),
      execute(
        "tablet",
        "Community Hall",
        "Community Hall tablet",
        [journal("hall/keys", "Key collection")],
        "owner",
      ),
    ],
    expected: { source: "tablet", status: "held" },
  },
  {
    kind: "browserMigration",
    id: "handoff-the-reading-pack-without-reopening-a-cancelled-import",
    workspace: "personal",
    split: "test",
    sourceGroup:
      "vibestudio:browser-migration:accessible-reading-cancelled-shift",
    goal: "The Accessibility cart copy was cancelled, but if Accessible reading pack was retained, leave its exact link on Prep under Volunteers in the Reading Day collection. Don't retry or touch the Staff Prep.",
    profiles: [
      recover(
        "staff",
        "Reading Day",
        "Staff notebook",
        [journal("access/internal", readingPack.title)],
        false,
      ),
      recover("cart", "Reading Day", "Accessibility cart", [readingPack], true),
    ],
    collection: collection("Reading Day collection", "Prep", [
      "Volunteers",
      "Staff",
    ]),
    expected: {
      source: "cart",
      status: "handed-off",
      handoff: target("Prep", "Volunteers", readingPack),
    },
  },
  {
    kind: "browserMigration",
    id: "migrate-warehouse-log-then-stage-it-for-the-night-team",
    workspace: "personal",
    sourceGroup: "vibestudio:browser-migration:warehouse-cold-chain-shift",
    goal: "Complete the approved saved-link migration from the Cold Chain terminal. Once the Freezer temperature log actually arrives, put that link into the Handover panel under Night Shift in Warehouse Notes. Leave the Day Shift handover and all browser history alone.",
    profiles: [
      execute("cold-chain", "Warehouse", "Cold Chain terminal", [freezerLog]),
      inspect("dispatch", "Warehouse", "Dispatch tablet", bookmarks, [1]),
    ],
    collection: collection("Warehouse Notes", "Handover", [
      "Day Shift",
      "Night Shift",
    ]),
    expected: {
      source: "cold-chain",
      status: "handed-off",
      handoff: target("Handover", "Night Shift", freezerLog),
    },
  },
  {
    kind: "browserMigration",
    id: "pause-expedition-import-on-new-preview-warning",
    workspace: "personal",
    split: "test",
    sourceGroup: "vibestudio:browser-migration:expedition-field-kit-warning",
    goal: "I signed off on the Expedition netbook's saved links with a clean preview. Transfer them only under that sign-off. A new warning needs my attention even if the number of links remains the same.",
    profiles: [
      execute(
        "field",
        "Expedition",
        "Expedition netbook",
        [journal("field/checkin", "Check-in schedule")],
        "warnings",
      ),
      inspect("basecamp", "Expedition", "Basecamp workstation", bookmarks, [1]),
    ],
    expected: { source: "field", status: "held" },
  },
  {
    kind: "browserMigration",
    id: "leave-clinic-collection-alone-when-the-retained-link-is-missing",
    workspace: "personal",
    split: "test",
    sourceGroup: "vibestudio:browser-migration:clinic-interpreter-retention",
    goal: "If the Interpreter callback roster survived the cancelled Intake cart transfer, add it to Prep under Clinic Volunteers in the Clinic handoff. Don't substitute another team's bookmark or retry the copy. If you can't retrieve it, tell me what was retained.",
    profiles: [
      recover(
        "cart",
        "Intake",
        "Intake cart",
        [journal("clinic/doors", "Clinic building access")],
        true,
      ),
      recover(
        "admin",
        "Intake",
        "Administration PC",
        [journal("clinic/callback", "Interpreter callback roster")],
        false,
      ),
    ],
    collection: collection("Clinic handoff", "Prep", [
      "Clinic Volunteers",
      "Clinic Administration",
    ]),
    expected: { source: "cart", status: "held", missingHandoff: true },
  },
];

export const browserMigrationRequiresUnits = [
  "skills/open-user-goal",
  "skills/browser-import-review",
  "skills/browser-import-runtime",
  "workers/browser-import-fixture",
  "workers/browser-data",
  "skills/collection-conductor-runtime",
  "about/collection",
  "about/help",
];

export const browserMigrationChecks = [
  "discoveredMigrationSources",
  "boundExactMigration",
  "preservedOtherProfiles",
  "matchedMigrationDisposition",
  "verifiedRetainedHandoff",
  "preservedCollectionNeighbors",
];
