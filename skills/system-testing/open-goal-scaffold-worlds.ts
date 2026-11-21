export type ScaffoldKind =
  | "react"
  | "react-site"
  | "svelte"
  | "svelte-site"
  | "stateless"
  | "agentic"
  | "package"
  | "skill"
  | "content"
  | "web-client"
  | "terminal-client"
  | "native-client";
type Disposition =
  | "prepare"
  | "advise-only"
  | "hold-authority"
  | "hold-unavailable"
  | "hold-occupied";
export type ScaffoldWorld = ReturnType<typeof brief>;
function brief(
  key: string,
  split: "train" | "test",
  workspace: "system" | "examples",
  label: string,
  goal: string,
  kinds: ScaffoldKind[],
  disposition: Disposition = "prepare",
  occupied?: string,
) {
  return {
    id: "scaffold-review-" + key,
    sourceGroup: "vibestudio:scaffold-review:" + key,
    kind: "scaffoldReview",
    workspace,
    split,
    label,
    goal,
    kinds,
    disposition,
    occupied,
    canDraft: disposition !== "hold-authority" && disposition !== "advise-only",
  } as const;
}
export const openScaffoldWorlds = [
  brief(
    "approval-dashboard-local",
    "train",
    "system",
    "Approval Dashboard",
    "Give Approval Dashboard a new local React panel starter. It needs no service calls or portable website. Stop once the draft exists.",
    ["react"],
  ),
  brief(
    "dispatch-two-surfaces",
    "train",
    "system",
    "Dispatch Screen",
    "Prepare a React Dispatch Screen that can be mounted as a workspace panel and has a separate portable browser entry. Leave both entry points in a draft only.",
    ["react-site"],
  ),
  brief(
    "retained-svelte-tour",
    "train",
    "examples",
    "Living Tour Notes",
    "The Living Tour Notes maintainer uses the installed Examples Svelte toolkit. Prepare a native panel starter that inherits that framework, then confirm its draft source.",
    ["svelte"],
  ),
  brief(
    "svelte-portable-exhibit",
    "train",
    "examples",
    "Exhibit Guide",
    "Prepare the installed Svelte starter for Exhibit Guide. The team also needs a portable site entry in the same draft so they can later test its view without launching a workspace.",
    ["svelte-site"],
  ),
  brief(
    "svelte-required-system",
    "train",
    "system",
    "Svelte Lab Display",
    "Svelte Lab Display must start on the installed Svelte stack. Check availability first and pause if this System workspace has no such starter.",
    ["svelte"],
    "hold-unavailable",
  ),
  brief(
    "health-request-handler",
    "train",
    "system",
    "Health Echo",
    "Leave a safe starter for Health Echo, a worker that should only return one health response per request. It must not need durable state or any production activity.",
    ["stateless"],
  ),
  brief(
    "persistent-caretaker",
    "train",
    "examples",
    "Caretaker Inbox",
    "Prepare a worker for Caretaker Inbox with an agent that can resume its own conversation and a native test suite for its worker behavior. Leave it ready for later review without starting the agent.",
    ["agentic"],
  ),
  brief(
    "shared-formatting-library",
    "train",
    "system",
    "Shared Formatter",
    "Create an editable starter for Shared Formatter that other units can import. It should be a library with a public entry and no executable workspace startup.",
    ["package"],
  ),
  brief(
    "reusable-briefing-instructions",
    "train",
    "system",
    "Briefing Playbook",
    "Prepare the starting files for Briefing Playbook as instructions other agents can invoke. Verify the human-readable skill outline and its own package remain in the draft.",
    ["skill"],
  ),
  brief(
    "content-only-room",
    "train",
    "examples",
    "Field Notes Folder",
    "Create a plain workspace project for Field Notes Folder so someone can organize documents. Keep the starter content-only, with no runtime package or executable entry.",
    ["content"],
  ),
  brief(
    "isolated-browser-client",
    "train",
    "system",
    "Browser Kiosk Starter",
    "I need Browser Kiosk Starter as a thin workspace browser client, with an HTML boot surface and the canonical web host ABI. Do not register it globally.",
    ["web-client"],
  ),
  brief(
    "keyboard-first-console",
    "train",
    "system",
    "Shift Console",
    "Draft Shift Console as a workspace client for the terminal host. It needs a native terminal entry and should remain unregistered until we review it.",
    ["terminal-client"],
  ),
  brief(
    "mobile-workspace-starter",
    "train",
    "system",
    "Pocket Status",
    "Prepare Pocket Status as a React Native workspace client with the installed mobile host ABI. Keep it a draft and report any authority requested by that default host contract.",
    ["native-client"],
  ),
  brief(
    "library-plus-stateless-endpoint",
    "train",
    "system",
    "Formatter and Endpoint",
    "Prepare the Formatter and Endpoint starters together. I want the reusable library first and a thin request-only worker second. Keep both in the same review draft.",
    ["package", "stateless"],
  ),
  brief(
    "operator-playbook-and-notes",
    "train",
    "examples",
    "Onboarding Pack",
    "Leave an Onboarding Pack with one reusable agent skill first and one plain workspace document project second. I only need verified starter files.",
    ["skill", "content"],
  ),
  brief(
    "advice-only-runtime",
    "train",
    "system",
    "Box Office Operator",
    "For Box Office Operator help choose a durable agent worker that could retain its conversation and have a native test. I want the recommendation in chat and no new files.",
    ["agentic"],
    "advise-only",
  ),
  brief(
    "owner-approval-recheck",
    "train",
    "system",
    "Inventory Charts",
    "Please prepare a minimal React panel for Inventory Charts if the owner has granted the native draft. Hold the preparation if we still have read access only.",
    ["react"],
    "hold-authority",
  ),
  brief(
    "keep-existing-welcome",
    "train",
    "examples",
    "Welcome Starter Revision",
    "Check whether the Welcome Starter Revision can create a new React panel at the assigned welcome path. Keep the existing welcome panel if that path is already owned.",
    ["react"],
    "hold-occupied",
    "welcome",
  ),
  brief(
    "held-svelte-and-library",
    "test",
    "examples",
    "Reader Pair Starter",
    "Prepare Reader Pair Starter as a Svelte workspace panel and then its separate shared library. Keep the two outputs in one draft, and read their actual files back.",
    ["svelte", "package"],
  ),
  brief(
    "held-site-entry-only",
    "test",
    "system",
    "Portable Review Board",
    "The Portable Review Board needs a portable browser entry as well as the ordinary React workspace entry. Make that distinction visible from the retained starter files without launching a website.",
    ["react-site"],
  ),
  brief(
    "held-authority-missing-worker",
    "test",
    "system",
    "Dispatch Resume Lane",
    "Set up a durable worker starter for Dispatch Resume Lane only if the retained owner scope permits authoring. We need persistent agent state later, but no writes without approval.",
    ["agentic"],
    "hold-authority",
  ),
  brief(
    "held-plain-guidance",
    "test",
    "examples",
    "Archive Layout",
    "Tell me which native starter would give Archive Layout a plain home for source documents. Don't make the folder or start any executable process.",
    ["content"],
    "advise-only",
  ),
  brief(
    "held-terminal-role-collision",
    "test",
    "system",
    "Existing Chat Terminal Trial",
    "We are considering a standard terminal client at the assigned chat-terminal path. Stop if the active installed client already owns it.",
    ["terminal-client"],
    "hold-occupied",
    "chat-terminal",
  ),
  brief(
    "held-optional-svelte-portal",
    "test",
    "system",
    "Schedule Portal",
    "Schedule Portal needs both the Svelte view and a portable entry. Please only use the installed Svelte starter and keep our workspace unchanged if it is absent.",
    ["svelte-site"],
    "hold-unavailable",
  ),
] as const;
