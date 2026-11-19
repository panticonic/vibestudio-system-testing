export const folders = ["/Reading", "/Team", "/Archive", "/Follow-up"] as const;
const [reading, team, archive, followUp] = folders;
const site = "https://library.vibestudio.invalid";
export const origin = site;

const url = (path: string) => site + path;
export const seedBookmarks = [
  {
    key: "manual",
    folder: reading,
    title: "Migration manual",
    url: url("/manual"),
  },
  { key: "faq", folder: reading, title: "Runbook", url: url("/faq") },
  {
    key: "operations",
    folder: reading,
    title: "Runbook",
    url: url("/operations"),
  },
  {
    key: "teamManual",
    folder: team,
    title: "Shared manual",
    url: url("/manual"),
  },
  {
    key: "analysis",
    folder: team,
    title: "Current incident",
    url: url("/incident"),
  },
  { key: "oldFaq", folder: archive, title: "Old FAQ", url: url("/faq") },
  {
    key: "guide",
    folder: archive,
    title: "Partner guide",
    url: url("/partner"),
  },
] as const;

export const seedVisits = [
  {
    url: url("/notes-v1"),
    title: "Migration notes old",
    time: 1_722_000_000_001,
  },
  {
    url: url("/notes-v2"),
    title: "Migration notes current",
    time: 1_722_000_000_006,
  },
  {
    url: url("/rollout-a"),
    title: "Rollout calendar east",
    time: 1_722_000_000_009,
  },
  {
    url: url("/rollout-b"),
    title: "Rollout calendar west",
    time: 1_722_000_000_009,
  },
  { url: url("/manual"), title: "Migration manual", time: 1_722_000_000_004 },
  { url: url("/status"), title: "Current status", time: 1_722_000_000_012 },
  { url: url("/partner"), title: "Partner playbook", time: 1_722_000_000_010 },
] as const;

const byTitle = (folder: string, title: string) => ({ folder, title });
const byUrl = (folder: string, path: string) => ({ folder, url: url(path) });
type Ref = { folder: string; title?: string; url?: string };
const recover = (query: string, folder: string, title?: string) => ({
  kind: "recover" as const,
  query,
  folder,
  ...(title === undefined ? {} : { title }),
});
const rename = (target: Ref, title: string) => ({
  kind: "rename" as const,
  target,
  title,
});
const file = (target: Ref, folder: string) => ({
  kind: "file" as const,
  target,
  folder,
});
const retire = (target: Ref, keep: Ref) => ({
  kind: "retire" as const,
  target,
  keep,
});
type Action = ReturnType<
  typeof recover | typeof rename | typeof file | typeof retire
>;
type Outcome =
  | { kind: "held" }
  | { kind: "save"; key: string; url: string; title: string }
  | { kind: "rename" | "file"; key: string }
  | { kind: "retire"; key: string; keep: string };
const held: Outcome = { kind: "held" };
const saved = (key: string, path: string, title: string): Outcome => ({
  kind: "save",
  key,
  url: url(path),
  title,
});
const changed = (kind: "rename" | "file", key: string): Outcome => ({
  kind,
  key,
});
const retired = (key: string, keep: string): Outcome => ({
  kind: "retire",
  key,
  keep,
});

function world(id: string, goal: string, ...entries: [Action, Outcome][]) {
  return {
    id,
    request: { goal, actions: entries.map(([action]) => action) },
    expected: entries.map(([, outcome]) => outcome),
  };
}

