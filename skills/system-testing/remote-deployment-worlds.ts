export const managedDeploymentWorlds = [
  {
    id: "fresh-default-workspace",
    intent: "deploy",
    goal: "Start the assigned empty VibeStudio server profile and verify its default workspace is reachable.",
  },
  {
    id: "preserves-workspace-on-update",
    intent: "update",
    goal: "Reapply the assigned server build. Verify a new hub boot with the same server and workspace identities.",
  },
] as const;
