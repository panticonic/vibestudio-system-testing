type Route = { id: string; target: string; suite: string; purpose: string };
export type SuiteSelection = { routeId: string; mode: "inspect" | "verify"; file: string | null; testName: string | null };
type SuiteExpected = { choice: SuiteSelection; runtime: "native" | "workerd" | "browser"; status?: "passed" | "no-tests" };

const adapter = { id: "adapter", target: "extensions/test-runner", suite: "native",
  purpose: "Native workspace test adapter process isolation and module selection" };
const adventure = { id: "adventure", target: "packages/adventure-engine", suite: "world",
  purpose: "Adventure story state transitions under the workspace runtime" };
const grimoire = { id: "grimoire", target: "packages/grimoire-engine", suite: "native",
  purpose: "Grimoire story state and turn transitions" };
const regency = { id: "regency", target: "packages/regency-engine", suite: "native",
  purpose: "Regency realm state, advisor perspectives, and validated conversational turns" };
const missionStore = { id: "mission-store", target: "workers/mission-control-store", suite: "native-contract",
  purpose: "Durable mission cards, concurrent edits, dependencies, history and lifecycle" };
const missionAgent = { id: "mission-agent", target: "workers/mission-agent", suite: "native-contract",
  purpose: "Agent integration with canonical task automations and lost-link recovery" };
const missionContract = { id: "mission-contract", target: "packages/mission-control", suite: "native-contract",
  purpose: "Shared mission input validation, calendar data and execution charter" };
const missionForms = { id: "mission-forms", target: "panels/mission-control", suite: "native-ui",
  purpose: "Mission form interaction, dirty drafts, save retries, and repository selection" };
const tourPanel = { id: "tour-panel", target: "panels/tour", suite: "browser",
  purpose: "Browser rendering and interaction for the Product Tour" };
const modelGateway = { id: "model-gateway", target: "workers/model-gateway", suite: "native",
  purpose: "Native inference gateway turn routing, model readiness and cancellation" };
const records = { id: "natlang-records", target: "workers/natlang-records", suite: "native",
  purpose: "Retained Natlang call records, annotation, paging and run lineage" };
const images = { id: "images", target: "workers/images", suite: "native",
  purpose: "Image jobs, provider attempt lifecycle, retained output and cleanup" };
const choice = (routeId: string, mode: SuiteSelection["mode"], file: string | null = null,
                testName: string | null = null): SuiteSelection => ({ routeId, mode, file, testName });

export type SuiteGoalWorld = {
  kind: "suite";
  id: string;
  goal: string;
  sourceGroup: string;
  split?: "test";
  workspace?: "personal" | "system";
  routes: Route[];
  execution?: { routeId: string; file: string; runtime: "native" | "workerd" };
  expected: SuiteExpected;
};

