export const personalResumeWorlds = [
  {
    id: "resume-pull-without-github-connection",
    goal: "Pick up work in the assigned repository by pulling upstream changes into the current branch. Check what can proceed from the actual local state and hand off any access prerequisite to the right setup owner.",
    dirty: false,
    operation: "pull",
    access: "read-only",
    decision: "request-access",
    ownerAction: "setup",
  },
  {
    id: "review-local-edit-before-push",
    goal: "Prepare to push the assigned repository's branch. Find the first prerequisite using its actual working state and leave local changes intact for review.",
    dirty: true,
    operation: "push",
    access: "collaborate",
    decision: "review-local-changes",
    ownerAction: "skip",
  },
] as const;
