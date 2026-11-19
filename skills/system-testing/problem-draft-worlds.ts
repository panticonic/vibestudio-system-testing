export const managedProblemDraftWorlds = [
  {
    id: "save-wrong-sort",
    mode: "new",
    goal: "Save a report about Vibestudio's list result, with a focused verification step. Keep it local and collect no diagnostics.",
    account: {
      goal: "Sort alpha, gamma, beta alphabetically.",
      observed: "Vibestudio returned gamma, beta, alpha.",
      expected: "The expected order is alpha, beta, gamma.",
      operation: null,
      attempts: "",
      reproduced: false,
    },
    defect: "platform",
  },
  {
    id: "continue-workspace-error",
    mode: "existing",
    goal: "Add a verification step to my existing local report about the preview worker. Preserve the earlier symptom and don't send the report.",
    account: {
      goal: "Render the sample card from my workspace preview worker.",
      observed:
        "The workspace code threw ReferenceError: selectedCard is not defined.",
      expected: "The preview shows the assigned card.",
      operation: null,
      attempts: "Reopening the preview gave the same error.",
      reproduced: false,
    },
    defect: "user-code",
  },
  {
    id: "hold-stale-draft",
    mode: "stale",
    goal: "Continue the assigned draft only at the revision I reviewed. If the narrative changed, preserve the newer report and explain that the edit is held.",
    account: {
      goal: "Dismiss the setup banner after finishing onboarding.",
      observed: "Vibestudio kept the setup banner open after I clicked Done.",
      expected: "The banner closes after setup finishes.",
      operation: null,
      attempts: "",
      reproduced: false,
    },
    defect: "platform",
  },
] as const;
