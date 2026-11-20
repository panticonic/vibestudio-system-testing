export const managedAdventureWorlds = [
  {
    id: "postal-painted-opening",
    campaign: "dead-letter-office",
    place: "landing",
    painted: true,
    request: {
      kind: "live-adventure",
      goal: "Review the saved opening after the postal panel loads its cover. Check the customs exit, the carried letter and its seal. Verify that loading the opening illustration left fictional time unchanged and that the stored image depicts this exact scene.",
      claims: [
        { kind: "access", check: { kind: "exit", target: "customs" } },
        { kind: "access", check: { kind: "carried", target: "mara-letter" } },
        { kind: "access", check: { kind: "unsealed", target: "mara-letter" } },
        { kind: "continuity", check: { kind: "time-advanced" } },
        { kind: "artwork" },
      ],
    },
    expected: [
      "supported",
      "supported",
      "contradicted",
      "contradicted",
      "supported",
    ],
  },
  {
    id: "embassy-unpainted-opening",
    campaign: "missing-country",
    place: "vestibule",
    painted: false,
    request: {
      kind: "live-adventure",
      goal: "Review the Embassy journey before any panel has registered artwork. Confirm access to the salon and visibility of the registry notice. Decide whether the notice's seal is observed, whether the viewpoint remained in place, and whether the journey has an illustration.",
      claims: [
        { kind: "access", check: { kind: "exit", target: "salon" } },
        { kind: "access", check: { kind: "visible", target: "notice" } },
        { kind: "access", check: { kind: "unsealed", target: "notice" } },
        { kind: "continuity", check: { kind: "same-place" } },
        { kind: "artwork" },
      ],
    },
    expected: [
      "supported",
      "supported",
      "not-observed",
      "supported",
      "not-observed",
    ],
  },
] as const;
