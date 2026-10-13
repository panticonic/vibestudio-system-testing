import { trelloLiveImportTests } from "./tests/trello-live-import.js";
import { problemReportingTests } from "./tests/problem-reporting.js";
import {
  requiringUnits,
  type TestCase,
  type TestSuiteResult,
} from "./types.js";
import type { HeadlessRunner } from "./runner.js";
import { TestRunner } from "./test-runner.js";
import { isUnexpectedToolFailure } from "./tool-failure-classification.js";
import { assertSystemTestDeclaration } from "./prompt-contract.js";
import { deterministicTestCases } from "./deterministic.js";
import { smokeTests } from "./tests/smoke.js";
import { filesystemTests } from "./tests/filesystem.js";
import { vcsTests } from "./tests/vcs.js";
import { panelTests } from "./tests/panels.js";
import { workerTests } from "./tests/workers.js";
import { buildTests } from "./tests/build.js";
import { oauthTests } from "./tests/oauth.js";
import { workspaceTests } from "./tests/workspace.js";
import { notificationTests } from "./tests/notifications.js";
import { messagingTests } from "./tests/messaging.js";
import { skillTests } from "./tests/skills.js";
import { agentCapabilityTests } from "./tests/agent-capabilities.js";
import { rpcTests } from "./tests/rpc-communication.js";
import { edgeCaseTests } from "./tests/edge-cases.js";
import { agenticRuntimeTests } from "./tests/agentic-runtime.js";
import { interactionSurfaceTests } from "./tests/interaction-surfaces.js";
import { docsProbeTests } from "./tests/docs-probes.js";
import { projectLifecycleTests } from "./tests/project-lifecycle.js";
import { scaffoldMatrixTests } from "./tests/scaffold-matrix.js";
import { developerErgonomicsTests } from "./tests/developer-ergonomics.js";
import { cdpGadDiagnosticTests } from "./tests/cdp-gad-diagnostics.js";
import { harnessResilienceTests } from "./tests/harness-resilience.js";
import { gitInteropTests } from "./tests/git-interop.js";
import { templateTests } from "./tests/templates.js";
import { vcsAdvancedTests } from "./tests/vcs-advanced.js";
import { blobstoreTests } from "./tests/blobstore.js";
import { serverLogTests } from "./tests/server-logs.js";
import { unitDiagnosticsTests } from "./tests/unit-diagnostics.js";
import { multiUserTests } from "./tests/multi-user.js";
import { approvalPermissionTests } from "./tests/approvals-permissions.js";
import { evalLifecycleTests } from "./tests/eval-lifecycle.js";
import { selfDevelopmentTests } from "./tests/self-development.js";
import { docsDiscoveryTests } from "./tests/docs-discovery.js";
import { webhookTests } from "./tests/webhooks.js";
import { extensionSurfaceTests } from "./tests/extensions-surface.js";
import { trustedUnitAuthoringTests } from "./tests/trusted-unit-authoring.js";
import { localModelTests } from "./tests/local-models.js";
import { harnessToolTests } from "./tests/harness-tools.js";
import { credentialTests } from "./tests/credentials.js";
import { agentOrchestrationTests } from "./tests/agent-orchestration.js";
import { mobileTests } from "./tests/mobile.js";
import { deliveryHardeningTests } from "./tests/delivery-hardening.js";
import { intentDiscoveryTests } from "./tests/intent-discovery.js";
import { provenanceQuestionTests } from "./tests/provenance-questions.js";
import { imageGenerationTests } from "./tests/image-generation.js";
import { imagePanelTests } from "./tests/image-panel.js";
import { adventureProgrammedInteractionTests } from "./tests/adventure-programmed-interaction.js";
import { adventureUiReviewTests } from "./tests/adventure-ui-review.js";
import { adventureTurnProfileTests } from "./tests/adventure-turn-profile.js";
import { adventureCampaignTests } from "./tests/adventure-campaign-play.js";
import { richUiPropensityTests } from "./tests/rich-ui-propensity.js";
import { terminalChatTests } from "./tests/terminal-chat.js";

