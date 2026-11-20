const examplesBaseline = "81b3857e28387ddcd70cb5e4d6c8a913ee87e10e";

export const templateCandidateManagedWorlds = [
  {
    id: "stage-examples-for-semantic-review",
    goal: "Stage the selected Examples update in its own review context. Confirm which candidate needs semantic validation and leave protected main at its current revision.",
    status: "validate-candidate",
    intent: "stage",
    workspace: "examples",
    workspaceBaseline: examplesBaseline,
  },
  {
    id: "inspect-available-examples-release",
    goal: "Check whether the selected Examples upgrade is available and report the exact offer. This is a read-only review.",
    status: "available",
    intent: "inspect",
    workspace: "examples",
    workspaceBaseline: examplesBaseline,
  },
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
