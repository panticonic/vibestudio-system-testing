type Source = "session" | "context" | "ambient" | "binding" | "default";
type Position = "owned" | "other-context" | "other-server" | "other-workspace";
type SelectorStatus = "usable" | "unattached" | "foreign-workspace" | "foreign-context";
type Operation = "inspect" | "edit" | "eval";
type GatewayMatch = "verified" | "server-mismatch" | "workspace-mismatch";
type Selection = [source: Source, position: Position, status: SelectorStatus];

export type CliRouteWorld = {
  id: string;
  kind: "cli-route";
  workspace: "system";
  title: string;
  goal: string;
  sourceGroup: string;
  split: "train" | "test";
  selectors: Partial<Record<Source, Position>>;
  credential: "device" | "agent";
  operation: Operation;
  gateway: GatewayMatch;
  expected: Selection | null;
  requestedReturnRequired:true;
};

function plan(id: string, title: string, goal: string, operation: Operation, credential: CliRouteWorld["credential"],
  selectors: CliRouteWorld["selectors"], expected: Selection | null, held = false): CliRouteWorld {
  return {
    id: `cli-route-${id}`, title, goal, operation, credential, selectors, expected,requestedReturnRequired:true,
    kind: "cli-route", workspace: "system", gateway: "verified",
    sourceGroup: `vibestudio:open-cli-route:continuation:${id}`, split: held ? "test" : "train",
  };
}

function check(id: string, title: string, goal: string, gateway: Exclude<GatewayMatch, "verified">, held = false): CliRouteWorld {
  return {
    ...plan(id, title, goal, "inspect", "device", {}, null, held),
    gateway, sourceGroup: `vibestudio:open-cli-route:gateway:${id}`,
  };
}

export const openCliRouteRequiresUnits = ["skills/open-user-goal", "skills/remote-access"];

