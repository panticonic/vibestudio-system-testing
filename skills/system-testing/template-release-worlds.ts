export const templateReleasePart = "packages/template-management";

export const templateReleaseWorlds = [
  {
    id: "ready-component-snapshot",
    name: "Reusable template management",
    description: "A workspace snapshot of the template management library.",
    goal: "Review the current plan for the reusable template management library. Confirm whether its approved dependency closure and assigned destination are ready for handoff.",
    destination: "review-fixture/template-management",
    version: "1.0.0",
    next: "ready-to-publish",
  },
  {
    id: "reinspect-renamed-snapshot",
    name: "Workspace template authoring toolkit",
    previousName: "Template library",
    description: "A workspace snapshot for reviewing template authoring.",
    goal: "The release snapshot was renamed after I reviewed it. Check whether the previous authoring fingerprint still covers the new snapshot and report the exact next prerequisite.",
    destination: "review-fixture/template-toolkit",
    version: "1.0.0",
    next: "reinspect",
  },
] as const;
