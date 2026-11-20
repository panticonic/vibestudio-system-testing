type Route = { id: string; target: string; suite: string; purpose: string };
export type SuiteSelection = { routeId: string; mode: "inspect" | "verify"; file: string | null; testName: string | null };
type SuiteExpected = { choice: SuiteSelection; runtime: "native" | "workerd"; status?: "passed" | "no-tests" };

const adapter = { id: "adapter", target: "extensions/test-runner", suite: "native",
  purpose: "Native workspace test adapter process isolation and module selection" };
const adventure = { id: "adventure", target: "packages/adventure-engine", suite: "world",
  purpose: "Adventure story state transitions under the workspace runtime" };
const grimoire = { id: "grimoire", target: "packages/grimoire-engine", suite: "native",
  purpose: "Grimoire story state and turn transitions" };
const regency = { id: "regency", target: "packages/regency-engine", suite: "native",
  purpose: "Regency realm state, advisor perspectives, and validated conversational turns" };
const choice = (routeId: string, mode: SuiteSelection["mode"], file: string | null = null,
                testName: string | null = null): SuiteSelection => ({ routeId, mode, file, testName });

export type SuiteGoalWorld = {
  kind: "suite";
  id: string;
  goal: string;
  sourceGroup: string;
  split?: "test";
  routes: Route[];
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
    expected: { choice: choice("adapter", "verify", "index.test.ts", "executes selected modules in a child"),
      runtime: "native", status: "passed" },
  },
  {
    kind: "suite", id: "check-requested-adapter-retry-regression",
    goal: "Can this workspace actually verify the native adapter regression called “preserves module diagnostics after a retry”? Try that exact filter in index.test.ts and tell me whether it exercised a test.",
    sourceGroup: "vibestudio:workspace-verification:native-adapter",
    routes: [adapter, adventure],
    expected: { choice: choice("adapter", "verify", "index.test.ts", "preserves module diagnostics after a retry"),
      runtime: "native", status: "no-tests" },
  },
  {
    kind: "suite", id: "identify-adventure-test-runtime",
    goal: "Which runtime is declared for Adventure Engine story-state checks, and would it use native code approval? I only need to plan the verification today.",
    sourceGroup: "vibestudio:workspace-verification:adventure-world",
    routes: [adapter, adventure],
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
];
