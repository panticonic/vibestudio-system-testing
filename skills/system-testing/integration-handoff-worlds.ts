type Evidence = { file: string; keys: string[] };
type Question = { text: string; evidence: Evidence[]; unanswered?: true };
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
        evidence: [
          { file: "notifications/channels.json", keys: ["enabled", "quorum"] },
        ],
      },
      {
        text: "How many workers and what interval does the retry policy use?",
        evidence: [
          {
            file: "notifications/retries.json",
            keys: ["workers", "intervalSeconds"],
          },
        ],
      },
    ],
  },
  {
    id: "regional-rendering",
    integration: "locale-catalog",
    questions: [
      {
        text: "Which locale and fallback order will the catalog use?",
        evidence: [
          { file: "catalog/locales.json", keys: ["active", "fallbacks"] },
        ],
      },
      {
        text: "Which density and typeface are selected for rendering?",
        evidence: [{ file: "catalog/render.json", keys: ["density", "font"] }],
      },
    ],
  },
  {
    id: "review-controls",
    integration: "three-stage-review",
    questions: [
      {
        text: "What is the new intake visibility and ID policy?",
        evidence: [
          {
            file: "review/intake.json",
            keys: ["visibility", "requireSourceId"],
          },
        ],
      },
      {
        text: "What are the triage quorum and severity levels?",
        evidence: [
          { file: "review/triage.json", keys: ["reviewers", "levels"] },
        ],
      },
      {
        text: "What is the export format, and is export automatic?",
        evidence: [
          { file: "review/export.json", keys: ["format", "automatic"] },
        ],
      },
    ],
  },
  {
    id: "intake-and-hold",
    integration: "ingest-routes",
    questions: [
      {
        text: "Which normalized export and which legal-hold setting now apply together?",
        evidence: [
          { file: "intake/route.json", keys: ["export"] },
          { file: "intake/retention.json", keys: ["legalHold"] },
        ],
      },
    ],
  },
  {
    id: "rollout-override-audit",
    integration: "approved-shared-overrides",
    questions: [
      {
        text: "Which batch cap and preview mode won the overrides, and which audience receives that preview?",
        evidence: [
          { file: "rollout/delivery.json", keys: ["batchSize"] },
          { file: "rollout/preview.json", keys: ["mode", "audience"] },
        ],
      },
    ],
  },
  {
    id: "accessibility-rollout",
    integration: "paired-limits",
    questions: [
      {
        text: "Which cache size and results per page should the operator expect together?",
        evidence: [
          { file: "viewer/cache.json", keys: ["sizeMb"] },
          { file: "viewer/display.json", keys: ["pageSize"] },
        ],
      },
      {
        text: "Is high contrast enabled in the integrated viewer?",
        evidence: [{ file: "viewer/display.json", keys: ["highContrast"] }],
      },
    ],
  },
  {
    id: "continuity-gate-handoff",
    integration: "regional-continuity",
    questions: [
      {
        text: "What failover scope and wait apply together?",
        evidence: [
          { file: "continuity/route.json", keys: ["failover", "waitSeconds"] },
        ],
      },
      {
        text: "For this regional route, how many probes are needed and is reopening manual?",
        evidence: [
          { file: "continuity/route.json", keys: ["failover"] },
          {
            file: "continuity/gate.json",
            keys: ["successfulProbes", "reopen"],
          },
        ],
      },
    ],
  },
  {
    id: "access-review-handoff",
    integration: "reviewer-access",
    questions: [
      {
        text: "What audience restriction, identity requirement, and winning session duration apply together?",
        evidence: [
          {
            file: "access/review.json",
            keys: ["visibility", "requireNamedAccess"],
          },
          { file: "access/session.json", keys: ["limitMinutes"] },
        ],
      },
    ],
  },
  {
    id: "custody-approver-unconfirmed",
    integration: "custody-routing",
    questions: [
      {
        text: "Which receiving desk and seal check apply together?",
        evidence: [
          { file: "custody/route.json", keys: ["desk"] },
          { file: "custody/checks.json", keys: ["verifySeal"] },
        ],
      },
      {
        text: "Which individual signed approval for transfer?",
        evidence: [{ file: "custody/checks.json", keys: ["signedBy"] }],
        unanswered: true,
      },
    ],
  },
  {
    id: "archive-deposit-handoff",
    integration: "archive-recall",
    questions: [
      {
        text: "Is the quarantine destination taking new deposits, and which replacement catalog should be used?",
        evidence: [
          { file: "archive/deposits.json", keys: ["accepting", "destination"] },
          { file: "archive/recall.json", keys: ["replacement"] },
        ],
      },
    ],
  },
  {
    id: "export-release-unconfirmed",
    integration: "export-reconciliation",
    questions: [
      {
        text: "Which private output shards require manual confirmation?",
        evidence: [
          { file: "export/output.json", keys: ["audience", "shards"] },
          { file: "export/confirmation.json", keys: ["confirm"] },
        ],
      },
      {
        text: "Who actually signed the export confirmation?",
        evidence: [{ file: "export/confirmation.json", keys: ["signedBy"] }],
        unanswered: true,
      },
      {
        text: "When was this export actually distributed?",
        evidence: [{ file: "export/output.json", keys: ["distributedAt"] }],
        unanswered: true,
      },
    ],
  },
];
