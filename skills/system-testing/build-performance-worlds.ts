export const buildPerformanceWorlds = [
  {
    id: "initial-delivery-budget",
    goal: "Compare the disposable panel's initial payload with its 256-byte initial-delivery budget. Identify the largest measured initial contributor and choose the next measurement.",
    initialBudgetBytes: 256,
  },
  {
    id: "repeat-cache-baseline",
    goal: "Record a native baseline for the disposable panel. Establish whether the repeat retained the build keys and distinguish initial, lazy and total bytes.",
  },
] as const;
