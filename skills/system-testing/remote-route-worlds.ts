type Source = "session" | "context" | "ambient" | "binding" | "default";
type Coordinate = "owned" | "other" | "foreign";
type CliWorld = {
  credential: "device" | "agent";
  operation: "inspect" | "edit" | "eval";
  selectors: Partial<Record<Source, Coordinate>>;
  source: Source;
  status: "usable" | "foreign-workspace" | "foreign-context";
  action: "run-assigned-command" | "ask-parent" | "repair-scope";
};
export const cliContinuationWork = [
  { kind: "domain", domain: "remoteAccess", operation: "reviewRemoteRoute" },
  { kind: "domain", domain: "remoteAccess", operation: "planCliContinuation" },
] as const;
function cliWorld(id: string, goal: string, cli: CliWorld) {
  return {
    id,
    goal,
    cli,
    differentWorkspace: false,
    verdict: "verified",
    layer: "healthy",
    next: "accept-identity",
  } as const;
}
export const remoteRouteWorlds = [
  {
    id: "confirmed-workspace-gateway",
    goal: "Verify that the opened gateway belongs to my assigned server and workspace. Keep the authenticated identity in the handoff.",
    differentWorkspace: false,
    verdict: "verified",
    layer: "healthy",
    next: "accept-identity",
    cli: null,
  },
  {
    id: "stale-workspace-assignment",
    goal: "The gateway answered but it may be the wrong workspace. Compare the exact workspace IDs and tell me whether I should refresh the assigned reach.",
    differentWorkspace: true,
    verdict: "workspace-mismatch",
    layer: "workspace-routing",
    next: "refresh-workspace-reach",
    cli: null,
  },
  cliWorld(
    "cli-explicit-session-before-context",
    "Verify the gateway before planning a read. The explicitly named session and explicit context flag point to different contexts. Identify the actual context and whether the read can proceed.",
    {
      credential: "device",
      operation: "inspect",
      selectors: { session: "owned", context: "other", binding: "foreign" },
      source: "session",
      status: "usable",
      action: "run-assigned-command",
    },
  ),
  cliWorld(
    "cli-foreign-mirror-before-default",
    "Verify the gateway, then plan a read from a mirrored folder that was bound to another workspace. The default session points to the current workspace. Report what to fix before running the command.",
    {
      credential: "device",
      operation: "inspect",
      selectors: { binding: "foreign", default: "owned" },
      source: "binding",
      status: "foreign-workspace",
      action: "repair-scope",
    },
  ),
  cliWorld(
    "cli-linked-agent-eval",
    "Verify the live workspace route and plan an eval from a linked agent's own context. The environment and mirror select different contexts. Determine who can perform the eval.",
    {
      credential: "agent",
      operation: "eval",
      selectors: { ambient: "owned", binding: "other" },
      source: "ambient",
      status: "usable",
      action: "ask-parent",
    },
  ),
  cliWorld(
    "cli-linked-explicit-context-mismatch",
    "Verify the gateway and check an inspect command whose explicit context differs from the linked agent context. A matching ambient context is available. Identify the active scope problem.",
    {
      credential: "agent",
      operation: "inspect",
      selectors: { context: "other", ambient: "owned" },
      source: "context",
      status: "foreign-context",
      action: "repair-scope",
    },
  ),
] as const;
