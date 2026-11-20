export const releaseReviewHandoffWork = [
  {
    kind: "domain",
    domain: "extensionDevelopment",
    operation: "reviewExtensionRelease",
  },
  { kind: "domain", domain: "capabilities", operation: "reviewAuthority" },
  { kind: "domain", domain: "scratchHandoff", operation: "assembleHandoff" },
] as const;

export const managedReleaseReviewHandoffWorlds = [
  {
    id: "unpublished-probe-and-calendar-scope",
    extension: "hold-unpublished-pdf-candidate",
    authority: "distinct-origins",
    goal: "Review the proposed PDF probe method. Then dry-run the assigned calendar and support links within the caller's scope. Leave an exact local handoff containing source readiness and held operations, without publishing or opening anything.",
  },
  {
    id: "published-probe-and-guide-hold",
    extension: "read-pdf-probe-contract",
    authority: "mixed-open-and-protected",
    goal: "Review the published PDF probe and its current runtime. Then assess the assigned working-status read and guide link under the caller's read-only ceiling, and leave a local evidence handoff.",
  },
  {
    id: "code-only-probe-and-status",
    extension: "hold-code-only-pdf-candidate",
    authority: "open-status-with-empty-ceiling",
    goal: "Determine whether a code-only PDF extension candidate is active. Then dry-run the permitted working-status read and hand off the exact semantic and authority findings for the next operator.",
  },
  {
    id: "active-git-bridge-migration-handoff",
    extension: "read-approved-git-bridge",
    authority: "git-bridge-migration-origins",
    goal: "Prepare the Git migration handoff. Establish whether the published Git Bridge review method is exposed by the active host process. Then dry-run the working-status read and the three assigned migration links, account for their distinct origins, and stage a handoff listing what the next operator must hold. Preserve the active runtime and leave all links unopened.",
  },
] as const;
