import type { AssemblyPlan, ManifestAdjustment } from "@workspace-skills/open-workspace-assembly/types";

export type UnitEdge = { unit: string; mode: "runtime" | "type" | "test"; declaration?: "runtime" | "dev" | "peer" | "optional" | "none"; subpath?: string };
export type UnitSpec = { id: string; label: string; purpose: string; edges: UnitEdge[]; exports?: string[]; broken?: boolean };
export type AssemblyWorld = {
  kind: "workspace-assembly";
  workspace: "examples";
  id: string;
  goal: string;
  sourceGroup: string;
  split?: "test";
  note: string;
  units: UnitSpec[];
  later?: UnitSpec[];
  grantedBuilds?: string[];
  mayStage?: boolean;
  expected: {
    root: string | null;
    include: string[];
    read: string[];
    disposition: AssemblyPlan["disposition"];
    blockers: string[];
    amendment: ManifestAdjustment[];
    builds: { unit: string; result: "ok" | "failed" }[];
    stage: boolean;
    explanation: string;
    claims: RegExp[];
  };
};
const unit = (id: string, label: string, purpose: string, edges: UnitEdge[] = [], extra: Pick<UnitSpec,"exports"|"broken"> = {}): UnitSpec =>
  ({ id, label, purpose, edges, ...extra });
const uses = (unit: string, declaration: UnitEdge["declaration"] = "runtime", subpath?: string): UnitEdge => ({unit,mode:"runtime",declaration,subpath});
const recipe = (root: string | null, include: string[], disposition: AssemblyPlan["disposition"], explanation: string, claims: RegExp[], options: Partial<AssemblyWorld["expected"]> = {}): AssemblyWorld["expected"] =>
  ({root,include,read:include,disposition,blockers:[],amendment:[],builds:[],stage:false,explanation,claims,...options});
