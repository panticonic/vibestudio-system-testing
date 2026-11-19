export const publicationRevisionWorlds = [
  {
    id: "repeat-identical-website-package",
    goal: "Check whether the retained preview review still applies after packaging the same workspace website again.",
    environment: "preview",
    edit: false,
    decision: "keep-review",
  },
  {
    id: "same-artifact-different-environment",
    goal: "The original review covered preview. Determine whether the same public package can carry that review into production.",
    environment: "production",
    edit: false,
    decision: "review-target",
  },
  {
    id: "changed-public-caption",
    goal: "Compare the reviewed departure board with the revised public caption. Determine which package files need another review.",
    environment: "preview",
    edit: true,
    decision: "review-public-change",
  },
] as const;
