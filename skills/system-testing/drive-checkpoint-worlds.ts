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

export const managedDriveCheckpointWorlds = [
  {
    id: "terminal-shared-drive-page",
    goal: "Resume the assigned shared drive from its saved cursor. Apply the terminal checkpoint only after the full feed. Report the last change for each roster and verify the persisted cursor.",
    driveId,
    initial,
    pages,
    competitor: null,
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
    expected: {
      state: "stale",
      cursor: competitor,
      ids: ["obsolete", "current"],
      attempts: 1,
    },
  },
] as const;
