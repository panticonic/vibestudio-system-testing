export const grimoirePanel = "panels/grimoire";
type Resident = "Sol" | "Pip";
type GardenAction = Resident | "linger";
type Decision = "supported" | "contradicted" | "not-observed";
type Handoff = {
  questions: [string, string, string];
};
type Claim =
  | {
      kind: "habitat";
      check: {
        kind: "meets-needs" | "is-home" | "settled";
        home: string;
        resident: string;
      };
    }
  | {
      kind: "transition";
      check: {
        kind: "attachment-grew" | "recognized" | "relocated";
        resident: string;
      };
    }
  | {
      kind: "transition";
      check: {
        kind:
          | "day-advanced"
          | "phase-advanced"
          | "weather-changed"
          | "new-discovery";
      };
    };

const habitat = (
  kind: "meets-needs" | "is-home" | "settled",
  home: string,
  resident: string,
): Claim => ({ kind: "habitat", check: { kind, home, resident } });
const residentChange = (
  kind: "attachment-grew" | "recognized" | "relocated",
  resident: string,
): Claim => ({ kind: "transition", check: { kind, resident } });
const change = (
  kind: "day-advanced" | "phase-advanced" | "weather-changed" | "new-discovery",
): Claim => ({ kind: "transition", check: { kind } });

function garden(
  id: string,
  goal: string,
  actions: GardenAction[],
  checks: [Claim, Decision][],
  handoff?: Handoff,
) {
  return {
    id,
    actions,
    request: {
      kind: "live-garden" as const,
      goal,
      claims: checks.map(([claim]) => claim),
    },
    expected: checks.map(([, decision]) => decision),
    handoff,
  };
}
const linger = (count: number): GardenAction[] =>
  Array.from({ length: count }, () => "linger");
export const grimoireHandoffWork = [
  { kind: "domain", domain: "examples", operation: "reviewExample" },
  { kind: "domain", domain: "scratchHandoff", operation: "assembleHandoff" },
] as const;

export function projectGardenHandoff(
  claims: readonly Claim[],
  components: readonly {
    decision: string;
    finding: string;
    evidenceIds: readonly string[];
  }[],
) {
  return (
    components
      .map(({ decision, finding, evidenceIds }, index) =>
        JSON.stringify({
          claim: claims[index],
          decision,
          finding,
          evidenceIds,
        }),
      )
      .join("\n") + "\n"
  );
}

