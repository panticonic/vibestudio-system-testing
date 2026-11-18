type Question = { text: string; file: string; keys: string[] };
type IntegrationHandoffWorld = {
  id: string;
  integration: string;
  questions: Question[];
};

export const integrationHandoffWorlds: IntegrationHandoffWorld[] = [
  {
    id: "notification-rollout",
    integration: "notification-rollout",
    questions: [
      {
        text: "Is rollout enabled, and how large is the review quorum?",
        file: "notifications/channels.json",
        keys: ["enabled", "quorum"],
      },
      {
        text: "How many workers and what interval does the retry policy use?",
        file: "notifications/retries.json",
        keys: ["workers", "intervalSeconds"],
      },
    ],
  },
  {
    id: "regional-rendering",
    integration: "locale-catalog",
    questions: [
      {
        text: "Which locale and fallback order will the catalog use?",
        file: "catalog/locales.json",
        keys: ["active", "fallbacks"],
      },
      {
        text: "Which density and typeface are selected for rendering?",
        file: "catalog/render.json",
        keys: ["density", "font"],
      },
    ],
  },
  {
    id: "review-controls",
    integration: "three-stage-review",
    questions: [
      {
        text: "What is the new intake visibility and ID policy?",
        file: "review/intake.json",
        keys: ["visibility", "requireSourceId"],
      },
      {
        text: "What are the triage quorum and severity levels?",
        file: "review/triage.json",
        keys: ["reviewers", "levels"],
      },
      {
        text: "What is the export format, and is export automatic?",
        file: "review/export.json",
        keys: ["format", "automatic"],
      },
    ],
  },
];
