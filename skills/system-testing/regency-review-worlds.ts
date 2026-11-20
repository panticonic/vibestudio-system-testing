export const managedRegencyWorlds = [
  {
    id: "one-month-ledger-and-reserves",
    projectedTreasury: 105.2,
    request: {
      kind: "live-realm",
      months: 1,
      goal: "Brief the regent on the opening ledger and the next month under existing policy. Check current debt, the projected operating balance, and Eastbank grain. Decide whether the projected gain is already part of the saved realm.",
      claims: [
        { kind: "settlement", source: "saved", check: { kind: "has-debt" } },
        {
          kind: "settlement",
          source: "forecast",
          check: { kind: "net-positive" },
        },
        {
          kind: "compare",
          check: { kind: "regional-grain-grew", region: "eastbank" },
          assertCommitted: false,
        },
        {
          kind: "compare",
          check: { kind: "regional-grain-grew", region: "eastbank" },
          assertCommitted: true,
        },
      ],
    },
    expected: ["contradicted", "contradicted", "supported", "not-observed"],
  },
  {
    id: "three-month-crossing-and-cargo",
    projectedTreasury: 76.1,
    request: {
      kind: "live-realm",
      months: 3,
      goal: "Review the eastern crossing over the next three months without enacting policies. Distinguish observed cargo in the saved opening from projected capacity usage. Verify whether works progress or Crownlands reserves grow under the existing settlement rules.",
      claims: [
        {
          kind: "settlement",
          source: "saved",
          check: { kind: "cargo-under-capacity", route: "east-crossing" },
        },
        {
          kind: "settlement",
          source: "forecast",
          check: { kind: "cargo-under-capacity", route: "east-crossing" },
        },
        {
          kind: "compare",
          check: { kind: "route-works-progressed", route: "east-crossing" },
          assertCommitted: false,
        },
        {
          kind: "compare",
          check: { kind: "regional-grain-grew", region: "crownlands" },
          assertCommitted: false,
        },
      ],
    },
    expected: ["not-observed", "supported", "contradicted", "contradicted"],
  },
] as const;