export const managedGrimoireWorlds = [
  garden(
    "sol-after-visit",
    "Visit Sol and separate growing attachment from recognition and habitat comfort.",
    ["Sol"],
    [
      [residentChange("attachment-grew", "sol"), "supported"],
      [residentChange("recognized", "sol"), "contradicted"],
      [habitat("meets-needs", "hollow", "sol"), "contradicted"],
    ],
  ),
  garden(
    "pip-after-visit",
    "Visit Pip and verify whether the familiar home changed or the robin became settled.",
    ["Pip"],
    [
      [residentChange("relocated", "pip"), "contradicted"],
      [habitat("is-home", "meadow", "pip"), "supported"],
      [habitat("settled", "meadow", "pip"), "contradicted"],
    ],
  ),
  garden(
    "independent-visits",
    "Visit both residents in succession and account for the attachment result for each.",
    ["Sol", "Pip"],
    [
      [residentChange("attachment-grew", "sol"), "supported"],
      [residentChange("attachment-grew", "pip"), "supported"],
      [change("day-advanced"), "contradicted"],
    ],
  ),
  garden(
    "unvisited-neighbor",
    "Visit only Pip and compare its attachment change with unvisited Sol.",
    ["Pip"],
    [
      [residentChange("attachment-grew", "pip"), "supported"],
      [residentChange("attachment-grew", "sol"), "contradicted"],
    ],
  ),
  garden(
    "quiet-garden",
    "Inspect the untouched garden and ask if either resident already lives in its expected habitat.",
    [],
    [
      [habitat("is-home", "hollow", "sol"), "supported"],
      [habitat("is-home", "meadow", "pip"), "supported"],
    ],
  ),
  garden(
    "unknown-habitat",
    "Distinguish an unobserved habitat from the known home for Sol.",
    [],
    [
      [habitat("is-home", "hidden-cave", "sol"), "not-observed"],
      [habitat("is-home", "hollow", "sol"), "supported"],
    ],
  ),
  garden(
    "stationary-weather",
    "Visit Sol and check which kinds of change the visit actually caused.",
    ["Sol"],
    [
      [change("weather-changed"), "contradicted"],
      [change("new-discovery"), "contradicted"],
      [residentChange("attachment-grew", "sol"), "supported"],
    ],
  ),
  garden(
    "known-and-missing-resident",
    "Separate observed care for Pip from a missing resident whose attachment cannot be compared.",
    ["Pip"],
    [
      [residentChange("attachment-grew", "pip"), "supported"],
      [residentChange("attachment-grew", "stranger"), "not-observed"],
    ],
  ),
  garden(
    "one-phase-before-midnight",
    "Distinguish a single advance to night from a completed day.",
    linger(1),
    [
      [change("phase-advanced"), "supported"],
      [change("day-advanced"), "contradicted"],
      [change("weather-changed"), "supported"],
    ],
  ),
  garden(
    "dawn-without-care",
    "Check dawn, discovery and attachment after time passes without a visit.",
    linger(2),
    [
      [change("day-advanced"), "supported"],
      [change("new-discovery"), "contradicted"],
      [residentChange("attachment-grew", "pip"), "contradicted"],
    ],
  ),
  garden(
    "weather-returned-to-baseline",
    "Compare the evening snapshots across a full cycle. Identify progress even if weather returns to its old label.",
    linger(4),
    [
      [change("phase-advanced"), "supported"],
      [change("day-advanced"), "supported"],
      [change("weather-changed"), "contradicted"],
    ],
  ),
  garden(
    "repeat-visit-before-dawn",
    "Compare repeated Sol visits before dawn. Separate attachment growth from crossing the recognition threshold.",
    ["Sol", "linger", "Sol", "Sol"],
    [
      [residentChange("attachment-grew", "sol"), "supported"],
      [residentChange("recognized", "sol"), "contradicted"],
      [change("day-advanced"), "contradicted"],
    ],
  ),
  garden(
    "pip-recognition-after-dawn",
    "Verify whether visits to Pip on separate days establish recognition, while Sol remains unchanged.",
    ["Pip", ...linger(2), "Pip"],
    [
      [residentChange("recognized", "pip"), "supported"],
      [residentChange("attachment-grew", "sol"), "contradicted"],
      [change("new-discovery"), "contradicted"],
    ],
  ),
  garden(
    "one-morning-visit-after-passage",
    "Separate passage through dawn from attachment and recognition earned by one visit after dawn.",
    [...linger(2), "Pip"],
    [
      [change("day-advanced"), "supported"],
      [residentChange("attachment-grew", "pip"), "supported"],
      [residentChange("recognized", "pip"), "contradicted"],
    ],
  ),
  garden(
    "sol-two-days-attachment",
    "Review growth for Sol across two days and check whether it qualifies as recognition.",
    ["Sol", ...linger(2), "Sol"],
    [
      [residentChange("attachment-grew", "sol"), "supported"],
      [residentChange("recognized", "sol"), "contradicted"],
      [residentChange("relocated", "sol"), "contradicted"],
    ],
  ),
  garden(
    "sol-three-days-recognition",
    "Review Sol's repeated care across three distinct days and compare it with Pip's one visit.",
    ["Sol", ...linger(2), "Sol", "Pip", ...linger(4), "Sol"],
    [
      [residentChange("recognized", "sol"), "supported"],
      [residentChange("recognized", "pip"), "contradicted"],
      [change("day-advanced"), "supported"],
    ],
  ),
  garden(
    "rain-settlement-without-discovery",
    "Check whether the first settling observation in the rain already warrants a discovery claim.",
    linger(7),
    [
      [change("weather-changed"), "supported"],
      [habitat("settled", "hollow", "sol"), "supported"],
      [change("new-discovery"), "contradicted"],
    ],
  ),
  garden(
    "rain-brings-garden-comfort",
    "After the rain, distinguish Sol settling in the known hollow from a claim that its minimum needs are all met.",
    linger(7),
    [
      [habitat("settled", "hollow", "sol"), "supported"],
      [habitat("meets-needs", "hollow", "sol"), "contradicted"],
      [residentChange("relocated", "sol"), "contradicted"],
    ],
  ),
  garden(
    "two-settled-observations",
    "Review the evening after rain. Check whether a second settled observation already produced a discovery.",
    linger(8),
    [
      [habitat("settled", "hollow", "sol"), "supported"],
      [change("new-discovery"), "contradicted"],
      [change("weather-changed"), "contradicted"],
    ],
  ),
  garden(
    "discovery-without-visit",
    "Identify a home discovery from the later garden evidence while separating it from recognition due to visits.",
    linger(9),
    [
      [change("new-discovery"), "supported"],
      [residentChange("recognized", "sol"), "contradicted"],
      [habitat("settled", "hollow", "sol"), "supported"],
    ],
  ),
  garden(
    "recognized-neighbor-and-discovery",
    "Check whether Pip recognized the caretaker and whether the garden also recorded an independent discovery for Sol.",
    ["Pip", ...linger(2), "Pip", ...linger(7)],
    [
      [residentChange("recognized", "pip"), "supported"],
      [change("new-discovery"), "supported"],
      [habitat("settled", "meadow", "pip"), "contradicted"],
    ],
  ),
  garden(
    "discovery-is-not-relocation",
    "Check whether a new discovery means Sol relocated, then assess the missing habitat claim separately.",
    linger(9),
    [
      [change("new-discovery"), "supported"],
      [residentChange("relocated", "sol"), "contradicted"],
      [habitat("settled", "hidden-cave", "sol"), "not-observed"],
    ],
  ),
  garden(
    "both-cared-for-after-dawn",
    "Verify which resident received recognition after dawn when their visit history differs.",
    ["Pip", "Sol", ...linger(2), "Pip", "Sol"],
    [
      [residentChange("recognized", "pip"), "supported"],
      [residentChange("recognized", "sol"), "contradicted"],
      [residentChange("attachment-grew", "sol"), "supported"],
    ],
  ),
  garden(
    "next-morning-retains-discovery",
    "Check that the next dawn still carries a discovery even though no one returned for a visit.",
    linger(10),
    [
      [change("new-discovery"), "supported"],
      [change("day-advanced"), "supported"],
      [residentChange("attachment-grew", "sol"), "contradicted"],
      [habitat("is-home", "meadow", "pip"), "supported"],
    ],
  ),
  garden(
    "dawn-care-handoff",
    "Prepare a caretaker changeover after two visits to Pip across dawn and one visit to Sol. Verify each resident's recognition and that the garden reached the following day. Save the supported and contradicted findings with exact evidence.",
    ["Pip", "Sol", ...linger(2), "Pip"],
    [
      [residentChange("recognized", "pip"), "supported"],
      [residentChange("recognized", "sol"), "contradicted"],
      [change("day-advanced"), "supported"],
    ],
    {
      questions: [
        "Did Pip recognize the caretaker after dawn?",
        "Did Sol recognize the caretaker?",
        "Does the saved garden show that a day advanced?",
      ],
    },
  ),
  garden(
    "discovery-with-missing-habitat-handoff",
    "Prepare a caretaker handoff from the quiet garden after the discovery. Establish whether the discovery occurred, whether Sol relocated and whether the named hidden cave was observed. Preserve the distinction between a contradicted claim and a missing observation.",
    linger(9),
    [
      [change("new-discovery"), "supported"],
      [residentChange("relocated", "sol"), "contradicted"],
      [habitat("settled", "hidden-cave", "sol"), "not-observed"],
    ],
    {
      questions: [
        "Was a new discovery recorded?",
        "Did Sol relocate after the discovery?",
        "What does the saved garden establish about the assigned hidden cave?",
      ],
    },
  ),
];