export const openCliRouteWorlds = [
  plan("event-poster-named-session", "Event poster proof", "Before I inspect Event poster proof, recover the saved CLI invocation's exact workspace target. The named session came from the print operator and the context flag points at our rehearsal. Which one actually determines the read?",
    "inspect", "device", { session: "owned", context: "other-context", default: "owned" }, ["session", "owned", "usable"]),
  plan("capstan-agent-local-edit", "Capstan briefing", "The linked worker picked up Capstan briefing and wants to amend its source. Check the active CLI context and tell us whether the amendment stays with the worker or needs the parent.",
    "edit", "agent", { ambient: "owned", binding: "other-context" }, ["ambient", "owned", "usable"]),
  plan("map-mirror-wrong-workspace", "Map index review", "I nearly ran the Map index review from a folder copied from another workspace. The saved personal default looks plausible. Check the reachable identity and say which saved location needs correction.",
    "inspect", "device", { binding: "other-workspace", default: "owned" }, ["binding", "other-workspace", "foreign-workspace"]),
  plan("staged-welcome-missing-scope", "Staged welcome cards", "We've opened the gateway for Staged welcome cards but lost the invocation's context during an interrupted setup. Establish exactly what is still missing before suggesting we run its inspection.",
    "inspect", "device", {}, ["default", "owned", "unattached"]),
  plan("counter-archive-stale-session", "Counter archive", "Counter archive is still attached to the shift lead's named CLI session. The folder has a working binding. Check whether the earlier session can be used with this gateway or needs repair before anyone reads it.",
    "inspect", "device", { session: "other-server", binding: "owned" }, ["session", "other-server", "foreign-workspace"]),
  plan("closing-registry-agent-read", "Closing registry", "Can the linked agent read Closing registry from its current CLI launch? Establish which current context it would use and whether the requested inspection needs a parent.",
    "inspect", "agent", { context: "owned", ambient: "other-context" }, ["context", "owned", "usable"]),
  plan("poster-variants-owned-device-edit", "Poster variants", "I'd like a quick scope check on the saved Poster variants CLI amendment. The current folder was deliberately bound for the revision, while the default session was kept for draft comparisons.",
    "edit", "device", { binding: "owned", default: "other-context" }, ["binding", "owned", "usable"]),
  plan("late-shift-agent-context-collision", "Late shift ledger", "For Late shift ledger, check whether the explicitly chosen CLI context remains within the linked worker's scope. A stale ambient value resolves somewhere else. Give the exact repair decision without trying the command.",
    "inspect", "agent", { context: "other-context", ambient: "owned" }, ["context", "other-context", "foreign-context"]),
  plan("seat-map-default-owner", "Seat map approval", "Recover the intended CLI execution scope for Seat map approval. It was saved as the default session before the operator closed the original shell, and the current invocation has no explicit flags.",
    "inspect", "device", { default: "owned" }, ["default", "owned", "usable"]),
  plan("steward-review-env-wins", "Steward review", "The Steward review was launched by an owned workspace window. Check whether its active context survives our folder's older binding before I inspect the evidence file.",
    "inspect", "device", { ambient: "owned", binding: "other-workspace" }, ["ambient", "owned", "usable"]),
  plan("parts-list-agent-eval", "Parts list report", "Work out how to resume the Parts list report's retained evaluation. Its named session is still reachable, and a linked agent is holding it. Say who can continue after checking the exact scope.",
    "eval", "agent", { session: "owned", ambient: "owned" }, ["session", "owned", "usable"]),
  plan("vessel-card-agent-default-retired", "Vessel card", "Check the saved Vessel card inspection after its original agent was replaced. The default session still names the former context. Explain the scope problem before anyone tries to reuse that invocation.",
    "inspect", "agent", { default: "other-context" }, ["default", "other-context", "foreign-context"]),
  check("route-appendix-old-workspace", "Route appendix", "The Route appendix launch opened a gateway, but the workspace name is shared by the archived dashboard. Check the actual workspace identity and decide which route needs refreshing before continuing the old command.", "workspace-mismatch"),
  check("marquee-review-reassigned-server", "Marquee review", "The help desk moved Marquee review to a new host. Compare the currently authenticated server with the saved assignment and say what needs confirmation before relying on its old CLI session.",
    "server-mismatch"),
  plan("public-archive-local-eval", "Archive index rehearsal", "Check whether the archive index rehearsal's saved CLI evaluation can resume under the workspace device identity. The shell still carries a context from a retired comparison.",
    "eval", "device", { context: "owned", ambient: "other-context", default: "other-workspace" }, ["context", "owned", "usable"]),
  plan("training-window-ambient-foreign", "Training window", "Before we inspect Training window, work out why the linked agent's inherited launch context differs from its own role. The folder entry has been corrected. Check which coordinate is effective.",
    "inspect", "agent", { ambient: "other-context", binding: "owned" }, ["ambient", "other-context", "foreign-context"]),
  plan("river-observation-current-default", "River observation", "The River observation review kept only a default CLI invocation from last week. Confirm whether its server and workspace coordinates still belong to this gateway.",
    "inspect", "device", { default: "other-workspace" }, ["default", "other-workspace", "foreign-workspace"]),
  plan("freight-inventory-role-aware", "Freight inventory", "Our Freight inventory clerk needs to know if the linked worker can amend the notes from the recorded folder binding. Check the command's exact context and return the appropriate handoff.",
    "edit", "agent", { binding: "owned", default: "other-workspace" }, ["binding", "owned", "usable"]),
  plan("cabinet-closeout-pinned-other-context", "Cabinet closeout", "The Cabinet closeout invocation names the audit context on purpose. Check whether the device-led inspection keeps that target when the folder still belongs to the preparation context.",
    "inspect", "device", { context: "other-context", binding: "owned" }, ["context", "other-context", "usable"], true),
  plan("museum-label-session-workspace-move", "Museum label", "Find out whether Museum label's named session may be reused after the receiving workspace changed. A matching context flag was added later. Tell me which active binding needs repair.",
    "edit", "device", { session: "other-workspace", context: "owned" }, ["session", "other-workspace", "foreign-workspace"], true),
  plan("balance-sheet-wait-for-parent", "Balance sheet handover", "I want the Balance sheet handover to say whether its linked recorder can perform the saved evaluation. Its inherited context was approved locally. Verify who should take it from here.",
    "eval", "agent", { ambient: "owned", default: "owned" }, ["ambient", "owned", "usable"], true),
  check("archive-corner-routing-repair", "Archive corner", "The Archive corner CLI launch came up after a workspace relocation. Check the gateway's actual workspace before carrying forward any cursor from the saved route.", "workspace-mismatch", true),
  check("crew-coordinator-origin-hold", "Crew coordinator", "Resolve the Crew coordinator launch's original server before favoring its similar-looking workspace label. I need the safe local disposition for the saved review.", "server-mismatch", true),
  plan("ownerless-bindings-agent", "Ownerless notes", "The linked agent wants to inspect Ownerless notes after its saved workspace invocation was cleared. Check what the CLI can actually select and tell me what must be restored.",
    "inspect", "agent", {}, ["default", "owned", "unattached"], true),
] satisfies CliRouteWorld[];
