export const androidPairWorlds = [
  {
    id: "inspect-assigned-pairing-target",
    goal: "Check whether the assigned Android emulator can be paired through the current desktop. Keep this check read-only.",
    mode: "inspect",
  },
  {
    id: "hold-missing-pairing-target",
    goal: "Prepare pairing for the exact assigned Android target and hold if the desktop cannot find it.",
    mode: "missing",
  },
  {
    id: "pair-compatible-emulator-and-verify-workspace",
    goal: "Pair the assigned compatible Android emulator and verify the workspace using the new paired identity.",
    mode: "pair",
  },
] as const;
