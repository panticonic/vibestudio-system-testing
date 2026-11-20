export const deliveryHistoryWorlds = [
  {
    id: "received-workshop-note",
    goal: "Confirm the retained workshop note matches a reconnected client's conversation view.",
    text: "Workroom B opens thirty minutes before the workshop.",
    mode: "received",
  },
  {
    id: "retried-shift-note",
    goal: "Check whether reconnecting and retrying the shift note left a single durable delivery.",
    text: "The early shift should inspect the east entrance first.",
    mode: "retry",
  },
  {
    id: "identical-note-on-other-channel",
    goal: "Audit the library closure receipt against the handoff channel, which has a note with the same wording.",
    text: "The reading room closes at five on Thursday.",
    mode: "foreign",
  },
  {
    id: "reconcile-sender-from-retained-envelope",
    goal: "Review the handoff receipt for the facilities note against the durable channel row. Establish whether the attributed speaker and the original sender agree.",
    text: "Put the visitor sign-in sheet in the south lobby.",
    mode: "sender-mismatch",
  },
  {
    id: "locate-message-from-reconnect-receipt",
    goal: "The site coordinator asks whether the message referenced by this receipt survived reconnect. Verify the exact claimed message against the channel and reconstructed view.",
    text: "The storage cage will be unlocked after the delivery arrives.",
    mode: "missing",
  },
] as const;

export const chatDeliveryWorlds = [
  {
    id: "reopened-chat-after-retry",
    goal: "Audit the handoff reminder after a sender retry. Confirm that the accepted message appears once with the same text in the assigned reopened chat.",
    text: "Leave the signed inventory at the front desk.",
    mode: "retry",
  },
  {
    id: "wrong-chat-same-reminder",
    goal: "Check whether this reminder receipt belongs to the assigned chat, even though the other team sent exactly the same reminder.",
    text: "Bring the replacement key to the Tuesday handoff.",
    mode: "foreign",
  },
] as const;

export const conversationHandoffWorlds = [
  {
    id: "reopen-original-chat-after-context-switch",
    goal: "The accepted facilities reminder is being handed off after the operator changed chats. Decide which thread to reopen without resending the reminder.",
    text: "Leave the signed equipment sheet at reception.",
    mode: "wrong-panel",
    next: "reopen-assigned-chat",
  },
  {
    id: "trace-absent-receipt-before-opening-chat",
    goal: "The channel shows the wording from the shift note, but the original receipt may refer to another message. Decide what the next operator should investigate before relying on the open chat.",
    text: "Keep the west door available for the delivery.",
    mode: "missing",
    next: "trace-original-receipt",
  },
] as const;

export const isConversationHandoffCase = (id: string) =>
  conversationHandoffWorlds.some((world) => world.id === id);

export const isChatDeliveryCase = (id: string) =>
  chatDeliveryWorlds.some((world) => world.id === id) || isConversationHandoffCase(id);

export const deliveryHistoryOperation = (id: string) =>
  isConversationHandoffCase(id) ? "reviewConversation" :
    isChatDeliveryCase(id) ? "reviewChatDelivery" : "reviewDeliveryHistory";

export const deliveryOriginByMode = {
  received: "matched",
  retry: "matched",
  foreign: "foreign-channel",
  "sender-mismatch": "receipt-mismatch",
  missing: "missing-message",
  "wrong-panel": "matched",
} as const;
