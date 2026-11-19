export const integrationReadinessFixture = {
  audience: "https://readiness.integration.system-test.invalid/catalog",
  label: "Owned integration readiness fixture",
} as const;
const catalog = {
  id: "catalog-read",
  purpose: "Read the assigned catalog",
  url: integrationReadinessFixture.audience + "/current",
  use: "fetch",
  required: true,
  state: "active",
} as const;

export const managedIntegrationReadinessWorlds = [
  {
    id: "optional-companion-unbound",
    goal: "Check whether the assigned catalog is ready to read. Report whether the optional enrichment destination has a binding without making it a prerequisite.",
    status: "ready",
    destinations: [
      catalog,
      {
        id: "enrichment",
        purpose: "Read optional enrichment records",
        url: "https://readiness.integration.system-test.invalid/enrichment/current",
        use: "fetch",
        required: false,
        state: "missing",
      },
    ],
  },
  {
    id: "required-transport-unbound",
    goal: "Verify the read and publication prerequisites for the assigned catalog. If the publication transport has no binding, identify the public setup facts still needed.",
    status: "setup-needed",
    destinations: [
      catalog,
      {
        id: "catalog-publish",
        purpose: "Publish the assigned catalog",
        url: catalog.url,
        use: "publish",
        required: true,
        state: "missing",
      },
    ],
  },
] as const;

export function integrationReadinessWorld(id: string) {
  const world = managedIntegrationReadinessWorlds.find(
    (candidate) => candidate.id === id,
  );
  if (!world) throw new Error("Unknown integration readiness case");
  return world;
}
