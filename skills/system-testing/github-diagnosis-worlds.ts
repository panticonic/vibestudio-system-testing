const setupFailure = {
  failure: "No active GitHub credential is available.",
  cause: "not-connected",
  step: "Use the GitHub setup owner to connect the minimum access needed for the requested work.",
} as const;

export const managedGitHubDiagnosisWorlds = [
  {
    id: "unsupported-remote-before-verification",
    goal: "Diagnose why the assigned GitHub remote cannot be verified. Identify the local prerequisite before trying a connection.",
    check: { kind: "remote", remoteUrl: "ssh://git@github.com/example/assigned-project.git" },
    failure: "Invalid GitHub remote URL for local verification.",
    cause: "invalid-remote",
    step: "Use the assigned repository's HTTPS Git URL on github.com with a .git path, then repeat the local remote check.",
    setup: null,
  },
  {
    ...setupFailure,
    id: "repository-publication-needs-owner-setup",
    goal: "Diagnose the local preflight for creating a GitHub repository to publish this project. The current surface can open setup.",
    check: { kind: "publish", publication: "repository", interactive: true },
    setup: { access: "publish", handoff: "offer-setup" },
  },
  {
    ...setupFailure,
    id: "pages-publication-needs-interactive-setup",
    goal: "Diagnose the GitHub Pages publication preflight from a terminal without an interactive setup surface.",
    check: { kind: "publish", publication: "pages", interactive: false },
    setup: { access: "publish-pages", handoff: "interactive-required" },
  },
] as const;