export const managedBrowserLibraryWorlds = [
  world(
    "recover-latest-and-annotate",
    "Recover the latest Migration notes into Reading, then give the saved link its handoff title.",
    [
      recover("Migration notes", reading),
      saved("newNotes", "/notes-v2", "Migration notes current"),
    ],
    [
      rename(byTitle(reading, "Migration notes current"), "Migration handoff"),
      changed("rename", "newNotes"),
    ],
  ),
  world(
    "recovery-with-explicit-label",
    "Save the status page for the follow-up owner with a short label, then move it to Team.",
    [
      recover("/status", followUp, "Live status"),
      saved("status", "/status", "Live status"),
    ],
    [file(byTitle(followUp, "Live status"), team), changed("file", "status")],
  ),
  world(
    "recover-historical-version",
    "Save the older version of the notes by its URL fragment, then save the newer version separately.",
    [
      recover("/notes-v1", archive),
      saved("oldNotes", "/notes-v1", "Migration notes old"),
    ],
    [
      recover("/notes-v2", archive),
      saved("currentNotes", "/notes-v2", "Migration notes current"),
    ],
  ),
  world(
    "hold-a-tied-latest-result",
    "Recover a Rollout calendar only if the last visit identifies a unique page. Save the status page either way.",
    [recover("Rollout calendar", reading), held],
    [
      recover("Current status", followUp),
      saved("status", "/status", "Current status"),
    ],
  ),
  world(
    "skip-broken-memory-of-title",
    "Look for the release checklist and leave the library unchanged if it is absent. Relabel the shared manual.",
    [recover("Release checklist", team), held],
    [
      rename(byTitle(team, "Shared manual"), "Team migration manual"),
      changed("rename", "teamManual"),
    ],
  ),
  world(
    "skip-existing-bookmark",
    "Keep the existing Migration manual rather than filing a duplicate from history. Relabel the existing saved record.",
    [recover("Migration manual", reading), held],
    [
      rename(byUrl(reading, "/manual"), "Migration operator manual"),
      changed("rename", "manual"),
    ],
  ),
  world(
    "hold-ambiguous-runbook",
    "Do not rename an ambiguous title. Move the Operations runbook by its exact URL.",
    [rename(byTitle(reading, "Runbook"), "Runbook renamed"), held],
    [
      file(byUrl(reading, "/operations"), followUp),
      changed("file", "operations"),
    ],
  ),
  world(
    "rename-before-filing",
    "Rename the incident reference for the review, then file it under the new title.",
    [
      rename(byTitle(team, "Current incident"), "Post-incident review"),
      changed("rename", "analysis"),
    ],
    [
      file(byTitle(team, "Post-incident review"), archive),
      changed("file", "analysis"),
    ],
  ),
  world(
    "hold-destination-copy-then-retire",
    "Archive the FAQ when possible. If a duplicate already exists there, retire the Reading copy and preserve the archived copy.",
    [file(byUrl(reading, "/faq"), archive), held],
    [
      retire(byUrl(reading, "/faq"), byTitle(archive, "Old FAQ")),
      retired("faq", "oldFaq"),
    ],
  ),
  world(
    "hold-inexact-retention",
    "Retire the team incident only when the archive holds its exact copy. Prepare its title for review if it remains.",
    [retire(byUrl(team, "/incident"), byTitle(archive, "Old FAQ")), held],
    [
      rename(byUrl(team, "/incident"), "Incident ready for retention review"),
      changed("rename", "analysis"),
    ],
  ),
  world(
    "reject-self-retention",
    "Check whether the partner guide can be retired while retaining the same selected row. If it remains, move it to Team.",
    [
      retire(byUrl(archive, "/partner"), byTitle(archive, "Partner guide")),
      held,
    ],
    [file(byUrl(archive, "/partner"), team), changed("file", "guide")],
  ),
  world(
    "recover-copy-before-retirement",
    "Recover the partner playbook into Team before retiring the archived copy of that same link.",
    [
      recover("Partner playbook", team, "Team partner guide"),
      saved("partnerCopy", "/partner", "Team partner guide"),
    ],
    [
      retire(
        byTitle(archive, "Partner guide"),
        byTitle(team, "Team partner guide"),
      ),
      retired("guide", "partnerCopy"),
    ],
  ),
  world(
    "reobserve-after-retirement",
    "Retire the personal Migration manual while retaining the Team copy, then recover it into Follow-up from history.",
    [
      retire(
        byTitle(reading, "Migration manual"),
        byTitle(team, "Shared manual"),
      ),
      retired("manual", "teamManual"),
    ],
    [
      recover("Migration manual", followUp, "Follow-up migration notes"),
      saved("recoveredManual", "/manual", "Follow-up migration notes"),
    ],
  ),
  world(
    "reject-unassigned-folder",
    "Hold a bookmark request for an unavailable folder, then move the incident to an assigned folder.",
    [recover("Current status", "/Unassigned"), held],
    [file(byUrl(team, "/incident"), followUp), changed("file", "analysis")],
  ),
  world(
    "stop-using-a-stale-title",
    "Relabel the shared manual, decline a move addressed to its old title, then file it with the corrected reference.",
    [
      rename(byTitle(team, "Shared manual"), "Reviewed migration"),
      changed("rename", "teamManual"),
    ],
    [file(byTitle(team, "Shared manual"), followUp), held],
    [
      file(byTitle(team, "Reviewed migration"), followUp),
      changed("file", "teamManual"),
    ],
  ),
  world(
    "retain-bookmark-metadata-across-edits",
    "Rename and file the archived FAQ, retire the duplicate under Reading, and save the latest notes to the same destination.",
    [
      rename(byUrl(archive, "/faq"), "Reviewed FAQ"),
      changed("rename", "oldFaq"),
    ],
    [
      file(byTitle(archive, "Reviewed FAQ"), followUp),
      changed("file", "oldFaq"),
    ],
    [
      retire(byUrl(reading, "/faq"), byTitle(followUp, "Reviewed FAQ")),
      retired("faq", "oldFaq"),
    ],
    [
      recover("Migration notes", followUp),
      saved("currentNotes", "/notes-v2", "Migration notes current"),
    ],
  ),
];
