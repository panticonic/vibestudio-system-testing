const protectedRepository = "skills/vibestudio-vcs";

export const managedGitBridgeReviewWorlds = [
  {
    id: "protected-source-without-upstream",
    goal: "Review export of the protected repository to external Git. Identify whether Git Bridge has an upstream for it and what is needed before checking any external branch.",
    repository: protectedRepository,
    direction: "export",
    draft: false,
    source: "protected",
    next: "configure-upstream",
  },
  {
    id: "draft-awaiting-semantic-publication",
    goal: "Review export of the latest local delivery note. Explain whether that draft is visible at protected main and what must happen before the bridge could export it.",
    repository: protectedRepository,
    direction: "export",
    draft: true,
    source: "protected",
    next: "verify-semantic-publication",
  },
  {
    id: "missing-repository-import",
    goal: "Determine the correct import starting point for the assigned project. Check whether the workspace already contains it or has a Git upstream for it.",
    repository: "projects/training-git-bridge-absent",
    direction: "import",
    draft: false,
    source: "missing",
    next: "import-project",
  },
] as const;
