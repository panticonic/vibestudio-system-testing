export const retainedTriageWorlds = [
  {
    id: "validator-threw",
    testName: "retained-triage-source-validator",
    goal: "Read the retained failure for the assigned run. Determine whether the snapshot check failed in the validator or during orchestration and quote the evidence.",
    detail: "The snapshot validator could not compare the assigned digest.",
    phase: "validation",
    expectedClass: "validator",
  },
  {
    id: "orchestration-stopped",
    testName: "retained-triage-source-harness",
    goal: "The workspace inspection test stopped while preparing its fixture. Use its retained diagnostic to identify the failing layer and quote the original evidence.",
    detail: "The fixture could not mount the assigned inspection directory.",
    phase: "orchestration",
    expectedClass: "harness",
  },
] as const;
