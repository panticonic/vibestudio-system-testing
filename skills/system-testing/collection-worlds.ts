const ref = (title: string, parent?: string) =>
  parent ? { title, parent } : { title };
const root = ref("Handoff collection");
const intake = ref("Intake");
const review = ref("Review");
const draft = ref("Drafts");
const inbox = ref("Inbox");
const reference = ref("Reference");
const notes = ref("Notes");
const intakeAgenda = ref("Agenda", "Intake");
const reviewAgenda = ref("Agenda", "Review");

const rename = (target: ReturnType<typeof ref>, title: string) =>
  ({ kind: "rename", target, title }) as const;
const note = (target: ReturnType<typeof ref>, text: string | null) =>
  ({ kind: "note", target, text }) as const;
const group = (parent: ReturnType<typeof ref>, title: string) =>
  ({ kind: "group", parent, title }) as const;
const move = (
  target: ReturnType<typeof ref>,
  parent: ReturnType<typeof ref>,
  after?: ReturnType<typeof ref>,
) => ({ kind: "move", target, parent, ...(after ? { after } : {}) }) as const;

type Action = ReturnType<
  typeof rename | typeof note | typeof group | typeof move
>;
type Expected =
  | { kind: "held" }
  | { kind: "rename" | "note"; key: string }
  | { kind: "group"; parent: string; key: string }
  | { kind: "move"; key: string; parent: string; after: string | null };

const edit = (kind: "rename" | "note", key: string): Expected => ({
  kind,
  key,
});
const created = (parent: string, key: string): Expected => ({
  kind: "group",
  parent,
  key,
});
const moved = (
  key: string,
  parent: string,
  after: string | null = null,
): Expected => ({ kind: "move", key, parent, after });
const held: Expected = { kind: "held" };

export const collectionSeed = [
  { key: "intake", parent: "root", title: "Intake", collection: true },
  { key: "inbox", parent: "root", title: "Inbox", collection: false },
  { key: "reference", parent: "root", title: "Reference", collection: false },
  { key: "review", parent: "root", title: "Review", collection: true },
  { key: "notes", parent: "root", title: "Notes", collection: false },
  { key: "in-agenda", parent: "intake", title: "Agenda", collection: false },
  { key: "re-agenda", parent: "review", title: "Agenda", collection: false },
  { key: "drafts", parent: "review", title: "Drafts", collection: true },
  { key: "checklist", parent: "drafts", title: "Checklist", collection: false },
] as const;
export const collectionRootTitle = root.title;

function world(id: string, goal: string, plan: [Action, Expected][]) {
  return {
    id,
    request: { goal, actions: plan.map(([action]) => action) },
    expected: plan.map(([, expected]) => expected),
  };
}

