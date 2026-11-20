export const notificationWorlds = [
  {
    id: "temporary-info",
    goal: "Show a temporary TEST notification in the shell chrome and dismiss the exact host-issued ID.",
    title: "TEST notification lifecycle",
    actionLabels: [],
    sourceGroup: "vibestudio:system-testing:show-notification",
  },
  {
    id: "temporary-actions",
    goal: "Show and dismiss a temporary TEST notification offering Accept and Decline. Report the offered actions without claiming any user interaction.",
    title: "TEST notification actions",
    actionLabels: ["Accept", "Decline"],
    sourceGroup: "vibestudio:system-testing:show-with-actions",
  },
];
