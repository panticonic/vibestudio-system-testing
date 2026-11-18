export const localModelSkill = "skills/local-model-task";
const executor = "local:lfm3-1.7b";
const fallback = "local:lfm2.5-2.6b";
const preferred = "local:qwen3.8-27b";
const compact = "local:qwen3.5-4b";
const midrange = "local:qwen3.5-9b";
const reasoning = "local:gpt-oss-20b";
const retired = "local:retired-workspace-model";

function comparison(
  id: string,
  goal: string,
  [modelRef, ...alternatives]: [string, string, ...string[]],
  flags: { needsTools?: boolean; minimumContext?: number; fork?: boolean } = {},
) {
  return {
    id,
    request: {
      goal,
      operation: "compare" as const,
      modelRef,
      alternatives,
      mayInstall: false,
      needsTools: flags.needsTools ?? false,
      minimumContext: flags.minimumContext ?? 0,
      requiresPriorConversation: flags.fork ?? false,
    },
  };
}

export const localModelComparisonWorlds = [
  comparison(
    "offline-note",
    "Check the assigned compact models for a fresh offline summarization of a short note. Tell me which ones are available locally before choosing.",
    [executor, fallback],
  ),
  comparison(
    "continue-code-review",
    "Resume the current code review on an assigned local model with tools and at least 32000 context tokens. Retain the existing review conversation.",
    [preferred, compact, fallback],
    { needsTools: true, minimumContext: 32_000, fork: true },
  ),
  comparison(
    "fresh-repository-inventory",
    "Choose a fresh local agent for enumerating a small repository. It will need file tools. Keep the current conversation out of the handoff.",
    [fallback, executor],
    { needsTools: true, minimumContext: 8_000 },
  ),
  comparison(
    "readme-legacy-handoff",
    "An old handoff names a retired model. Check that exact ref first and assess the supported alternatives for resuming the README review. Record why each one is or is not eligible.",
    [retired, fallback, executor],
    { needsTools: true, minimumContext: 5_000, fork: true },
  ),
  comparison(
    "unlisted-offers",
    "An old runbook recommends an unavailable lab checkpoint plus a former in-house model. Verify both references before promising a local follow-up.",
    [retired, "local:legacy-lab-checkpoint"],
  ),
  comparison(
    "desktop-reasoning",
    "Prepare a fresh offline design review. Try the specified reasoning model first, then the 9B model. Require at least 48000 context tokens to preserve the design note and questions.",
    [reasoning, midrange],
    { minimumContext: 48_000 },
  ),
  comparison(
    "preferred-offer-and-fallback",
    "Check whether the preferred coding model is actually usable on this host, then check the compact fallback. The task uses tools and needs 96000 context tokens.",
    [preferred, fallback],
    { needsTools: true, minimumContext: 96_000 },
  ),
  comparison(
    "long-transcript-followup",
    "Continue this transcript review using a model with at least 200000 tokens of context. Check the local long-context alternatives in the assigned order.",
    [preferred, midrange, executor],
    { minimumContext: 200_000, fork: true },
  ),
  comparison(
    "model-budget-limit",
    "Check whether any of these assigned models can preserve a 400000 token corpus and run repository tools. Return the real inventory observations even if all are unsuitable.",
    [preferred, reasoning, compact],
    { needsTools: true, minimumContext: 400_000 },
  ),
  comparison(
    "small-before-large",
    "For a standalone offline categorization task, give the smaller installed choice priority. Preserve the separate eligibility result for the larger alternative.",
    [executor, preferred],
    { minimumContext: 4_000 },
  ),
  comparison(
    "shared-debugging-continuity",
    "Continue the current debugging session with tool access. Visit all three assigned model refs in order and retain the conversation only with an eligible handoff.",
    [compact, midrange, fallback],
    { needsTools: true, minimumContext: 64_000, fork: true },
  ),
  comparison(
    "no-fallback-substitution",
    "Audit these two exact model refs for a bounded offline exercise. The first comes from an old configuration and the second from a current menu. Treat an absent catalog entry separately from a visible model waiting on setup.",
    [retired, reasoning],
    { minimumContext: 12_000 },
  ),
];
