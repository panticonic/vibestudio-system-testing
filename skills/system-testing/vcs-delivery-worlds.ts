export const deliveryRepository = "skills/vibestudio-vcs";

export const managedVcsDeliveryWorlds = [
  {
    id: "draft-retry-contract",
    goal: "Review the draft retry contract. Explain how exhausting retries changes request behavior and propose a focused verification before the next semantic VCS step.",
    seedPath: "delivery-fixture-retry.md",
    path: "delivery-fixture-retry.md",
    text: "A request retries once after a transient failure. On a second failure it returns a RetryExhausted result and performs no further retry.\n",
    commit: false,
    next: "verify-then-commit",
    terms: ["retr", "fail"],
  },
  {
    id: "committed-cleanup-contract",
    goal: "Review the committed cleanup contract for delivery. Identify what happens to a preview after cancellation and what to check before publication.",
    seedPath: "delivery-fixture-cleanup.md",
    path: "delivery-fixture-cleanup.md",
    text: "When a user cancels a preview, the owned temporary panel closes and outstanding callbacks are cancelled.\n",
    commit: true,
    next: "verify-then-publish",
    terms: ["cancel", "panel"],
  },
  {
    id: "unchanged-file-with-dirty-context",
    goal: "Review the assigned contexts-and-state reference for delivery. Distinguish whether this file changed from whether the entire context has pending work.",
    seedPath: "delivery-fixture-unrelated.md",
    path: "references/contexts-and-state.md",
    text: "Unrelated draft operations note.\n",
    commit: false,
    next: "verify-then-commit",
    terms: [],
  },
] as const;
