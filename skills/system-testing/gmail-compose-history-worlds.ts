export const gmailComposeHistoryWorlds = [
  {
    id: "confirm-owned-saved-draft",
    goal: "Review the compose history, confirm whether it shows an accepted draft identity, and cite the decisive card readback.",
    initial: { status: "review", to: "recipient@example.test" },
    updates: [{ status: "saving" }, { status: "saved", draftId: "assigned-draft" }],
    action: "draft-recorded",
  },
  {
    id: "reconcile-uncertain-delivery",
    goal: "Review the interrupted send and determine the next step without submitting another delivery.",
    initial: { status: "review", to: "recipient@example.test", rfcMessageId: "<synthetic@vibestudio.local>" },
    updates: [{ status: "sending" }, { status: "delivery-unknown" }],
    action: "reconcile-delivery",
  },
  {
    id: "hold-draft-identity-change",
    goal: "Check whether the reopened card retained its accepted draft ID. Hold if the card history conflicts.",
    initial: { status: "review", to: "recipient@example.test" },
    updates: [{ status: "saved", draftId: "first-draft" }, { status: "saved", draftId: "different-draft" }],
    action: "hold",
  },
] as const;
