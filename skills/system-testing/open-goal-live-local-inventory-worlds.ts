const compact = ["local:lfm3-1.7b", "Compact executor"] as const;
const fallback = ["local:lfm2.5-2.6b", "Fallback"] as const;
const coding = ["local:qwen3.8-27b", "Coding model"] as const;
const small = ["local:qwen3.5-4b", "Small reasoning model"] as const;
const middle = ["local:qwen3.5-9b", "Middle model"] as const;
const reasoning = ["local:gpt-oss-20b", "Reasoning model"] as const;
const retired = ["local:retired-workspace-model", "Archived ref"] as const;
const absent = ["local:legacy-lab-checkpoint", "Lab checkpoint"] as const;
type Candidate = readonly [ref: string, label: string];

export type LocalInventoryWorld = {
  id: string; kind: "live-local-inventory"; workspace: "system"; title: string; goal: string;
  split: "train" | "test"; sourceGroup: string;
  preferences: { ref: string; label: string }[];
  request: { goal: string; operation: "compare"; modelRef: string; alternatives: string[];
    mayInstall: false; needsTools: boolean; minimumContext: number; requiresPriorConversation: boolean };
};

function workload(id: string, title: string, goal: string, candidates: [Candidate, Candidate, ...Candidate[]],
  { context = 0, tools = false, resume = false, held = false }:
  { context?: number; tools?: boolean; resume?: boolean; held?: boolean } = {}): LocalInventoryWorld {
  return {
    id: `live-local-inventory-${id}`, kind: "live-local-inventory", workspace: "system", title, goal,
    split: held ? "test" : "train", sourceGroup: `vibestudio:live-local-inventory:${id}`,
    preferences: candidates.map(([ref, label]) => ({ ref, label })),
    request: { goal, operation: "compare", modelRef: candidates[0][0],
      alternatives: candidates.slice(1).map(([ref]) => ref), mayInstall: false,
      needsTools: tools, minimumContext: context, requiresPriorConversation: resume },
  };
}

export const openLiveLocalInventoryRequiresUnits = [
  "skills/open-user-goal", "skills/local-model-task", "skills/local-model-task-bindings", "extensions/local-models",
];