export const suiteGoalWorlds: readonly SuiteGoalWorld[] = [
  {
    kind: "suite", id: "explain-native-adapter-approval",
    goal: "I need to brief a teammate on which runner would exercise the native test adapter and whether it would need approval. Inspect the workspace declaration and leave the suites untouched.",
    sourceGroup: "vibestudio:workspace-verification:native-adapter",
    routes: [adventure, adapter],
    expected: { choice: choice("adapter", "inspect"), runtime: "native" },
  },
  {
    kind: "suite", id: "verify-adapter-selected-module",
    goal: "Run the native adapter check named “executes selected modules in a child” from index.test.ts. Tell me if the focused check passed and retain the real result receipt.",
    sourceGroup: "vibestudio:workspace-verification:native-adapter",
    routes: [adventure, adapter],
    execution: { routeId: "adapter", file: "index.test.ts", runtime: "native" },
    expected: { choice: choice("adapter", "verify", "index.test.ts", "executes selected modules in a child"),
      runtime: "native", status: "passed" },
  },
  {
    kind: "suite", id: "check-requested-adapter-retry-regression",
    goal: "Can this workspace actually verify the native adapter regression called “preserves module diagnostics after a retry”? Try that exact filter in index.test.ts and tell me whether it exercised a test.",
    sourceGroup: "vibestudio:workspace-verification:native-adapter",
    routes: [adapter, adventure],
    execution: { routeId: "adapter", file: "index.test.ts", runtime: "native" },
    expected: { choice: choice("adapter", "verify", "index.test.ts", "preserves module diagnostics after a retry"),
      runtime: "native", status: "no-tests" },
  },
  {
    kind: "suite", id: "identify-adventure-test-runtime",
    goal: "Which runtime is declared for Adventure Engine story-state checks, and would it use native code approval? I only need to plan the verification today.",
    sourceGroup: "vibestudio:workspace-verification:adventure-world",
    routes: [adapter, adventure],
    execution: { routeId: "adventure", file: "src/index.workerd.test.ts", runtime: "workerd" },
    expected: { choice: choice("adventure", "inspect"), runtime: "workerd" },
  },
  {
    kind: "suite", id: "verify-adventure-world-state",
    goal: "Run the Adventure Engine world-state verification in src/index.workerd.test.ts. Report whether it actually ran tests, which runtime ran them, and the verified result.",
    sourceGroup: "vibestudio:workspace-verification:adventure-world",
    routes: [adapter, adventure],
    expected: { choice: choice("adventure", "verify", "src/index.workerd.test.ts"), runtime: "workerd", status: "passed" },
  },
  {
    kind: "suite", id: "plan-grimoire-turn-verification", split: "test",
    goal: "Before we change Grimoire's turn transitions, tell me how this workspace declares its tests and whether execution requires native approval. This is a planning review, so leave all suites unrun.",
    sourceGroup: "vibestudio:workspace-verification:grimoire-routes",
    routes: [regency, grimoire],
    expected: { choice: choice("grimoire", "inspect"), runtime: "native" },
  },
  {
    kind: "suite", workspace: "personal", id: "plan-durable-mission-card-check",
    goal: "I'm reviewing how Personal brings mission boards back after a restart. Find the declared test suite for persistence of cards and saved views and tell me which approval running it would take. I need the handoff now and will run it later.",
    sourceGroup: "vibestudio:personal:durable-mission-state",
    routes: [missionForms, missionStore, missionAgent],
    expected: { choice: choice("mission-store", "inspect"), runtime: "native" },
  },
  {
    kind: "suite", workspace: "personal", id: "verify-human-edit-survives-stale-mission-save",
    goal: "Two operators may update the same mission. Before we trust the board in tomorrow's handover, check the regression titled “rejects stale edits without losing unrelated human changes” in the store's index.test.ts and report the result.",
    sourceGroup: "vibestudio:personal:durable-mission-state",
    routes: [missionContract, missionStore, missionForms],
    execution: { routeId: "mission-store", file: "index.test.ts", runtime: "native" },
    expected: { choice: choice("mission-store", "verify", "index.test.ts", "rejects stale edits without losing unrelated human changes"),
      runtime: "native", status: "passed" },
  },
  {
    kind: "suite", workspace: "personal", id: "verify-mission-automation-after-lost-link",
    goal: "A failed linking response made a colleague think their recurring task needs a new schedule. Run the one Mission Agent test in index.test.ts named “recovers an existing task default after a lost linkage without creating or editing its schedule”. Retain the receipt before I advise them.",
    sourceGroup: "vibestudio:personal:mission-agent-relink",
    routes: [missionAgent, missionStore, missionContract],
    execution: { routeId: "mission-agent", file: "index.test.ts", runtime: "native" },
    expected: { choice: choice("mission-agent", "verify", "index.test.ts", "recovers an existing task default after a lost linkage without creating or editing its schedule"),
      runtime: "native", status: "passed" },
  },
  {
    kind: "suite", workspace: "personal", id: "check-failed-save-keeps-mission-draft",
    goal: "A presenter needs to know whether the Mission Control form keeps the draft when saving fails. Run the focused check “retains a failed save as a dirty, retryable draft” from forms.test.tsx and tell me what the workspace actually verified.",
    sourceGroup: "vibestudio:personal:mission-form-retry",
    routes: [missionStore, missionForms, tourPanel],
    execution: { routeId: "mission-forms", file: "forms.test.tsx", runtime: "native" },
    expected: { choice: choice("mission-forms", "verify", "forms.test.tsx", "retains a failed save as a dirty, retryable draft"),
      runtime: "native", status: "passed" },
  },
  {
    kind: "suite", workspace: "personal", id: "route-tour-browser-checks", split: "test",
    goal: "I want to budget the right runner for the Product Tour's rendered scenes in Personal. Locate the suite for the actual Tour UI, identify its runtime and whether it uses native test approval, and leave verification for the walkthrough.",
    sourceGroup: "vibestudio:personal:product-tour-ui",
    routes: [missionForms, tourPanel, missionContract],
    expected: { choice: choice("tour-panel", "inspect"), runtime: "browser" },
  },
  {
    kind: "suite", workspace: "personal", id: "locate-mission-charter-contract",
    goal: "The board could show an edited card while a run still has its original charter. Which declared suite owns tests for the shared execution charter contract, and could a teammate run it without native approval? Please only inspect the declaration.",
    sourceGroup: "vibestudio:personal:mission-contract",
    routes: [missionForms, missionAgent, missionContract],
    expected: { choice: choice("mission-contract", "inspect"), runtime: "native" },
  },
  {
    kind: "suite", workspace: "system", id: "plan-model-readiness-regression",
    goal: "Before switching model providers on this System workspace, tell me where the native gateway's model-readiness checks would run and what approval is needed. I only need the route right now.",
    sourceGroup: "vibestudio:system:native-gateway-readiness",
    routes: [records, modelGateway, images],
    expected: { choice: choice("model-gateway", "inspect"), runtime: "native" },
  },
  {
    kind: "suite", workspace: "system", id: "verify-unavailable-model-fails-without-waiting",
    goal: "A session appeared to hang after selecting a disconnected model. In model-gateway.test.ts run the existing “rejects models that are unknown or not usable” check. Give me the focused result before I change any provider settings.",
    sourceGroup: "vibestudio:system:native-gateway-readiness",
    routes: [modelGateway, records, images],
    execution: { routeId: "model-gateway", file: "model-gateway.test.ts", runtime: "native" },
    expected: { choice: choice("model-gateway", "verify", "model-gateway.test.ts", "rejects models that are unknown or not usable"),
      runtime: "native", status: "passed" },
  },
  {
    kind: "suite", workspace: "system", id: "check-image-restart-double-dispatch",
    goal: "I need to sign off on recovery after an image provider interruption. Run the “marks an interrupted provider attempt failed after restart” test in images.test.ts and retain the actual result for the incident record.",
    sourceGroup: "vibestudio:system:image-attempt-recovery",
    routes: [images, modelGateway, records],
    execution: { routeId: "images", file: "images.test.ts", runtime: "native" },
    expected: { choice: choice("images", "verify", "images.test.ts", "marks an interrupted provider attempt failed after restart"),
      runtime: "native", status: "passed" },
  },
  {
    kind: "suite", workspace: "system", id: "locate-capture-lineage-checks", split: "test",
    goal: "A reviewer asked for the route that checks whether Natlang call records can be filtered by owning run and parent invocation. Point them to the declared suite in this System workspace and say whether it needs approval. Leave execution to the reviewer.",
    sourceGroup: "vibestudio:system:capture-lineage",
    routes: [images, records, modelGateway],
    expected: { choice: choice("natlang-records", "inspect"), runtime: "native" },
  },
];