export {
  agentCapabilityTests,
  agenticRuntimeTests,
  agentOrchestrationTests,
  approvalPermissionTests,
  blobstoreTests,
  buildTests,
  cdpGadDiagnosticTests,
  credentialTests,
  deliveryHardeningTests,
  developerErgonomicsTests,
  docsDiscoveryTests,
  docsProbeTests,
  edgeCaseTests,
  evalLifecycleTests,
  extensionSurfaceTests,
  filesystemTests,
  gitInteropTests,
  harnessResilienceTests,
  harnessToolTests,
  imageGenerationTests,
  imagePanelTests,
  adventureCampaignTests,
  richUiPropensityTests,
  adventureTurnProfileTests,
  adventureUiReviewTests,
  adventureProgrammedInteractionTests,
  intentDiscoveryTests,
  messagingTests,
  interactionSurfaceTests,
  localModelTests,
  mobileTests,
  multiUserTests,
  notificationTests,
  oauthTests,
  panelTests,
  projectLifecycleTests,
  provenanceQuestionTests,
  rpcTests,
  scaffoldMatrixTests,
  selfDevelopmentTests,
  serverLogTests,
  skillTests,
  smokeTests,
  templateTests,
  terminalChatTests,
  trustedUnitAuthoringTests,
  unitDiagnosticsTests,
  vcsAdvancedTests,
  vcsTests,
  webhookTests,
  workerTests,
  workspaceTests,
};

export type TestStage = {
  index: number;
  name: string;
  category: string;
  tests: TestCase[];
};

export type TestStageChoice = {
  value: string;
  label: string;
};

export type TestStageRunState = {
  selectedStageIndexes?: number[];
  completedStages?: number[];
};

export type NextTestStage = {
  stage: TestStage;
  stagePosition: number;
  selectedStages: TestStage[];
  remainingStages: number;
};

export function allTests(): TestCase[] {
  const tests = [
    ...trelloLiveImportTests,
    ...smokeTests,
    ...filesystemTests,
    ...vcsTests,
    ...vcsAdvancedTests,
    ...provenanceQuestionTests,
    ...gitInteropTests,
    ...templateTests,
    ...panelTests,
    ...workerTests,
    ...buildTests,
    ...oauthTests,
    ...credentialTests,
    ...workspaceTests,
    ...unitDiagnosticsTests,
    ...multiUserTests,
    ...approvalPermissionTests,
    ...notificationTests,
    ...messagingTests,
    ...skillTests,
    ...agentCapabilityTests,
    ...rpcTests,
    ...edgeCaseTests,
    ...agenticRuntimeTests,
    ...agentOrchestrationTests,
    ...evalLifecycleTests,
    ...selfDevelopmentTests,
    ...blobstoreTests,
    ...serverLogTests,
    ...problemReportingTests,
    ...webhookTests,
    ...extensionSurfaceTests,
    ...trustedUnitAuthoringTests,
    ...localModelTests,
    ...harnessToolTests,
    ...imageGenerationTests,
    ...imagePanelTests,
    ...requiringUnits(
      [
        "panels/dead-letter-office",
        "panels/missing-country",
        "panels/wandering-house",
        "workers/adventure-world",
        "workers/adventure-agents",
      ],
      [
        ...adventureCampaignTests,
        ...adventureTurnProfileTests,
        ...adventureUiReviewTests,
        ...adventureProgrammedInteractionTests,
      ],
    ),
    ...mobileTests,
    ...deliveryHardeningTests,
    ...intentDiscoveryTests,
    ...docsDiscoveryTests,
    ...interactionSurfaceTests,
    ...richUiPropensityTests,
    ...terminalChatTests,
    ...projectLifecycleTests,
    ...scaffoldMatrixTests,
    ...developerErgonomicsTests,
    ...cdpGadDiagnosticTests,
    ...harnessResilienceTests,
    ...docsProbeTests,
    ...deterministicTestCases(),
  ];
  for (const test of tests) assertSystemTestDeclaration(test);
  return tests;
}

export function testCategories(tests: TestCase[] = allTests()): string[] {
  return [...new Set(tests.map((test) => test.category))];
}

export function testStages(
  tests: TestCase[] = allTests().filter((test) => !test.explicitOnly),
  maxTestsPerStage?: number,
): TestStage[] {
  tests = tests.filter((test) => !test.explicitOnly);
  const stages: TestStage[] = [];
  for (const category of testCategories(tests)) {
    const categoryTests = tests.filter((test) => test.category === category);
    const stageSize = Number.isFinite(maxTestsPerStage)
      ? Math.max(1, Math.floor(maxTestsPerStage!))
      : Math.max(1, categoryTests.length);
    const chunks = Math.ceil(categoryTests.length / stageSize);
    for (let offset = 0; offset < categoryTests.length; offset += stageSize) {
      const stageNumber = Math.floor(offset / stageSize) + 1;
      stages.push({
        index: stages.length,
        name: chunks > 1 ? `${category} ${stageNumber}/${chunks}` : category,
        category,
        tests: categoryTests.slice(offset, offset + stageSize),
      });
    }
  }
  return stages;
}

