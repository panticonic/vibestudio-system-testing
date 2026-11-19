export const managedEvalRecoveryWorlds = [
  {
    id: "completed-before-failure",
    goal: "The eval threw after the assigned text-store operation. Verify whether the exact effect is present before deciding how to continue.",
    stored: true,
    fails: true,
    allowReadback: true,
    next: "continue-with-effect",
  },
  {
    id: "reported-but-not-read-back",
    goal: "Review whether the completed eval recorded the assigned text store. The follow-up is limited to the native journal. Explain what still needs independent confirmation.",
    stored: true,
    fails: false,
    allowReadback: false,
    next: "confirm-effect",
  },
  {
    id: "success-value-without-store",
    goal: "The eval returned a success-looking value for the assigned store. Check whether the native journal actually supports it and decide what to inspect next.",
    stored: false,
    fails: false,
    allowReadback: false,
    next: "inspect-original-attempt",
  },
] as const;