export const openLiveLocalInventoryWorlds = [
  workload("inspection-annotation-continuity", "Inspection annotations", "Find an eligible local handoff for Inspection annotations. Keep the original conversation and enough room for its 24,000-token transcript, and retain file tool access for the second pass.",
    [coding, small, compact], { context: 24_000, tools: true, resume: true }),
  workload("textile-notes-standalone", "Textile notes", "Choose from our saved local shortlist for a standalone Textile notes comparison. It just needs the written extracts in a fresh conversation. Flag candidates that aren't installed or ready.",
    [compact, fallback]),
  workload("sawyer-inventory-work-folder", "Sawyer inventory", "Which of the local Sawyer inventory choices can look through the repository and fit the 12,000-token inventory brief? Start a fresh conversation if one is eligible.",
    [fallback, middle, coding], { context: 12_000, tools: true }),
  workload("document-return-prior-decision", "Document return", "The Document return review depends on earlier conversation decisions and 48,000 tokens of evidence. Check the exact local shortlist before recommending how to continue it.",
    [middle, compact, reasoning], { context: 48_000, resume: true }),
  workload("training-lab-stale-pin", "Training lab", "The Training lab shortlist starts with an old checkpoint. Tell the next owner which entries still exist, and whether an option can handle its 16,000-token laboratory brief with tools from a new conversation.",
    [retired, small, coding], { context: 16_000, tools: true }),
  workload("calendar-handoff-oversize", "Calendar handoff", "Check Calendar handoff against its saved local options. The existing review needs its prior conversation and the whole 250,000-token context. Give me a grounded hold if the hardware catalog cannot support it.",
    [reasoning, middle, coding], { context: 250_000, resume: true }),
  workload("address-list-reconciliation", "Address list", "Assess the current Address list options for a new local reconciliation. It requires reading the actual source files, but the records fit in a 9,000-token context.",
    [small, compact, coding], { context: 9_000, tools: true }),
  workload("training-manual-locked-choices", "Training manual", "Audit the Training manual's two stored local refs before promising a redo. The next reader needs 20,000 tokens from the existing conversation. Keep absent entries distinct from waiting ones.",
    [absent, retired], { context: 20_000, resume: true }),
  workload("workshop-feedback-noref-fork", "Workshop feedback", "Review the local choices before I copy the Workshop feedback summaries into a fresh conversation. Keep 32,000 tokens available for the material, with no additional tool requirement.",
    [small, reasoning, fallback], { context: 32_000 }),
  workload("library-delta-review", "Library delta", "Continue Library delta locally with the same conversation and read tools for the repository. The review needs up to 64,000 tokens including the original decision record.",
    [coding, reasoning, middle], { context: 64_000, tools: true, resume: true }),
  workload("lobby-inbox-new-filter", "Lobby inbox", "Check the local catalog before handing Lobby inbox to a new worker for a short, text-only classification exercise. Explain why any candidate in the preferred order can't take it.",
    [fallback, compact, small]),
  workload("data-room-export-audit", "Data room export", "Before carrying over Data room export, find a tool-capable local option with at least 72,000 tokens of room. The receiving worker must keep the existing audit conversation.",
    [middle, coding, fallback], { context: 72_000, tools: true, resume: true }),
  workload("signage-instructions-no-install", "Signage instructions", "Check our reserved local order for Signage instructions. The new conversation needs 8,000 tokens. Report exact current availability and leave installation decisions to the owner.",
    [small, compact], { context: 8_000 }),
  workload("yard-check-older-menu", "Yard check", "Can a currently usable local model handle Yard check with read tools and 30,000 tokens of context? It starts fresh. Use the saved shortlist even though its first choice came from an older menu.",
    [retired, fallback, middle], { context: 30_000, tools: true }),
  workload("atlas-copy-only", "Atlas copy", "Assess the Atlas copy's reserved choices for a text-only interpretation retaining the previous conversation and up to 18,000 tokens of notes. Tell me why any shortlisted item is unavailable.",
    [reasoning, compact, small], { context: 18_000, resume: true }),
  workload("checkout-technical-reply", "Checkout reply", "Find the local handoff for Checkout reply after the reviewer deposited the exact candidate list. It needs the existing context and a file tool to fetch a related source, with a 16,000-token budget.",
    [fallback, coding, compact], { context: 16_000, tools: true, resume: true }),
  workload("draft-language-review", "Draft language", "Decide whether the saved local choices can start Draft language separately from our current discussion. This is text only, but the quoted material needs 52,000 context tokens.",
    [middle, small, reasoning], { context: 52_000 }),
  workload("silent-recheck-unlisted-menu", "Silent recheck", "Inspect the shortlist for the silent recheck without starting any model. This is a new file-based verification and requires tools. State what can be inferred when the archived first choice is missing.",
    [absent, coding, fallback], { tools: true }),
  workload("gatehouse-reconcile-retained", "Gatehouse reconcile", "For Gatehouse reconcile, see whether a local shortlist entry can carry the prior review and reach the exact file tools it used. The restored conversation wants 96,000 tokens.",
    [reasoning, coding, compact], { context: 96_000, tools: true, resume: true, held: true }),
  workload("collection-index-fresh-restart", "Collection index", "I need a fresh Collection index pass separated from the old thread. Check whether the local shortlist has a usable text-only candidate that can see the 14,000-token index and agenda together.",
    [compact, reasoning, middle], { context: 14_000, held: true }),
  workload("no-live-first-slot", "Desk soundings", "Audit the Desk soundings list after its first item was retired. Check whether the rest can continue the same text-only conversation with 60,000 tokens, without promising a different local model.",
    [retired, small, coding], { context: 60_000, resume: true, held: true }),
  workload("registry-twin-pins", "Registry twins", "Check the two retained Registry twins refs before assigning an entirely new local read. It needs tools and 8,000 tokens. If either reference is missing, name that exact blocker.",
    [absent, retired], { context: 8_000, tools: true, held: true }),
  workload("coordinator-large-carry", "Coordinator carry", "The Coordinator carry is text only but needs the existing discussion and a 124,000-token evidence set. Evaluate the approved local options in their saved preference order before recommending a handoff.",
    [coding, fallback, middle], { context: 124_000, resume: true, held: true }),
  workload("map-fresh-without-old-context", "Map comparison", "Prepare the Map comparison as a fresh local read with source tools, even if a candidate was featured in our older transcript. Its busiest case needs 40,000 context tokens.",
    [small, coding, reasoning], { context: 40_000, tools: true, held: true }),
] satisfies LocalInventoryWorld[];