export function testStageChoices(
  stages: TestStage[] = testStages(),
): TestStageChoice[] {
  return stages.map((stage) => ({
    value: String(stage.index),
    label: `${stage.name} (${stage.tests.length} tests)`,
  }));
}

export function selectedTestStages(
  tests: TestCase[] = allTests().filter((test) => !test.explicitOnly),
  run?: TestStageRunState | null,
): TestStage[] {
  const stages = testStages(tests);
  const allIndexes = stages.map((stage) => stage.index);
  const selectedIndexes = new Set(
    Array.isArray(run?.selectedStageIndexes) &&
      run.selectedStageIndexes.length > 0
      ? run.selectedStageIndexes.filter((value) => allIndexes.includes(value))
      : allIndexes,
  );
  return stages.filter((stage) => selectedIndexes.has(stage.index));
}

export function nextSelectedStage(
  tests: TestCase[] = allTests().filter((test) => !test.explicitOnly),
  run?: TestStageRunState | null,
): NextTestStage | null {
  const selectedStages = selectedTestStages(tests, run);
  const completed = new Set(
    Array.isArray(run?.completedStages) ? run.completedStages : [],
  );
  const stage = selectedStages.find((item) => !completed.has(item.index));
  if (!stage) return null;
  const stagePosition =
    selectedStages.findIndex((item) => item.index === stage.index) + 1;
  const remainingStages = selectedStages.filter(
    (item) => !completed.has(item.index),
  ).length;
  return {
    stage,
    stagePosition,
    selectedStages,
    remainingStages,
  };
}

/** A stage as stored on the run state: test names only, never TestCase objects. */
export type StoredTestStage = {
  index: number;
  name: string;
  category: string;
  tests: string[];
};

export type TestStageSummary = {
  index: number;
  name: string;
  category: string;
  position: number;
  selectedStageCount: number;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  toolFailureCount: number;
  testsWithToolFailures: number;
  durationMs: number;
  concurrency: number;
  failedTests: string[];
  toolFailures: string[];
};

/**
 * The whole state of one interactive staged run. Keep it in
 * `scope.systemTestingRun`; `results` is the full diagnostic record.
 */
export type SystemTestingRun = TestStageRunState & {
  runId: string;
  stages: StoredTestStage[];
  completedStages: number[];
  results: TestSuiteResult;
  stageSummaries: TestStageSummary[];
  lastStageSummary?: TestStageSummary;
};

export type SystemTestingRunControls = {
  runId: string;
  stageOptions: TestStageChoice[];
  defaultStages: string[];
  stageCount: number;
  testCount: number;
};

/** Compact, return-safe result of one `runNextSelectedStage` call. */
export type StageRunResult = {
  done: boolean;
  runId: string;
  stage?: string;
  remainingStages: number;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  toolFailureCount: number;
  testsWithToolFailures: number;
  skipped: number;
  failedTestCount: number;
  toolFailureTestCount: number;
  /** Short markdown stage report for the user; absent once every stage ran. */
  report?: string;
};

function runnableTests(): TestCase[] {
  return allTests().filter((test) => !test.explicitOnly);
}

/** Create the run state and the control data a stage-selection form needs. */
export function createSystemTestingRun(): {
  run: SystemTestingRun;
  controls: SystemTestingRunControls;
} {
  const tests = runnableTests();
  const stages = testStages(tests);
  const stageOptions = testStageChoices(stages);
  const run: SystemTestingRun = {
    runId: crypto.randomUUID(),
    stages: stages.map((stage) => ({
      index: stage.index,
      name: stage.name,
      category: stage.category,
      tests: stage.tests.map((test) => test.name),
    })),
    completedStages: [],
    stageSummaries: [],
    results: {
      total: 0,
      passed: 0,
      failed: 0,
      errored: 0,
      toolFailureCount: 0,
      testsWithToolFailures: 0,
      skipped: tests.length,
      duration: 0,
      results: [],
    },
  };
  return {
    run,
    controls: {
      runId: run.runId,
      stageOptions,
      defaultStages: stageOptions.map((option) => option.value),
      stageCount: stages.length,
      testCount: tests.length,
    },
  };
}

function stageRunResult(
  run: SystemTestingRun,
  fields: Partial<StageRunResult> & { done: boolean; remainingStages: number },
): StageRunResult {
  const aggregate = run.results;
  return {
    runId: run.runId,
    total: aggregate.total,
    passed: aggregate.passed,
    failed: aggregate.failed,
    errored: aggregate.errored,
    toolFailureCount: aggregate.toolFailureCount ?? 0,
    testsWithToolFailures: aggregate.testsWithToolFailures ?? 0,
    skipped: aggregate.skipped,
    failedTestCount: 0,
    toolFailureTestCount: 0,
    ...fields,
  };
}

