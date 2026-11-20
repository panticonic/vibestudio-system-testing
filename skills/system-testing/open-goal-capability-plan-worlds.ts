type SkillEvidence = { dirPath: string; focus: string[]; supports: RegExp };

export type CapabilityPlanWorld = {
  kind: "capability-plan";
  workspace: "examples";
  id: string;
  goal: string;
  sourceGroup: string;
  split?: "test";
  memo?: { title: string; text: string };
  decision: { reference: string; claims: RegExp[] };
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

const worlds: Omit<CapabilityPlanWorld, "kind" | "workspace">[] = [
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
    decision: { reference: "Pin the reviewed source to a fixed reference before building. The packet should read the immutable artifact manifest. Publishing now goes beyond this review.",
      claims: [/fixed|pin|revision/iu, /immutable|digest/iu, /publish|deploy|review/iu] },
    sourceGroup: "vibestudio:catalog:immutable-site-package",
    goal: "I am preparing a website review packet. Identify the next main RPC to build the website and the one that later reads its immutable artifact manifest. Apply the installed publishing guidance about the source reference. The desk note says to publish straight from the changing workspace. Compare that instruction with this review-only request and don't build or publish anything.",
    memo: { title: "Desk note", text: "Publish directly from whatever is currently in the workspace. A fixed review is unnecessary." },
    memoDisposition: "conflicting",
    steps: ["build.buildWebsite", "build.getBuildArtifacts"],
    knowledge: [skill("website-publishing", ["fixed reference", "immutable", "reviewed"], /fixed reference|immutable artifact/iu)],
  },
  {
    id: "plan-call-contract-introspection",
    decision: { reference: "Open the ID to determine whether it is currently visible, then fetch just the typed argument and return schema for that same ID.",
      claims: [/visible|exist|available/iu, /schema/iu, /same (?:ID|entry)|that (?:ID|entry)|capability ID/iu] },
    sourceGroup: "vibestudio:catalog:typed-docs-introspection",
    goal: "Our SDK generator needs a read-only plan for checking whether a capability ID exists, followed by fetching only its JSON Schema. Identify the two live catalog calls the generator should use in order and show their exact argument names. Please don't generate files.",
    steps: ["docs.describe", "docs.getSchema"],
  },
  {
    id: "plan-visible-service-inventory",
    decision: { reference: "Use the role-filtered service list for the number of services and the surface inventory for entry counts. The two totals measure different things.",
      claims: [/service/iu, /surface/iu, /role|caller|visible/iu] },
    sourceGroup: "vibestudio:catalog:role-visible-service-inventory",
    goal: "I'm updating an onboarding note about the role we're currently using. Report the actual number of visible RPC services and the current per-surface entry counts. Include representative service names and identify the two catalog calls that would refresh those two different counts. No copy to the repo.",
    steps: ["docs.listServices", "docs.listSurfaces"],
    inventory: true,
  },
  {
    id: "plan-installed-knowledge-discovery",
    decision: { reference: "Choose from the current installed index and pass the canonical directory path of that entry to the read call. In this context use Testkit for the direct assertion and System Testing when a model must judge.",
      claims: [/directory|dirPath|canonical/iu, /direct|determinist|assert/iu, /model|system.testing/iu] },
    sourceGroup: "vibestudio:catalog:ambient-skill-index-lookup",
    goal: "A, B, and C button labels can be asserted directly, but our second acceptance criterion requires a model to interpret an operator's request. Find the installed Testkit guidance and plan which runner serves each criterion. Identify the current live calls that enumerate installed skills and retrieve a selected exact guide, with their parameter names. Do not run either test.",
    steps: ["workspace.listSkills", "workspace.readSkill"],
    knowledge: [{ dirPath: "packages/testkit", focus: ["deterministic", "asserted directly", "interpret instructions"], supports: /can be asserted directly|model must/iu }],
  },
  {
    id: "hold-archive-verifier-plan",
    decision: { reference: "The exact verifier shiftArchive.verifyPackedNote returned no description for this role. The checklist depends on it, so hold the plan.",
      claims: [/verifyPackedNote/iu, /role|caller|workspace/iu, /hold|block|unavailable|absent/iu] },
    sourceGroup: "vibestudio:catalog:required-obsolete-archive-verifier",
    goal: "A migration acceptance checklist explicitly requires shiftArchive.verifyPackedNote. Check whether that exact method is available in this workspace role. If it isn't, stop and give us the blocker instead of substituting a different verifier. No changes or handoff.",
    steps: [],
    missing: { kind: "method", name: "shiftArchive.verifyPackedNote" },
  },
  {
    id: "hold-required-installed-runbook",
    decision: { reference: "The required facilities-release-approver skill is absent from the installed workspace index. The onboarding plan depends on it and must wait.",
      claims: [/facilities-release-approver/iu, /installed|index|inventory/iu, /absent|missing|unavailable|depend|wait/iu] },
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
    goal: "A workspace developer fixed a draft panel. Plan how to inspect the build report for that precise context and determine whether the live declared service would still be on its old build. Open the live build-report contract and the installed development guidance. Do not build, publish, or invoke the service during this review.",
    steps: ["build.getBuildReport"],
    knowledge: [skill("workspace-dev", ["green verify", "running service build", "context candidate"], /context candidate|updates the running service build/iu)],
  },
  {
    id: "stage-held-semantic-revision-evidence",
    decision: { reference: "Use the fixed reviewed revision rather than the editor's current working file. Read the retained immutable build artifact manifest without rebuilding, then stage only the scratch plan.",
      claims: [/fixed|pin|revision/iu, /working|editor/iu, /immutable|digest/iu] },
    sourceGroup: "vibestudio:catalog:held-reviewed-site-incident-reference-chain",
    split: "test",
    goal: "A launch coordinator left incompatible advice for a site incident. Prepare and stage a local-only scratch plan. First pin how to read the reviewed file at its workspace revision, then identify the call to retrieve the immutable website artifact manifest. Apply both the installed VCS and publishing instructions to resolve the note. Do not deploy, build, or change that file.",
    memo: { title: "Launch whiteboard", text: "Treat the editor's current file as the reviewed revision and overwrite the artifact before you examine it." },
    memoDisposition: "conflicting",
    steps: ["vcs.readFile", "build.getBuildArtifacts"],
    knowledge: [
      skill("vibestudio-vcs", ["revision", "read", "snapshot"], /reference|snapshot|revision/iu),
      skill("website-publishing", ["immutable artifact", "reviewed", "fixed reference"], /immutable artifact|fixed reference/iu),
    ],
    stageAuthorized: true,
  },
  {
    id: "hold-held-exact-credential-attestation",
    decision: { reference: "A bounded byte read is supported. The exact printRoom.attestAccessibleCopy method is unavailable for this role, so the resulting plan is held.",
      claims: [/byte/iu, /attestAccessibleCopy/iu, /hold|held|unavailable|block/iu] },
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
  {
    id: "plan-semantic-file-provenance-chain",
    sourceGroup: "vibestudio:catalog:reproducible-semantic-repository-lookup",
    goal: "I have only the repo-relative path of a workspace guide and a fixed review revision. Plan how to resolve the repository at that semantic state and read the file at the same state. Use the installed VCS guidance to distinguish semantic history from an ordinary Git checkout. Cite the exact source revision of that guidance.",
    steps: ["vcs.resolveRepository", "vcs.readFile"],
    knowledge: [skill("vibestudio-vcs", ["semantic history", "git worktree", "managed reads"], /semantic history|Git worktree/iu)],
    decision: { reference: "Resolve the repository at the named semantic revision, then read the file at the same immutable state. Managed history is semantic rather than an ordinary Git checkout.",
      claims: [/same|fixed|immutable/iu, /semantic/iu, /repositor/iu] },
  },
  {
    id: "plan-blame-backed-quote-range",
    sourceGroup: "vibestudio:catalog:bounded-current-quote-provenance",
    goal: "A reviewer asked us to track the rationale for a specific current text range without reading the entire repository. Find the workspace text-read contract that returns a content hash and range, then the method for bounded blame-backed memory for those exact bytes. Give a read-only plan.",
    steps: ["fs.readText", "vcs.readMemory"],
    decision: { reference: "Read the bounded text to obtain its exact range and content hash. Use those same coordinates and hash when requesting blame-backed memory.",
      claims: [/hash/iu, /range|coordinate/iu, /blame|memory/iu] },
  },
  {
    id: "plan-ambiguous-unit-cache-review",
    sourceGroup: "vibestudio:catalog:draft-versus-cached-build-provenance",
    goal: "We have two units with the same basename and an architect wants cached metadata for the reviewed one. Find the live call that can report ambiguity and immutable build keys, then the one that reads metadata for the selected key. Use the installed developer guide to explain whether a green context build proves the running service changed.",
    steps: ["build.inspectBuildProvenance", "build.getBuildMetadata"],
    knowledge: [skill("workspace-dev", ["green verify", "running service build", "context candidate"], /context candidate|updates the running service build/iu)],
    decision: { reference: "Resolve the exact unit when the basename is ambiguous and retain an immutable build key for metadata. A context candidate verification does not change the running build.",
      claims: [/ambigu|basename/iu, /immutable|key/iu, /running|live/iu] },
  },
  {
    id: "plan-worker-panel-owner-bounded-lookup",
    sourceGroup: "vibestudio:catalog:worker-panel-self-owner-query",
    goal: "A Worker needs to find only its current verified human subject's root panels. Everyone is suggesting the ownership-band inventory. Find the portable runtime call limited to the current subject and show its real signature and paging argument. No panel read or cross-owner lookup yet.",
    steps: ["runtime:workerRuntime.panelTree.roots"],
    decision: { reference: "Use the Worker-runtime roots call for the current verified subject. The bounded page input carries a cursor and limit without an owner identity.",
      claims: [/verified|subject|current/iu, /page|cursor|limit/iu] },
  },
  {
    id: "plan-reopen-exact-panel-handle",
    sourceGroup: "vibestudio:catalog:portable-runtime-search-handle-restoration",
    goal: "A workstation utility needs to discover panel matches by name and persist just each slot ID. When it starts again it needs a synchronous runtime handle for one exact ID. Identify both concrete Worker-runtime members and their typed signatures in order. This is a plan and should not open any panel.",
    steps: ["runtime:workerRuntime.panelTree.search", "runtime:workerRuntime.panelTree.get"],
    decision: { reference: "Use the runtime search for matching entries. Persist the exact slot ID and reconstruct a synchronous handle from that ID on restart.",
      claims: [/slot|identity|ID/iu, /synchronous|handle/iu, /restart|persist|recover/iu] },
  },
  {
    id: "plan-ready-renderer-not-committed-slot",
    sourceGroup: "vibestudio:catalog:worker-readiness-versus-durable-panel-admission",
    goal: "A Worker integration needs to wait for a panel to boot before connecting to it. Another team suggested merely committing its slot. Compare the two actual portable runtime contracts with exact source signatures. Use the installed developer guide's context-ref rule. Don't create a panel.",
    steps: ["runtime:workerRuntime.createPanelSlot", "runtime:workerRuntime.openPanel"],
    knowledge: [skill("workspace-dev", ["panel", "explicit context ref", "unpublished source"], /explicit context ref|panels? need an explicit/iu)],
    decision: { reference: "A committed slot alone does not establish readiness. Use the boot-ready runtime open operation with the explicit context reference when reviewing unpublished panel code.",
      claims: [/boot|ready/iu, /slot|commit/iu, /context|unpublished/iu] },
  },
  {
    id: "stage-provenance-plan-for-reviewable-candidate",
    sourceGroup: "vibestudio:catalog:owned-semantic-guide-candidate-handoff",
    goal: "Write a local scratch plan for comparing draft guidance to protected main. Start with the live method that identifies the main event, then the method for comparing semantic states. Use the installed VCS skill to explain why this is read-only even if it finds divergence, and pin the exact revision of the cited guide in the handoff.",
    steps: ["vcs.mainState", "vcs.compare"],
    knowledge: [skill("vibestudio-vcs", ["compare", "read-only", "intent"], /Compare is read-only|read-only preview/iu)],
    stageAuthorized: true,
    decision: { reference: "Identify the protected main event and compare at exact semantic references. Comparison is read-only and divergence does not authorize a merge.",
      claims: [/main (?:event|state)|protected main/iu, /read.only/iu, /compare|comparison/iu] },
  },
  {
    id: "hold-hidden-artifact-stream-in-current-role",
    sourceGroup: "vibestudio:catalog:real-role-hidden-artifact-streaming",
    goal: "The contract for our viewer requires build.readBuildArtifact, not merely the content-free artifact manifest. Check whether the exact streaming method is visible in this role. Capture the useful live manifest contract as a partial plan, and hold the viewer work if direct streaming is unavailable. No build or artifact operation now.",
    steps: ["build.getBuildArtifacts"],
    missing: { kind: "method", name: "build.readBuildArtifact" },
    decision: { reference: "The role can obtain an immutable artifact manifest. The necessary direct streaming method is hidden from this catalog, so viewer work remains held.",
      claims: [/manifest/iu, /stream|readBuildArtifact/iu, /unavailable|hidden|hold|held/iu] },
  },
  {
    id: "plan-held-runtime-installed-repo-selection",
    sourceGroup: "vibestudio:catalog:held-worker-explicit-skill-canonical-repo",
    split: "test",
    goal: "The acceptance runner is compiled for the portable Worker runtime. Its next step will list installed skills and open one chosen package guide by the canonical directory path. Identify the exact portable runtime members and tell the maintainer why a package-level guide can be selected by assertion needs rather than a guessed skill name. Read the installed Testkit guidance without running anything.",
    steps: ["runtime:workerRuntime.workspace.listSkills", "runtime:workerRuntime.workspace.readSkill"],
    knowledge: [{ dirPath: "packages/testkit", focus: ["deterministic", "asserted directly", "interpret instructions"], supports: /can be asserted directly|model\s+must/iu }],
    decision: { reference: "Use the portable Worker workspace index for the exact canonical directory path. The installed Testkit package applies when behavior can be directly asserted.",
      claims: [/canonical|directory|dirPath/iu, /assert|deterministic/iu, /package|testkit/iu] },
  },
  {
    id: "plan-held-cross-owner-page-contract",
    sourceGroup: "vibestudio:catalog:held-worker-selected-visible-owner-band",
    split: "test",
    goal: "A supervisor is writing a Worker-side plan to inspect one explicitly requested ownership band. Identify which portable runtime method lists visible bands and which pages the selected band, including their exact parameter names. The band ID must come from the first result, and this review grants no panel access.",
    steps: ["runtime:workerRuntime.panelTree.rootOwners", "runtime:workerRuntime.panelTree.rootsForOwner"],
    decision: { reference: "Read the visibility-filtered owner bands and use one returned owner ID to page roots for that owner. The documentation does not authorize a wider inspection.",
      claims: [/owner/iu, /returned|first|visible/iu, /page|cursor/iu] },
  },
  {
    id: "stage-held-authored-program-versus-transport-receipt",
    sourceGroup: "vibestudio:catalog:held-authored-contract-versus-terminal-eval-evidence",
    split: "test",
    goal: "Prepare a scratch-only maintainer handoff. Read the installed Natlang authoring guidance on compiling a callable without running it. Then identify the two live calls for finding a previous eval's terminal record and its retained receipt. The handoff must pin the guide's exact source revision. No new eval or program changes.",
    steps: ["eval.get", "eval.receipt"],
    knowledge: [skill("natlang-authoring", ["compile", "describe", "Nothing runs"], /Nothing runs|Compiles the program/iu)],
    stageAuthorized: true,
    decision: { reference: "A Natlang compile-only description does not execute it. The prior eval record and retained receipt provide existing execution evidence, which I can stage in local scratch.",
      claims: [/compile|describe/iu, /receipt/iu, /prior|existing|retain/iu] },
  },

];

export const capabilityPlanWorlds: CapabilityPlanWorld[] = worlds.map(world => ({
  ...world,
  kind: "capability-plan",
  workspace: "examples",
}));

export const capabilityPlanRequiresUnits = [
  "skills/open-user-goal", "skills/open-doc-plan", "skills/sandbox", "skills/scratch-handoff-bindings",
  "skills/natlang-authoring", "skills/vibestudio-vcs", "skills/website-publishing", "skills/workspace-dev", "packages/testkit",
];
