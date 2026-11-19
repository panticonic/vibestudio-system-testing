export const managedGadReviewWorlds = [
  {
    id: "empty-roster",
    view: "triage",
    goal: "Triage this newly prepared conversation. Distinguish durable integrity from a missing roster, then inspect the roster to confirm what the operator should investigate.",
    messages: [],
  },
  {
    id: "latest-handoff-question",
    view: "recap",
    goal: "Recap the latest handoff question in the assigned conversation. Find out whether an agent has answered it and cite the exact latest message.",
    messages: [
      "The preview checklist is complete.",
      "Who should confirm the handoff before I publish the preview?",
    ],
  },
] as const;

export function gadReviewWorld(id: string) {
  const world = managedGadReviewWorlds.find((candidate) => candidate.id === id);
  if (!world) throw new Error("Unknown GAD channel review assignment");
  return world;
}
