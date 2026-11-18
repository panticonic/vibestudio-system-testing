export const grimoirePanel = "panels/grimoire";
type Resident = "Sol" | "Pip";
type Decision = "supported" | "contradicted" | "not-observed";
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
      check: { kind: "day-advanced" | "weather-changed" | "new-discovery" };
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
  kind: "day-advanced" | "weather-changed" | "new-discovery",
): Claim => ({ kind: "transition", check: { kind } });

function garden(
  id: string,
  goal: string,
  visits: Resident[],
  checks: [Claim, Decision][],
) {
  return {
    id,
    visits,
    request: {
      kind: "live-garden" as const,
      goal,
      claims: checks.map(([claim]) => claim),
    },
    expected: checks.map(([, decision]) => decision),
  };
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
];
