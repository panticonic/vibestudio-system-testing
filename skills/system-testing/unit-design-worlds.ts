const pdf = { name: "@workspace-extensions/pdf-ingest", source: "extensions/pdf-ingest" };

export const managedUnitDesignWorlds = [
  {
    ...pdf,
    id: "published-manifest-matches-review",
    goal: "Review the installed PDF extension's manifest design. Check both that it passes the host validator and that the reviewed manifest is the one published on protected main.",
    mode: "published",
  },
  {
    ...pdf,
    id: "stage-valid-lifecycle-change",
    goal: "Review the proposed PDF extension lifecycle change before handoff. Check that the adjusted manifest is valid and report whether protected main contains it.",
    mode: "valid-local",
  },
  {
    ...pdf,
    id: "reject-invalid-local-icon",
    goal: "Review the PDF extension candidate after an icon edit. Attribute any manifest failure to the correct revision and keep the published extension out of the repair.",
    mode: "invalid-local",
  },
] as const;
