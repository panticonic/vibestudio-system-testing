type SkillEvidence = { dirPath: string; focus: string[]; supports: RegExp };

export type CapabilityPlanWorld = {
  kind: "capability-plan";
  id: string;
  goal: string;
  sourceGroup: string;
  split?: "test";
  memo?: { title: string; text: string };
  decision?: { reference: string; claims: RegExp[] };
  memoDisposition?: "current" | "stale" | "conflicting";
  steps: string[];
  knowledge?: SkillEvidence[];
  obsoleteMethod?: string;
  missing?: { kind: "method" | "skill"; name: string };
  inventory?: boolean;
  stageAuthorized?: boolean;
};

const skill = (name: string, focus: string[], supports: RegExp): SkillEvidence => ({
  dirPath: `skills/${name}`, focus, supports,
});

const worlds: Omit<CapabilityPlanWorld, "kind">[] = [
  {
    id: "plan-content-addressed-citation",
    decision: { reference: "Retain the digest returned when storing the exact text. Use that digest to retrieve the exact content for the reviewer.",
      claims: [/digest|content (?:identity|address)/iu, /retriev|recover/iu] },
    sourceGroup: "vibestudio:catalog:content-addressed-text-chain",
    goal: "I need a reproducible reference for the exact text of a small consent form. Figure out what live callable interface would give it a content identity and how a reviewer would recover the exact text from that identity. Give me each call's argument names, in workflow order. Leave the form untouched.",
    steps: ["blobstore.putText", "blobstore.getText"],
  },
  {
    id: "plan-binary-page-slice",
    decision: { reference: "The obsolete name is absent in this role. The current call accepts an offset and bounded byte limit for this binary window.",
      claims: [/offset/iu, /limit|length|window/iu, /obsolete|retired|absent|unavailable/iu] },
    sourceGroup: "vibestudio:catalog:ranged-binary-inspection",
    goal: "My attachment index records an offset into a binary scan. Plan how I can inspect just that byte window with the current workspace RPC, and include its argument names. The old note says to use the retired binary range spelling. Check whether that note still describes the interface. Don't open the scan.",
    memo: { title: "Scan index note", text: "Use fs.readBinaryRange for attached scans." },
    memoDisposition: "stale",
    obsoleteMethod: "fs.readBinaryRange",
    steps: ["fs.readBytes"],
  },
  {
    id: "plan-command-evidence-recovery",
    decision: { reference: "Stay in the original workspace context and use the terminal eval record and its receipt to confirm what committed. Do not replay.",
      claims: [/context/iu, /receipt/iu, /commit|retain/iu] },
    sourceGroup: "vibestudio:catalog:eval-terminal-evidence",
    goal: "An eval ended while the client was disconnected. I want a plan for identifying its terminal status and checking the committed operation receipt without repeating the eval. Use the installed sandbox guidance about how the workspace and context constrain recovery. Check the current RPC argument names.",
    steps: ["eval.get", "eval.receipt"],
    knowledge: [skill("sandbox", ["workspace", "context", "branch"], /current workspace and context|Contexts are branches/iu)],
  },
  {
    id: "plan-context-history-comparison",
    decision: { reference: "Status identifies the editor's uncommitted working state. Compare it with the file at the fixed workspace revision.",
      claims: [/uncommitted|working (?:state|head|tree)/iu, /fixed|revision|reference/iu] },
    sourceGroup: "vibestudio:catalog:semantic-vcs-version-comparison",
    goal: "A reviewer has a fixed workspace revision and an editor has unsaved-in-history changes. Lay out how to inspect the editor's status and compare a file against the fixed revision. Use the installed workspace VCS guidance to choose the order and explain what would count as working state. Don't change anything.",
    steps: ["vcs.status", "vcs.readFile"],
    knowledge: [skill("vibestudio-vcs", ["context", "uncommitted", "status"], /uncommitted|working state/iu)],
  },
  {
    id: "plan-reviewable-website-package",
    decision: { reference: "Pin the reviewed source to a fixed reference before building. The packet should read the immutable artifact. Publishing now goes beyond this review.",
      claims: [/fixed|pin|revision/iu, /immutable|digest/iu, /publish|deploy|review/iu] },
    sourceGroup: "vibestudio:catalog:immutable-site-package",
    goal: "I am preparing a website review packet. Identify the next main RPC to build the website and the one that later reads the immutable build artifact. Apply the installed publishing guidance about the source reference. The desk note says to publish straight from the changing workspace. Compare that instruction with this review-only request and don't build or publish anything.",
    memo: { title: "Desk note", text: "Publish directly from whatever is currently in the workspace. A fixed review is unnecessary." },
    memoDisposition: "conflicting",
    steps: ["build.buildWebsite", "build.readBuildArtifact"],
    knowledge: [skill("website-publishing", ["fixed reference", "immutable", "reviewed"], /fixed reference|immutable artifact/iu)],
  },
  {
    id: "plan-call-contract-introspection",
    sourceGroup: "vibestudio:catalog:typed-docs-introspection",
    goal: "Our SDK generator needs a read-only plan for checking whether a capability ID exists, followed by fetching only its JSON Schema. Identify the two live catalog calls the generator should use in order and show their exact argument names. Please don't generate files.",
    steps: ["docs.describe", "docs.getSchema"],
  },
  {
    id: "plan-visible-service-inventory",
    sourceGroup: "vibestudio:catalog:role-visible-service-inventory",
    goal: "I'm updating an onboarding note about the role we're currently using. Report the actual number of visible RPC services and the current per-surface entry counts. Include representative service names and identify the two catalog calls that would refresh those two different counts. No copy to the repo.",
    steps: ["docs.listServices", "docs.listSurfaces"],
    inventory: true,
  },
  {
    id: "plan-installed-knowledge-discovery",
    sourceGroup: "vibestudio:catalog:ambient-skill-index-lookup",
    goal: "We are writing an internal workspace assistant that has to choose a repo-installed skill and then read the exact guide without guessing its location. How should it enumerate installed skills and fetch the selected Markdown in this context? Include the live call IDs and their parameter names.",
    steps: ["workspace.listSkills", "workspace.readSkill"],
  },
  {
    id: "hold-archive-verifier-plan",
    sourceGroup: "vibestudio:catalog:required-obsolete-archive-verifier",
    goal: "A migration acceptance checklist explicitly requires shiftArchive.verifyPackedNote. Check whether that exact method is available in this workspace role. If it isn't, stop and give us the blocker instead of substituting a different verifier. No changes or handoff.",
    steps: [],
    missing: { kind: "method", name: "shiftArchive.verifyPackedNote" },
  },
  {
    id: "hold-required-installed-runbook",
    sourceGroup: "vibestudio:catalog:missing-local-facilities-runbook",
    goal: "The city onboarding contract requires an installed skill called facilities-release-approver. Check this workspace's installed inventory. If the required guide is absent, tell me you can't finalize the plan. Don't reuse a similarly named skill and don't make files.",
    steps: [],
    missing: { kind: "skill", name: "facilities-release-approver" },
  },
  {
    id: "stage-local-natlang-review-plan",
    decision: { reference: "Use a description and schema to check the typed interface. Natlang describe compiles without running the callable. Stage this plan only in scratch.",
      claims: [/compile|check/iu, /without (?:running|executing)|never runs|does not run|nothing runs|no execution/iu] },
    sourceGroup: "vibestudio:catalog:authorized-natlang-review-handoff",
    goal: "I authorize you to stage a local scratch plan for a teammate who's checking a typed Natlang function. Use the installed authoring skill to preserve the check-versus-run distinction. The plan should explain how to look up the relevant live call description and just its schema before implementing, and should keep the exact argument names. Don't run or edit any program.",
    memo: { title: "Teammate notes", text: "Check the typed callable contract without running it. Look up the live capability description and then the schema. Stage only the plan in scratch." },
    memoDisposition: "current",
    steps: ["docs.describe", "docs.getSchema"],
    knowledge: [skill("natlang-authoring", ["compile", "describe", "Nothing runs"], /Nothing runs|Compiles the program/iu)],
    stageAuthorized: true,
  },
  {
    id: "plan-eval-event-cursor",
    decision: { reference: "Check the current record first. Resume reading events from the saved cursor without restarting the eval.",
      claims: [/cursor/iu, /event/iu, /first|before|then/iu] },
    sourceGroup: "vibestudio:catalog:incremental-eval-transcript-evidence",
    goal: "I have an eval ID and a previously saved event cursor. Plan the live calls that first check its current record and then recover its later event span without replaying side effects. The notes suggest looking at the eval record before requesting events. Verify that guidance and preserve the contract argument names.",
    memo: { title: "Event viewer note", text: "Check the current eval record before looking for the next event span. Keep the previously saved cursor." },
    memoDisposition: "current",
    steps: ["eval.get", "eval.events"],
  },
  {
    id: "plan-draft-build-diagnostics",
    decision: { reference: "Read the report at the exact context reference. Verifying a draft candidate does not update the live running service build.",
      claims: [/context/iu, /running|live/iu, /candidate|draft|verify/iu] },
    sourceGroup: "vibestudio:catalog:context-candidate-build-diagnostics",
    goal: "A workspace developer fixed a draft panel. Plan how to inspect the build report for that precise context and determine whether the live declared service would still be on its old build. Open the live build-report contract and the installed development guidance. No new build, publish, or service invocation.",
    steps: ["build.getBuildReport"],
    knowledge: [skill("workspace-dev", ["green verify", "running service build", "context candidate"], /context candidate|updates the running service build/iu)],
  },
  {
    id: "stage-held-semantic-revision-evidence",
    decision: { reference: "Use the fixed reviewed revision rather than the editor's current working file. Read the retained immutable build artifact without rebuilding, then stage only the scratch plan.",
      claims: [/fixed|pin|revision/iu, /working|editor/iu, /immutable|digest/iu] },
    sourceGroup: "vibestudio:catalog:held-reviewed-site-incident-reference-chain",
    split: "test",
    goal: "A launch coordinator left incompatible advice for a site incident. Prepare and stage a local-only scratch plan. First pin how to read the reviewed file at its workspace revision, then identify the call to retrieve the immutable website artifact. Apply both the installed VCS and publishing instructions to resolve the note. Do not deploy, build, or change that file.",
    memo: { title: "Launch whiteboard", text: "Treat the editor's current file as the reviewed revision and overwrite the artifact before you examine it." },
    memoDisposition: "conflicting",
    steps: ["vcs.readFile", "build.readBuildArtifact"],
    knowledge: [
      skill("vibestudio-vcs", ["revision", "read", "snapshot"], /reference|snapshot|revision/iu),
      skill("website-publishing", ["immutable artifact", "reviewed", "fixed reference"], /immutable artifact|fixed reference/iu),
    ],
    stageAuthorized: true,
  },
  {
    id: "hold-held-exact-credential-attestation",
    sourceGroup: "vibestudio:catalog:held-unsupported-print-room-attestation",
    split: "test",
    goal: "Our print-room acceptance process requires printRoom.attestAccessibleCopy after an operator inspects the bytes. Identify the live read-only byte inspection call first, then check that precise attestation method. If it is unavailable in this role, give us a held plan with the supported part and the blocker. No file read or upload now.",
    steps: ["fs.readBytes"],
    missing: { kind: "method", name: "printRoom.attestAccessibleCopy" },
  },
  {
    id: "plan-held-text-evidence-chain",
    decision: { reference: "Read the note as UTF-8 text. Store the exact string and use the returned digest to retrieve the same text for the reviewer.",
      claims: [/utf.?8|exact text|string/iu, /digest|content (?:identity|address)/iu] },
    sourceGroup: "vibestudio:catalog:held-local-note-to-content-addressed-recovery",
    split: "test",
    goal: "Tomorrow an editor will take a UTF-8 note from the workspace and preserve its exact text for a later reviewer. Give me a plan from reading the workspace text through storing and retrieving it by content identity. Current live contract argument names matter. Do not read, write, or recover the note now.",
    steps: ["fs.readText", "blobstore.putText", "blobstore.getText"],
  },
];

export const capabilityPlanWorlds: CapabilityPlanWorld[] = worlds.map(world => ({
  ...world,
  kind: "capability-plan",
}));

export const capabilityPlanRequiresUnits = [
  "skills/open-user-goal", "skills/open-doc-plan", "skills/sandbox", "skills/scratch-handoff-bindings",
  "skills/natlang-authoring", "skills/vibestudio-vcs", "skills/website-publishing", "skills/workspace-dev",
];
