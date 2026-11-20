const bindingFailure = "Worker preparation failed: could not resolve the storage binding.";
const gatewayFailure = "Gateway startup failed: could not bind the listening port.";
const storageHealthy = "Worker storage connected and ready.";
const storageSlow = "Storage health check exceeded its warning threshold; the retry succeeded.";

export const managedLogHandoffWorlds = [
  {
    id: "persistent-worker-binding-failure",
    goal: "Compare the two host-log windows for recurrence of the worker preparation failure and hand off the evidence.",
    status: "recurring-failure",
    earlier: [
      { line: bindingFailure, label: "failure", repeat: 2 },
      { line: storageHealthy, label: "routine", repeat: 1 },
    ],
    later: [{ line: bindingFailure, label: "failure", repeat: 1 }],
  },
  {
    id: "different-startup-failure",
    goal: "Compare both startup windows and determine whether the later failure is the same startup incident.",
    status: "new-failure",
    earlier: [{ line: bindingFailure, label: "failure", repeat: 1 }],
    later: [{ line: gatewayFailure, label: "failure", repeat: 2 }],
  },
  {
    id: "quiet-storage-followup",
    goal: "Hand off the current state of worker storage after the earlier failure. Limit the conclusion to the observed window.",
    status: "quiet-after-failure",
    earlier: [{ line: bindingFailure, label: "failure", repeat: 2 }],
    later: [{ line: storageHealthy, label: "routine", repeat: 2 }],
  },
  {
    id: "storage-retry-followup",
    goal: "Decide whether worker storage needs further attention after the first window's preparation failure.",
    status: "needs-attention",
    earlier: [{ line: bindingFailure, label: "failure", repeat: 1 }],
    later: [
      { line: storageSlow, label: "notable", repeat: 2 },
      { line: storageHealthy, label: "routine", repeat: 1 },
    ],
  },
] as const;
