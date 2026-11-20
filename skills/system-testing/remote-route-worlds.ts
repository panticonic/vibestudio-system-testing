export const remoteRouteWorlds = [
  {
    id: "confirmed-workspace-gateway",
    goal: "Verify that the opened gateway belongs to my assigned server and workspace. Keep the authenticated identity in the handoff.",
    differentWorkspace: false,
    verdict: "verified",
    layer: "healthy",
    next: "accept-identity",
  },
  {
    id: "stale-workspace-assignment",
    goal: "The gateway answered but it may be the wrong workspace. Compare the exact workspace IDs and tell me whether I should refresh the assigned reach.",
    differentWorkspace: true,
    verdict: "workspace-mismatch",
    layer: "workspace-routing",
    next: "refresh-workspace-reach",
  },
] as const;
