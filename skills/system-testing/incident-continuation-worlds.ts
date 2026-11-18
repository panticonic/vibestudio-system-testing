export const incidentContinuationWorlds = [
  {
    id: "search-refresh-review",
    log: "cursor-excludes-failure",
    models: "continue-code-review",
    goal: "Review the search refresh incident before choosing a local model to continue the code review. Distinguish recovery of search from readiness of a review model.",
  },
  {
    id: "importer-offline-inventory",
    log: "heartbeat-is-not-recovery",
    models: "fresh-repository-inventory",
    goal: "Check whether the importer recovered before recommending an offline repository inventory. A regular heartbeat is not a disposition for the failed operation.",
  },
  {
    id: "stale-bookmark-readme",
    log: "stale-boot-cursor",
    models: "readme-legacy-handoff",
    goal: "Refresh the evidence for an old build bookmark before resuming the README review. Assess the retired model reference and compare only the offered alternatives.",
  },
  {
    id: "failed-preview-design-review",
    log: "no-new-entries",
    models: "desktop-reasoning",
    goal: "Check for new preview errors after the recovery and verify the earlier recovery. Then assess the assigned offline design-review models, preserving the full context requirement.",
  },
  {
    id: "compaction-continuity",
    log: "recovery-precedes-failure",
    models: "shared-debugging-continuity",
    goal: "Reconstruct the compaction timeline before proposing a local continuation of this debugging session. An older success cannot clear a newer failure.",
  },
  {
    id: "indexing-long-transcript",
    log: "indexing-recovery",
    models: "long-transcript-followup",
    goal: "Verify the indexing recovery and see whether the log has newer entries. Then check which assigned local model can continue the long transcript review with its existing history.",
  },
  {
    id: "mirror-offline-note",
    log: "recovery-across-progress",
    models: "offline-note",
    goal: "Establish whether the mirror recovered across the intervening heartbeat. Only then check the two compact models for an offline summary of the incident.",
  },
  {
    id: "invoice-incident-budget",
    log: "wrong-subsystem",
    models: "model-budget-limit",
    goal: "Check both subsystem windows before preparing the local invoice-incident investigation. Report whether an assigned model can fit the complete corpus and use repository tools.",
  },
  {
    id: "thumbnail-local-fallback",
    log: "different-operation-recovered",
    models: "preferred-offer-and-fallback",
    goal: "Determine whether the export recovery clears the thumbnail rebuild failure. Then check the preferred and fallback models for a separate tool-assisted thumbnail review.",
  },
  {
    id: "snapshot-handoff-limits",
    log: "routine-before-failure",
    models: "no-fallback-substitution",
    goal: "Read the snapshot verification history before checking the runbook's exact local model refs. Keep the missing read separate from an absent or unavailable model.",
  },
];
