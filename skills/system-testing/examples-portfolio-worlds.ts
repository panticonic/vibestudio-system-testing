import { managedGrimoireWorlds } from "./grimoire-worlds.js";
import { managedRegencyWorlds } from "./regency-review-worlds.js";

export const managedExamplesPortfolioWorlds = [
  {
    id: "ready-quiet-estate-and-forecast",
    garden: "one-phase-before-midnight",
    realm: "one-month-ledger-and-reserves",
    goal: "Decide if the two demos are ready for review. The Regency demo needs evidence of a projected Eastbank grain gain. The Grimoire demo needs evidence that quiet observation advanced the phase. Preserve the other findings from both reviews and keep the forecast distinct from saved history.",
    criteria: [
      { demo: "realm", claimIndex: 2 },
      { demo: "garden", claimIndex: 0 },
    ],
    expected: ["supported", "supported"],
    readiness: "supported",
  },
  {
    id: "hold-recognition-and-committed-reserves",
    garden: "repeat-visit-before-dawn",
    realm: "one-month-ledger-and-reserves",
    goal: "Check whether both demos qualify for the release. Grimoire requires that Sol recognized the caretaker. Regency requires that the Eastbank grain gain was committed. Keep the distinction between a contradicted condition and a forecast without a committed outcome.",
    criteria: [
      { demo: "garden", claimIndex: 1 },
      { demo: "realm", claimIndex: 3 },
    ],
    expected: ["contradicted", "not-observed"],
    readiness: "contradicted",
  },
] as const;

export function examplesPortfolioAssignment(caseId: string) {
  const world = managedExamplesPortfolioWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown Examples portfolio case");
  const garden = managedGrimoireWorlds.find(({ id }) => id === world.garden);
  const realm = managedRegencyWorlds.find(({ id }) => id === world.realm);
  if (!garden || !realm)
    throw new Error("The assigned portfolio game is missing");
  return {
    world,
    garden,
    realm,
    request: {
      kind: "live-portfolio" as const,
      goal: world.goal,
      garden: garden.request,
      realm: realm.request,
      criteria: world.criteria,
    },
  };
}