export const managedCollectionWorlds = [
  world(
    "rename-followed-by-note",
    "Give Inbox its handoff title, then mark its priority using the new title.",
    [
      [rename(inbox, "Current triage"), edit("rename", "inbox")],
      [
        note(ref("Current triage"), "Review before noon"),
        edit("note", "inbox"),
      ],
    ],
  ),
  world(
    "remove-note-and-keep-neighbor",
    "Remove the stale Inbox note and add a handoff note to the collection's Notes panel.",
    [
      [note(inbox, null), edit("note", "inbox")],
      [note(notes, "Prepared for the evening owner"), edit("note", "notes")],
    ],
  ),
  world(
    "hold-duplicate-agenda",
    "Mark Agenda if its identity is clear. Record the separate Reference note regardless.",
    [
      [note(ref("Agenda"), "Escalate"), held],
      [note(reference, "Leave with the project"), edit("note", "reference")],
    ],
  ),
  world(
    "qualify-agendas-by-parent",
    "Give the two Agendas distinct labels using their Intake and Review parents.",
    [
      [rename(intakeAgenda, "Incoming agenda"), edit("rename", "in-agenda")],
      [rename(reviewAgenda, "Review agenda"), edit("rename", "re-agenda")],
    ],
  ),
  world(
    "reorder-at-root",
    "Place Inbox immediately after Reference in the root, then annotate the reference handoff.",
    [
      [move(inbox, root, reference), moved("inbox", "root", "reference")],
      [note(reference, "Read before triage"), edit("note", "reference")],
    ],
  ),
  world(
    "move-before-other-work",
    "Move Reference to the top of Review so it is visible before the draft material.",
    [
      [move(reference, review), moved("reference", "review")],
      [note(reference, "Start here"), edit("note", "reference")],
    ],
  ),
  world(
    "keep-nested-subtree-together",
    "Move Review, with its Drafts and Checklist intact, under Intake after the Intake Agenda.",
    [
      [
        move(review, intake, intakeAgenda),
        moved("review", "intake", "in-agenda"),
      ],
      [
        note(ref("Checklist", "Drafts"), "Keep with Review"),
        edit("note", "checklist"),
      ],
    ],
  ),
  world(
    "create-then-move",
    "Create a Handoff group under the root and move the Notes panel into it.",
    [
      [group(root, "Handoff"), created("root", "handoff")],
      [move(notes, ref("Handoff")), moved("notes", "handoff")],
    ],
  ),
  world(
    "create-nested-twice",
    "Create a Decision group under Review and an Evidence group inside it. Move Checklist into Evidence.",
    [
      [group(review, "Decision"), created("review", "decision")],
      [
        group(ref("Decision", "Review"), "Evidence"),
        created("decision", "evidence"),
      ],
      [move(ref("Checklist"), ref("Evidence")), moved("checklist", "evidence")],
    ],
  ),
  world(
    "move-and-reuse-parent-filter",
    "Place the Intake Agenda in Drafts, then use its new parent to give it a note.",
    [
      [move(intakeAgenda, draft), moved("in-agenda", "drafts")],
      [
        note(ref("Agenda", "Drafts"), "Moved from Intake"),
        edit("note", "in-agenda"),
      ],
    ],
  ),
  world(
    "keep-root-anchored",
    "Leave the collection root anchored if the request to move it is invalid. Keep the legitimate Intake title edit.",
    [
      [move(root, intake), held],
      [rename(intake, "Incoming"), edit("rename", "intake")],
    ],
  ),
  world(
    "prevent-ancestor-cycle",
    "Review should never become a child of its own Drafts group. Move Inbox there instead.",
    [
      [move(review, draft), held],
      [move(inbox, draft), moved("inbox", "drafts")],
    ],
  ),
  world(
    "hold-wrong-sibling-anchor",
    "Try to put Notes after an Intake Agenda inside Review only if that reference is actually a Review sibling. Preserve the valid review note.",
    [
      [move(notes, review, intakeAgenda), held],
      [note(reviewAgenda, "Keep in review"), edit("note", "re-agenda")],
    ],
  ),
  world(
    "check-outside-membership",
    "Annotate Outside only if this collection owns it. The Inbox note is in scope and should be updated.",
    [
      [note(ref("Outside"), "Move in later"), held],
      [note(inbox, "Ready for import"), edit("note", "inbox")],
    ],
  ),
  world(
    "reject-duplicate-group-title",
    "Only add an Intake group if that title is free. Create a separate Closed group and move Inbox there.",
    [
      [group(root, "Intake"), held],
      [group(root, "Closed"), created("root", "closed")],
      [move(inbox, ref("Closed")), moved("inbox", "closed")],
    ],
  ),
  world(
    "hold-stale-name-after-rename",
    "Rename Intake to Backlog. Treat the old title as stale and record the note under the current title.",
    [
      [rename(intake, "Backlog"), edit("rename", "intake")],
      [note(intake, "Old handoff"), held],
      [note(ref("Backlog"), "Current gate"), edit("note", "intake")],
    ],
  ),
  world(
    "invalid-leaf-destination",
    "Reference is a document panel. Keep Notes out of it and move Notes to Drafts instead.",
    [
      [move(notes, reference), held],
      [move(notes, draft), moved("notes", "drafts")],
    ],
  ),
  world(
    "sibling-anchor-shifts-with-first-move",
    "Move Reference into Review, then place Inbox immediately after Reference using its new parent.",
    [
      [move(reference, review), moved("reference", "review")],
      [
        move(inbox, review, ref("Reference", "Review")),
        moved("inbox", "review", "reference"),
      ],
      [note(inbox, "Review with reference"), edit("note", "inbox")],
    ],
  ),
];
