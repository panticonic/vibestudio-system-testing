export const managedTerminalEvidenceWorlds = [
  {
    id: "notice-on-stderr-with-successful-exit",
    goal: "Review the completed label check. A notice appeared on stderr. Decide what the exact invocation and exit receipt establish.",
    mode: "notice",
    status: "ready",
    code: "execution-succeeded",
  },
  {
    id: "zero-exit-with-incomplete-output",
    goal: "Review the zero-exit sequence check before handing off its output. Determine whether the evidence covers the complete sequence.",
    mode: "truncated",
    status: "attention",
    code: "success-output-truncated",
  },
  {
    id: "receipt-from-neighboring-operation",
    goal: "The handoff includes a result from the same workspace, but its operation may differ. Check receipt ownership before interpreting its exit status.",
    mode: "foreign",
    status: "blocked",
    code: "result-target-mismatch",
  },
] as const;
