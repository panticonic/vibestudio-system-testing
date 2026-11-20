const initial = "saved-operations";
const tail = "operations-page-two";
const terminal = "new-operations";
const competitor = "other-writer-operations";
const pages = [
  {
    cursor: initial,
    response: {
      nextPageToken: tail,
      newStartPageToken: "ignore-intermediate-checkpoint",
      changes: [
        { fileId: "obsolete", file: { id: "obsolete", name: "Old roster" } },
      ],
    },
  },
  {
    cursor: tail,
    response: {
      newStartPageToken: terminal,
      changes: [
        { fileId: "obsolete", removed: true },
        { fileId: "current", file: { id: "current", name: "Current roster" } },
      ],
    },
  },
] as const;
const driveId = "ops-shared-drive";

const checkpointWorlds = [
  {
    id: "terminal-shared-drive-page",
    goal: "Resume the assigned shared drive from its saved cursor. Apply the terminal checkpoint only after the full feed. Report the last change for each roster and verify the persisted cursor.",
    driveId,
    initial,
    pages,
    competitor: null,
    handoff: false,
    expected: {
      state: "saved",
      cursor: terminal,
      ids: ["obsolete", "current"],
      attempts: 1,
    },
  },
  {
    id: "missing-terminal-shared-drive-page",
    goal: "Review as much of the shared Drive feed as is available. If the final page is unavailable, report the observed changes and preserve the old checkpoint.",
    driveId,
    initial,
    pages: [pages[0], { cursor: tail, response: null }],
    competitor: null,
    handoff: false,
    expected: {
      state: "held",
      cursor: initial,
      ids: ["obsolete"],
      attempts: 0,
    },
  },
  {
    id: "checkpoint-moved-during-paging",
    goal: "Continue the assigned shared Drive feed and preserve the cursor if another writer advanced it while you were paging. Report the observed changes and the actual checkpoint retained for the next operator.",
    driveId,
    initial,
    pages,
    competitor,
    handoff: false,
    expected: {
      state: "stale",
      cursor: competitor,
      ids: ["obsolete", "current"],
      attempts: 1,
    },
  },
] as const;

export const driveCheckpointHandoffWork = [
  { kind: "domain", domain: "google", operation: "guideGoogleWorkspace" },
  { kind: "domain", domain: "scratchHandoff", operation: "assembleHandoff" },
] as const;

export function projectDriveCheckpointSource(checkpoint: {
  persisted: string;
  terminal: string | null;
  receipt: { state: string } | null;
}) {
  return (
    [
      `Saved cursor: ${checkpoint.persisted}`,
      `Terminal feed cursor: ${checkpoint.terminal ?? "unavailable"}`,
      `Checkpoint write outcome: ${checkpoint.receipt?.state ?? "held"}`,
    ].join("\n") + "\n"
  );
}

export const managedDriveCheckpointWorlds = [
  ...checkpointWorlds,
  {
    ...checkpointWorlds[0],
    id: "terminal-checkpoint-shift-handoff",
    goal: "Continue the shared Drive feed and leave a checkpoint handoff for the next shift. Verify the cursor saved to the workspace and record both the terminal candidate and the result of the write.",
    handoff: true,
  },
  {
    ...checkpointWorlds[2],
    id: "superseded-checkpoint-shift-handoff",
    goal: "Leave a checkpoint handoff after another writer advances the shared Drive cursor during paging. Record the cursor the next shift should use and the candidate that lost the write guard.",
    handoff: true,
  },
] as const;
