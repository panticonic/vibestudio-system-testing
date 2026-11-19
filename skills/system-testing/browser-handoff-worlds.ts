type HandoffWorld = {
  id: string;
  library: string;
  bookmarkKey: string;
  path: string;
  panel: { title: string; parent?: string; key: string };
  heading: string;
  goal: string;
};

const inbox = { title: "Inbox", key: "inbox" };
const reference = { title: "Reference", key: "reference" };
const notes = { title: "Notes", key: "notes" };
const intakeAgenda = { title: "Agenda", parent: "Intake", key: "in-agenda" };
const reviewAgenda = { title: "Agenda", parent: "Review", key: "re-agenda" };
const checklist = { title: "Checklist", parent: "Drafts", key: "checklist" };

export const managedBrowserHandoffWorlds: HandoffWorld[] = [
  {
    id: "latest-migration",
    library: "recover-latest-and-annotate",
    bookmarkKey: "newNotes",
    path: "/notes-v2",
    panel: inbox,
    heading: "Migration triage",
    goal: "Leave the next triager the recovered current notes, after the bookmark has its handoff title.",
  },
  {
    id: "status-for-review",
    library: "recovery-with-explicit-label",
    bookmarkKey: "status",
    path: "/status",
    panel: reviewAgenda,
    heading: "Status decision",
    goal: "After the status bookmark is in Team, pin the reference on the Review agenda.",
  },
  {
    id: "old-version-for-comparison",
    library: "recover-historical-version",
    bookmarkKey: "oldNotes",
    path: "/notes-v1",
    panel: reference,
    heading: "Historical comparison",
    goal: "Preserve both versions of the notes. Put only the historical version in the panel handoff so the comparison has its original baseline.",
  },
  {
    id: "calendar-ambiguity",
    library: "hold-a-tied-latest-result",
    bookmarkKey: "status",
    path: "/status",
    panel: intakeAgenda,
    heading: "Release intake",
    goal: "Keep the ambiguous calendar out of the handoff and route the independently verified status page to Intake.",
  },
  {
    id: "missing-checklist-fallback",
    library: "skip-broken-memory-of-title",
    bookmarkKey: "teamManual",
    path: "/manual",
    panel: checklist,
    heading: "Checklist fallback",
    goal: "When the remembered checklist cannot be found, hand off the explicitly retained manual instead.",
  },
  {
    id: "deduplicate-migration-manual",
    library: "skip-existing-bookmark",
    bookmarkKey: "manual",
    path: "/manual",
    panel: notes,
    heading: "Migration operator reference",
    goal: "Keep a single Reading copy of the operator manual and put its exact URL in the Notes panel.",
  },
  {
    id: "operations-runbook",
    library: "hold-ambiguous-runbook",
    bookmarkKey: "operations",
    path: "/operations",
    panel: intakeAgenda,
    heading: "Operations follow-up",
    goal: "Use the Operations URL to distinguish the two Runbooks. Link the filed one from the agenda under Intake.",
  },
  {
    id: "post-incident-review",
    library: "rename-before-filing",
    bookmarkKey: "analysis",
    path: "/incident",
    panel: reviewAgenda,
    heading: "Archived incident review",
    goal: "File the renamed incident bookmark before sending its reference into the project review agenda.",
  },
  {
    id: "retained-faq",
    library: "hold-destination-copy-then-retire",
    bookmarkKey: "oldFaq",
    path: "/faq",
    panel: reference,
    heading: "Retained FAQ",
    goal: "Keep the archived FAQ when the Reading duplicate is retired and use that retained copy for the handoff.",
  },
  {
    id: "incident-retention-hold",
    library: "hold-inexact-retention",
    bookmarkKey: "analysis",
    path: "/incident",
    panel: checklist,
    heading: "Incident retained pending review",
    goal: "Preserve the incident when the offered archival copy points elsewhere. Make the surviving incident the checklist reference.",
  },
  {
    id: "partner-guide-no-self-retirement",
    library: "reject-self-retention",
    bookmarkKey: "guide",
    path: "/partner",
    panel: intakeAgenda,
    heading: "Partner intake guide",
    goal: "Keep the partner guide when the only supposed replacement is itself, then hand off the Team copy after filing.",
  },
  {
    id: "partner-copy-before-retirement",
    library: "recover-copy-before-retirement",
    bookmarkKey: "partnerCopy",
    path: "/partner",
    panel: reviewAgenda,
    heading: "Team partner guide",
    goal: "Confirm the recovered Team bookmark survives the archive retirement before adding it to the review handoff.",
  },
  {
    id: "manual-follow-up-with-new-copy",
    library: "reobserve-after-retirement",
    bookmarkKey: "recoveredManual",
    path: "/manual",
    panel: inbox,
    heading: "Follow-up migration link",
    goal: "Retire the redundant bookmark, recover a follow-up copy, and link the new copy in the panel handoff.",
  },
  {
    id: "keep-handoff-in-approved-folders",
    library: "reject-unassigned-folder",
    bookmarkKey: "analysis",
    path: "/incident",
    panel: notes,
    heading: "Approved-folder follow-up",
    goal: "Hold the write to an unavailable folder and hand off the incident link from the valid filing operation.",
  },
  {
    id: "reference-after-rename",
    library: "stop-using-a-stale-title",
    bookmarkKey: "teamManual",
    path: "/manual",
    panel: reviewAgenda,
    heading: "Reviewed migration handoff",
    goal: "A move addressed to the old title must not count. Wait for the corrected filing before linking the manual.",
  },
  {
    id: "faq-after-retention-cleanup",
    library: "retain-bookmark-metadata-across-edits",
    bookmarkKey: "oldFaq",
    path: "/faq",
    panel: checklist,
    heading: "Reviewed FAQ evidence",
    goal: "Hand off the retained FAQ after filing, retirement, and recovery all complete.",
  },
];