const build = (unit: string, result: "ok" | "failed" = "ok") => ({unit,result});
const add = (unit: string, dependency: string): ManifestAdjustment => ({unit,dependency,action:"add-runtime"});
const worlds: Omit<AssemblyWorld, "kind" | "workspace" | "sourceGroup">[] = [
  {
    id: "assembly-transitive-normalization",
    goal: "Prepare a local template draft for the calendar reader that uses the supported date formatter. Include whatever the formatter actually needs for normalization, leave the old demo aside, and verify the reader builds before you save the draft.",
    note: "The current draft drew only the direct calendar-to-formatter dependency.",
    units: [unit("reader","Calendar reader","Workspace calendar card",[uses("formatter")]),unit("formatter","Date formatter","Supported date formatting",[uses("normalize")]),
      unit("normalize","Date normalization","Shared safe date normalization"),unit("demo","Calendar demo","Obsolete stand-alone demonstration")],
    grantedBuilds: ["reader"], mayStage: true,
    expected: recipe("reader",["reader","formatter","normalize"],"ready","The formatter imports normalization, so both belong in the reader's draft. The current reader build passed.",[/normaliz/iu,/formatter/iu,/build|compile/iu],{builds:[build("reader")],stage:true}),
  },
  {
    id: "assembly-shared-leaf-once",
    goal: "For the operations dashboard, prepare a local draft containing the header and row renderers. Both use a shared color package. Verify both renderers and include the shared unit once, without adding independent chart tools.",
    note: "Dashboard components must be usable together in a fresh local composition.",
    units: [unit("dashboard","Operations dashboard","Active dashboard package",[uses("header"),uses("rows")]),unit("header","Header renderer","Workspace dashboard header",[uses("colors")]),
      unit("rows","Row renderer","Workspace dashboard rows",[uses("colors")]),unit("colors","Palette","Shared rendering colors"),unit("charts","Chart tools","Independent renderer")],
    grantedBuilds:["header","rows"], mayStage:true,
    expected: recipe("dashboard",["dashboard","header","rows","colors"],"ready","The renderers both depend on the shared palette, so it appears once. Both renderers built successfully.",[/shared|both/iu,/once|dedup/iu,/palette|color/iu],{builds:[build("header"),build("rows")],stage:true}),
  },
  {
    id: "assembly-runtime-only-test-dependency",
    goal: "Make a local template draft for running the scanner in production. It must keep the parser but should not carry the scanner test comparator. Check the runtime scanner build and tell me which file and manifest category explain the exclusion.",
    note: "Only runtime functionality is in scope. The test comparator stays in the development workspace.",
    units:[unit("scanner","Production scanner","Reads production documents",[uses("parser"),{unit:"comparator",mode:"test",declaration:"dev"}]),unit("parser","Document parser","Production parser"),unit("comparator","Snapshot comparator","Development test helper")],
    grantedBuilds:["scanner"], mayStage:true,
    expected:recipe("scanner",["scanner","parser"],"ready","The comparator is imported by the test file and declared only as a dev dependency. The runtime scanner and parser built.",[/test/iu,/dev/iu,/compar/iu],{read:["scanner","parser","comparator"], builds:[build("scanner")],stage:true}),
  },
  {
    id: "assembly-type-only-build-dependency",
    goal: "I need the exchange adapter's source-build plan. The adapter has no runtime import from schema contracts, but reproducing its typed build matters. Keep the needed source package in the closure, verify the adapter on this revision, and leave everything read-only.",
    note:"The prior packaging sketch confused runtime imports with type resolution at build time.",
    units:[unit("adapter","Exchange adapter","Reads exchange payloads",[{unit:"contracts",mode:"type",declaration:"dev"}]),unit("contracts","Schema contracts","Type-only input contracts")],
    grantedBuilds:["adapter"],
    expected:recipe("adapter",["adapter","contracts"],"ready","The adapter's type import still needs the schema package for a reproducible source build, which passed here.",[/type/iu,/schema|contract/iu,/build/iu],{builds:[build("adapter")]}),
  },
  {
    id: "assembly-missing-declaration-draft-repair",
    goal: "The event rows package imports the supported time label provider, but somebody may have missed the manifest dependency. If the owned provider is present, stage only the minimal scratch manifest repair. Do not modify or build the working packages.",
    note:"The correct provider is the maintained Time labels package, not the old date display.",
    units:[unit("events","Event rows","Current event renderer",[uses("labels","none")]),unit("labels","Time labels","Supported time-label provider"),unit("legacy","Legacy dates","Obsolete display provider")],
    mayStage:true,
    expected:recipe("events",["events","labels"],"draft-repair","The source imports Time labels but the manifest has no runtime declaration. Add only that provider in the scratch draft.",[/import/iu,/manifest|declara/iu,/scratch|draft/iu],{blockers:["undeclared-dependency"],amendment:[add("events","labels")],stage:true}),
  },
  {
    id: "assembly-provider-not-installed",
    goal: "Check whether the local caption worker can be assembled with the required caption dictionary. If it isn't present, hold rather than substituting the similarly named glossary. Do not build or draft from an incomplete closure.",
    note:"Caption dictionaries and glossaries carry different data. Similar names do not imply compatibility.",
    units:[unit("worker","Caption worker","Active caption lookup",[uses("dictionary")]),unit("glossary","Caption glossary","Unrelated copywriting glossary")],
    expected:recipe("worker",["worker"],"hold","The manifest and source require the caption dictionary, which is absent. The glossary cannot substitute.",[/dictionary/iu,/absent|missing/iu,/glossary|substitut/iu],{blockers:["missing-dependency"]}),
  },
  {
    id: "assembly-already-current-no-draft",
    goal: "Determine whether the voicemail parser needs any rollout edits. If the current parser is already declared with its required protocol package and no package changes are needed, report that and leave no draft or build.",
    note:"This is a no-change decision check before the iteration planning meeting.",
    units:[unit("parser","Voicemail parser","Voice message decoding",[uses("protocol")]),unit("protocol","Voice protocol","Current decoding contract")],
    expected:recipe("parser",["parser","protocol"],"unchanged","The required protocol already has a matching manifest declaration and import. No rollout edit is needed.",[/protocol/iu,/already|unchanged|no .*edit/iu]),
  },
  {
    id: "assembly-old-review-changed-summary-source",
    goal: "I reviewed the metrics summary candidate earlier. Make a local draft only if that exact approved revision is still current. It is not enough that the metrics package has the same name. Hold the draft and tell me what changed if the approval is stale.",
    note:"The operator authorizes a local draft only for the previously reviewed complete semantic state.",
    units:[unit("summary","Metrics summary","Approved metrics note",[uses("formatter")]),unit("formatter","Metrics formatter","Approved formatter"),unit("detail","Detail formatter","Alternative formatting package")],
    later:[unit("summary","Metrics summary","Approved metrics note",[uses("detail")])],mayStage:true,
    expected:recipe("summary",["summary","detail"],"hold","The current summary imports Detail formatter and the semantic revision differs from the approved one. The prior approval is stale.",[/detail/iu,/revision|head/iu,/stale|changed/iu],{blockers:["review-changed"]}),
  },
  {
    id: "assembly-native-build-failure-retains-proof",
    goal: "Check the current rate estimator release candidate. Its dependencies may all be declared, but there is a suspected type error. Run the native build for the owned estimator and give the exact disposition from the build evidence. Hold any draft on failure.",
    note:"Dependency closure alone does not prove a release candidate compiles.",
    units:[unit("estimator","Rate estimator","Current rate inference",[uses("types")],{broken:true}),unit("types","Estimator types","Current estimator contract")],
    grantedBuilds:["estimator"],mayStage:true,
    expected:recipe("estimator",["estimator","types"],"hold","The dependency is declared, but the native build found a type error. The candidate is held and no draft was written.",[/type/iu,/build|compile/iu,/hold|held|fail/iu],{blockers:["build-failed"],builds:[build("estimator","failed")]}),
  },
  {
    id: "assembly-subpath-export-contract",
    goal: "The handoff loader imports the marker from the Beacon package's compat subpath. Draft the smallest local template set after confirming that export points at the actual compatibility file. Verify the loader build.",
    note:"Do not include the separate Beacon developer notes package.",
    units:[unit("loader","Handoff loader","Loads the compatible marker",[uses("beacon","runtime","compat")]),unit("beacon","Beacon","Current beacon implementation",[],{exports:["compat"]}),unit("notes","Beacon notes","Maintainer docs tools")],
    grantedBuilds:["loader"],mayStage:true,
    expected:recipe("loader",["loader","beacon"],"ready","The Beacon manifest exports its compat file, and the loader's exact import builds. Only loader and Beacon belong in the local draft.",[/compat/iu,/export/iu,/build|compile/iu],{builds:[build("loader")],stage:true}),
  },
  {
    id: "assembly-subpath-not-public",
    goal: "An archived plan imports the emitter's experimental helper by a package subpath. Inspect the actual manifest rather than guessing from its filename. If the current exporter does not expose it, leave things alone and name the blocker.",
    note:"Private files do not become public exports automatically.",
    units:[unit("preview","Preview emitter consumer","Preview helper",[uses("emitter","runtime","experimental")]),unit("emitter","Emitter","Stable emitter",[],{exports:["stable"]})],
    expected:recipe("preview",["preview","emitter"],"hold","The required experimental subpath is not exported from Emitter, even though another export exists.",[/experimental/iu,/export/iu],{blockers:["export-unavailable"]}),
  },
  {
    id: "assembly-optional-unused-by-model-target",
    goal: "Draft the compact kiosk composition that can run without the optional screenshot bridge. Include the card adapter the kiosk imports, but keep the unused optional component out. Do not run builds during this review.",
    note:"The optional screenshot bridge supports only a separate developer workflow.",
    units:[unit("kiosk","Kiosk package","Compact retail workspace",[uses("card"),{unit:"screenshot",mode:"test",declaration:"optional"}]),unit("card","Card adapter","Used by Kiosk"),unit("screenshot","Screenshot bridge","Optional developer module")],
    mayStage:true,
    expected:recipe("kiosk",["kiosk","card"],"ready","The runtime kiosk imports Card, while Screenshot is optional and appears only outside runtime source. The draft contains the kiosk and card.",[/optional/iu,/screenshot/iu,/card/iu],{read:["kiosk","card","screenshot"],stage:true}),
  },
  {
    id: "assembly-required-peer-at-composition-boundary",
    goal: "Plan a runnable composition for the status plug-in. Its runtime host contract is declared as a peer rather than a regular dependency. Ensure the hosting package actually accompanies this local draft, and do not bundle the developer utility.",
    note:"The consumer supplies required peer packages at installation.",
    units:[unit("plugin","Status plug-in","Reports project status",[uses("host","peer"),{unit:"utility",mode:"test",declaration:"dev"}]),unit("host","Status host","Peer implementing shared host capability"),unit("utility","Status utility","Developer-only helper")],
    mayStage:true,
    expected:recipe("plugin",["plugin","host"],"ready","The plug-in uses Status host as a required peer, so the local composition supplies it. Developer utility remains excluded.",[/peer/iu,/host/iu,/utility|develop/iu],{read:["plugin","host","utility"],stage:true}),
  },
  {
    id: "assembly-hold-graph-cycle",
    goal: "Review the formatter and rules package proposed for a minimal offline startup. The rollout forbids a dependency loop during boot. Identify a real cycle in manifest and source if one exists, then hold without building or writing.",
    note:"The offline boot plan requires an acyclic dependency graph.",
    units:[unit("formatter","Offline formatter","Offline formatting",[uses("rules")]),unit("rules","Boot rules","Boot-time rules",[uses("formatter")])],
    expected:recipe("formatter",["formatter","rules"],"hold","Offline formatter and Boot rules import each other, which is a forbidden dependency cycle.",[/cycle|loop/iu,/each other|both|rules/iu],{blockers:["dependency-cycle"]}),
  },
  {
    id: "assembly-same-label-select-supported-contract",
    goal: "The support tool needs the printer package intended for accessible public handoffs. There are two similarly named candidates. Find the accessible one, prove its appendix dependency, and build just that one. Leave no scratch file.",
    note:"A label match is insufficient when public and internal release printer contracts differ.",
    units:[unit("internal","Release printer","Internal staff proofing",[uses("raw")]),unit("public","Release printer","Accessible public handoff",[uses("appendix")]),
      unit("raw","Raw thermal labels","Internal printer helper"),unit("appendix","Accessible appendix","Public handoff attachments")],
    grantedBuilds:["public","internal"],
    expected:recipe("public",["public","appendix"],"ready","The accessible public candidate uses the appendix and built successfully. The similarly named internal proofing candidate is outside scope.",[/accessib|public/iu,/appendix/iu,/internal/iu],{read:["public","appendix","internal"],builds:[build("public")]}),
  },
  {
    id: "assembly-held-revision-new-blocker",
    split:"test",
    goal: "Only stage the authorized draft if the exact reviewed audit-label source is still current and still resolves its service annotation package. If the new workspace state broke that assumption, keep it read-only and report both the revision drift and the new dependency blocker.",
    note:"Prior signoff covered the original Annotation package binding.",
    units:[unit("audit","Audit labels","Produces audit labels",[uses("annotation")]),unit("annotation","Service annotation","Original annotation provider")],
    later:[unit("audit","Audit labels","Produces audit labels",[uses("annotation-v2")])],mayStage:true,
    expected:recipe("audit",["audit"],"hold","The review head changed and the current manifest now imports the unavailable Annotation v2 dependency. No draft is authorized for that basis.",[/head|revision/iu,/annotation/iu,/missing|unavailable/iu],{blockers:["missing-dependency","review-changed"]}),
  },
  {
    id: "assembly-held-thin-versus-source-toolkit",
    split:"test",
    goal: "We are assembling the reproducible source bundle for inventory tags. Inspect the private type contract and the test data writer separately. The type source is required even with no runtime reference; keep test data tooling out. Verify the tags package and stage a local source plan.",
    note:"Criteria distinguish source build inputs from test-only tools.",
    units:[unit("tags","Inventory tags","Current inventory markers",[{unit:"contract",mode:"type",declaration:"dev"},{unit:"writer",mode:"test",declaration:"dev"}]),
      unit("contract","Inventory type contract","Validation type dependency"),unit("writer","Inventory data writer","Fixture-only test dependency")],
    grantedBuilds:["tags"],mayStage:true,
    expected:recipe("tags",["tags","contract"],"ready","A type import needs the contract for a clean source build, while the writer is test-only. The build passed and the local plan excludes the writer.",[/type/iu,/writer/iu,/test|fixture/iu],{read:["tags","contract","writer"],builds:[build("tags")],stage:true}),
  },
  {
    id: "assembly-held-approved-repair-not-an-applied-change",
    split:"test",
    goal: "Inspect the actual label-preview manifest and its scoring helper import. We authorize only a local proposal if that helper is installed but missing from dependencies. Keep the production label package out of this repair, do not build, and verify the saved draft leaves the managed manifest untouched.",
    note:"The preview and production packages are both present. The production version is already reviewed.",
    units:[unit("preview","Label preview","Preview-only renderer",[uses("score","none")]),unit("stable","Production labels","Deployed reviewed label renderer",[uses("score")]),
      unit("score","Label scoring helper","Supported scoring input")],
    mayStage:true,
    expected:recipe("preview",["preview","score"],"draft-repair","Preview imports the scoring helper without a runtime declaration. Only a scratch amendment is allowed, and production and the managed manifests are unchanged.",[/preview/iu,/scor/iu,/scratch|draft|proposal/iu],{read:["preview","score","stable"],blockers:["undeclared-dependency"],amendment:[add("preview","score")],stage:true}),
  },
  {
    id: "assembly-ambiguous-approval-no-provider-choice",
    goal: "I need a rollout plan for the regional digest writer, but my note does not state which active regional output is approved. Both candidates might be legitimate. Inspect their real package purposes and dependencies. Leave the workspace read-only if the current brief does not select a region.",
    note:"Either regional compatibility route is operational. This note contains no approved region or output contract.",
    units:[unit("east","Regional digest writer","Eastern regional policy output",[uses("eastpolicy")]),
      unit("west","Regional digest writer","Western regional policy output",[uses("westpolicy")]),
      unit("eastpolicy","Eastern policy","Eastern regional policy contract"),unit("westpolicy","Western policy","Western regional policy contract")],
    expected:recipe(null,[],"hold","The current brief does not select an approved region. The two writers use distinct Eastern and Western policy contracts, so no candidate can be chosen.",[/region/iu,/east/iu,/west/iu],{read:["east","west","eastpolicy","westpolicy"],blockers:["candidate-unavailable"]}),
  },
  {
    id: "assembly-held-one-component-build-does-not-approve-all",
    split:"test",
    goal: "Review the local gallery bundle for a paired renderer handoff. Verify the color renderer first and the preview footer second. Do not stage the requested bundle if either selected source build fails, and identify which native outcome governs the hold.",
    note:"The rollout is approved only after both independent attached packages build at the same source state.",
    units:[unit("gallery","Gallery bundle","Paired rollout package",[uses("palette"),uses("footer")]),
      unit("palette","Color renderer","Public palette"),unit("footer","Preview footer","Public gallery footer",[],{broken:true})],
    grantedBuilds:["palette","footer"],mayStage:true,
    expected:recipe("gallery",["gallery","palette","footer"],"hold","The independent color renderer built, but the native footer build reported a type error. The paired draft remains held.",[/color|palette/iu,/footer/iu,/hold|held|fail/iu],{blockers:["build-failed"],builds:[build("palette"),build("footer","failed")]}),
  },

];
export const openAssemblyWorlds: AssemblyWorld[] = worlds.map(world => ({
  ...world, kind:"workspace-assembly",workspace:"examples",sourceGroup:`vibestudio:open-assembly:${world.id}`,
}));

export const openAssemblyRequiresUnits = ["skills/open-user-goal","skills/open-workspace-assembly","skills/workspace-dev","skills/scratch-handoff-bindings"];
