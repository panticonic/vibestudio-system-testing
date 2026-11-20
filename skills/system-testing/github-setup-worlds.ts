export const githubSetupWorlds = [
  {
    id: "connect-for-github-pages",
    goal: "Prepare the GitHub connection needed to put my website online with GitHub Pages.",
    accessLevel: "publish-pages",
    interactive: true,
    handoff: "offer-setup",
  },
  {
    id: "inspect-open-prs-headless",
    goal: "Get set up to read and summarize the currently open pull requests. This surface cannot display the setup component.",
    accessLevel: "read-only",
    interactive: false,
    handoff: "interactive-required",
  },
] as const;