/**
 * Run the next selected, not yet completed stage of `run` and fold its
 * results into the run in place: cumulative counts, completed stages, the
 * per-stage summary, and the full result entries. Runs exactly one stage.
 */
export async function runNextSelectedStage(
  run: SystemTestingRun,
  runner: HeadlessRunner,
): Promise<StageRunResult> {
  if (!run || typeof run !== "object" || !run.results) {
    throw new Error(
      "runNextSelectedStage: no systemTestingRun; create one with createSystemTestingRun() first.",
    );
  }
  const tests = runnableTests();
  const next = nextSelectedStage(tests, run);
  if (!next) return stageRunResult(run, { done: true, remainingStages: 0 });

  const { stage, stagePosition, selectedStages, remainingStages } = next;
  const tester = new TestRunner(runner, {
    onTestStart: (test) => console.log(`  Running: ${test.name}...`),
    onTestEnd: (test, result, execution) =>
      console.log(
        `  ${result.passed ? "PASS" : "FAIL"}: ${test.name} (${execution.duration}ms)`,
      ),
    onTestResult: (_entry, aggregate) =>
      console.log(
        `  Stage progress: ${stage.name} ${aggregate.total}/${stage.tests.length}`,
      ),
  });
  const concurrency =
    stage.category === "workers" ? 1 : Math.min(2, Math.max(1, stage.tests.length));
  const partial = await tester.runSuite(stage.tests, { concurrency });

  const aggregate = run.results;
  aggregate.total += partial.total;
  aggregate.passed += partial.passed;
  aggregate.failed += partial.failed;
  aggregate.errored += partial.errored;
  aggregate.toolFailureCount =
    (aggregate.toolFailureCount ?? 0) + (partial.toolFailureCount ?? 0);
  aggregate.testsWithToolFailures =
    (aggregate.testsWithToolFailures ?? 0) + (partial.testsWithToolFailures ?? 0);
  aggregate.duration += partial.duration;
  aggregate.results.push(...partial.results);
  aggregate.skipped = tests.length - aggregate.total;
  run.completedStages = [...new Set([...(run.completedStages ?? []), stage.index])];

  const failedTests = partial.results
    .filter((entry) => !entry.result.passed || entry.execution.error)
    .map((entry) => {
      const reason =
        entry.execution.error || entry.result.reason || "No reason captured";
      return `${entry.test.name}: ${reason.slice(0, 240)}`;
    });
  const toolFailures = partial.results.flatMap((entry) => {
    const failures = (entry.execution.toolFailures ?? []).filter(
      isUnexpectedToolFailure,
    );
    if (failures.length === 0) return [];
    const names = failures.map((failure) => failure.name).join(", ");
    return [`${entry.test.name}: ${failures.length} tool failure(s): ${names}`];
  });
  const summary: TestStageSummary = {
    index: stage.index,
    name: stage.name,
    category: stage.category,
    position: stagePosition,
    selectedStageCount: selectedStages.length,
    total: partial.total,
    passed: partial.passed,
    failed: partial.failed,
    errored: partial.errored,
    toolFailureCount: partial.toolFailureCount ?? 0,
    testsWithToolFailures: partial.testsWithToolFailures ?? 0,
    durationMs: partial.duration,
    concurrency,
    failedTests,
    toolFailures,
  };
  run.stageSummaries = [...(run.stageSummaries ?? []), summary];
  run.lastStageSummary = summary;

  const remaining = remainingStages - 1;
  const report = [
    `**System Test Stage ${stagePosition}/${selectedStages.length}: ${stage.name}**`,
    `- Stage results: ${partial.passed} passed, ${partial.failed} failed, ${partial.errored} errored`,
    `- Concurrency: ${concurrency} test agents`,
    `- Cumulative results: ${aggregate.passed} passed, ${aggregate.failed} failed, ${aggregate.errored} errored, ${aggregate.skipped} not run/skipped`,
    failedTests.length
      ? `- Findings: ${failedTests.join("; ")}`
      : "- Findings: no failures in this stage",
    `- Next: ${remaining ? "continuing to the next selected stage" : "all selected stages complete"}`,
  ].join("\n");

  return stageRunResult(run, {
    done: false,
    stage: stage.name,
    remainingStages: remaining,
    failedTestCount: failedTests.length,
    toolFailureTestCount: toolFailures.length,
    report,
  });
}
