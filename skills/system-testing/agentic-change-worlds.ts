export const managedAgenticChangeWorlds = [
  {
    id: "chat-boot-capability",
    goal: "Plan a change confined to the chat panel's product composition. Change when the panel exposes its existing browser capabilities at boot, preserving the existing conversation UI package, channel service and event formats. Explain what to build and how to check the changed boot in this context.",
    owner: "panels/chat",
    consumers: [],
    rebuild: ["panels/chat"],
    persistedContract: false,
    surface: "fresh-chat-panel",
  },
  {
    id: "channel-envelope-replay",
    goal: "Plan a coordinated change to how the canonical agentic protocol reduces stored terminal outcomes. Update the durable channel replay consumer and the reusable conversation transcript renderer together. Keep native Session execution and the default worker adapter unchanged. Explain how to check both existing histories and fresh delivery.",
    owner: "packages/agentic-protocol",
    consumers: ["workers/pubsub-channel", "packages/agentic-chat"],
    rebuild: ["workers/pubsub-channel", "panels/chat"],
    persistedContract: true,
    surface: "fresh-agent",
  },
] as const;
