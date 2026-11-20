export const templateCandidateManagedWorlds = [
  {
    id: "current-base-no-update",
    goal: "Check the recorded Base release before opening a review. Leave the workspace as it is if the release is already installed.",
    status: "current",
    intent: "stage",
  },
  {
    id: "base-check-predates-review-window",
    goal: "Determine whether the cached Base offer was checked during the authorized review window before using it to prepare anything.",
    status: "refresh",
    intent: "stage",
  },
  {
    id: "base-target-changed-since-assignment",
    goal: "I selected a specific Base revision. Check the latest discovery receipt and hold the operation if it points at a different target.",
    status: "target-changed",
    intent: "stage",
  },
] as const;
