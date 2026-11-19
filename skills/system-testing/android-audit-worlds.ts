export const androidAuditWorlds = [
  {
    id: "attached-emulator-selection",
    goal: "Confirm the assigned emulator is reachable. Limit this review to the target connection.",
    mode: "target",
  },
  {
    id: "fresh-emulator-uninstalled-app",
    goal: "Check the internal Vibestudio application on the assigned fresh emulator and report its current state.",
    mode: "application",
  },
  {
    id: "absent-emulator-identity",
    goal: "Check the assigned emulator before reviewing the Vibestudio app. Keep the review tied to that exact target.",
    mode: "foreign",
  },
] as const;
