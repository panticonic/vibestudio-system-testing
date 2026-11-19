function external(id: string, label: string, url: string) {
  return {
    id,
    label,
    service: "externalOpen",
    method: "openExternal",
    args: [url],
    protectedResources: [new URL(url).origin],
  };
}

const status = {
  id: "working-status",
  label: "Read the assigned semantic working status",
  service: "vcs",
  method: "status",
  args: [],
  protectedResources: [],
};

export const managedAuthorityReviewWorlds = [
  {
    id: "open-status-with-empty-ceiling",
    goal: "Inspect whether the assigned working-status read fits a ceiling with no protected requests.",
    operations: [status],
    ceiling: [],
    outside: [],
  },
  {
    id: "distinct-origins",
    goal: "Dry-run the three assigned link operations. Keep the calendar origin in scope and hold the support origin. Consolidate the two calendar paths while preserving distinct origins, without opening anything.",
    operations: [
      external(
        "calendar-list",
        "Calendar list",
        "https://calendar.example/list",
      ),
      external(
        "calendar-settings",
        "Calendar settings",
        "https://calendar.example/settings",
      ),
      external("support", "Help desk", "https://help.example/start"),
    ],
    ceiling: [
      { capability: "external.open", resourceKey: "https://calendar.example" },
    ],
    outside: ["support"],
  },
  {
    id: "mixed-open-and-protected",
    goal: "Inspect the working-status read and a reference link. The caller allowed only the working-status read. Report the link's protection and leave both operations unexecuted.",
    operations: [
      status,
      external("guide", "External guide", "https://guide.example/intro"),
    ],
    ceiling: [],
    outside: ["guide"],
  },
];
