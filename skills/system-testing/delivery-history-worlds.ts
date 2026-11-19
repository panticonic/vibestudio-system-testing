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
] as const;
