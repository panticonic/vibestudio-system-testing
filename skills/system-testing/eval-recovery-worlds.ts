type World = {
  id: string;
  goal: string;
  stored: boolean;
  fails: boolean;
  allowReadback: boolean;
  journalCase?: "conflicting" | "duplicate" | "truncated-before-store" | "truncated-after-store";
  next: string;
};

export const managedEvalRecoveryWorlds: readonly World[] = [
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
  {
    id: "conflicting-store-receipts",
    goal: "The cell attempted the assigned store and also wrote different text. Reconcile the native journal with the exact assigned digest before choosing a recovery step.",
    stored: true,
    fails: true,
    allowReadback: true,
    journalCase: "conflicting",
    next: "inspect-integrity",
  },
  {
    id: "duplicate-store-receipts",
    goal: "The cell retried the same store and returned. Check whether the native journal supplies a unique receipt for the assigned operation.",
    stored: true,
    fails: false,
    allowReadback: true,
    journalCase: "duplicate",
    next: "inspect-integrity",
  },
  {
    id: "truncated-with-visible-store",
    goal: "The cell failed and its journal hit the evidence limit. Decide whether the retained store receipt is enough to confirm the assigned operation.",
    stored: true,
    fails: true,
    allowReadback: true,
    journalCase: "truncated-after-store",
    next: "recover-journal",
  },
  {
    id: "truncated-before-visible-store",
    goal: "The cell returned after a long run but its journal ended before the final work. Determine whether the absence of a store receipt establishes that the assigned effect did not happen.",
    stored: true,
    fails: false,
    allowReadback: true,
    journalCase: "truncated-before-store",
    next: "recover-journal",
  },
] as const;
