import { describe, expect, it, vi } from "vitest";
import type { TestCase, TestSuiteResult } from "./types.js";
import type { HeadlessRunner } from "./runner.js";

const suites = vi.hoisted(() => ({
  calls: [] as Array<{ tests: string[]; concurrency?: number }>,
}));

vi.mock("./test-runner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./test-runner.js")>()),
  TestRunner: class {
    async runSuite(
      tests: TestCase[],
      filter?: { concurrency?: number },
    ): Promise<TestSuiteResult> {
      suites.calls.push({
        tests: tests.map((test) => test.name),
        concurrency: filter?.concurrency,
      });
      const [first, ...rest] = tests;
      const entry = (test: TestCase, passed: boolean) => ({
        test: {
          name: test.name,
          category: test.category,
          description: test.description,
          prompt: test.prompt,
        },
        result: passed ? { passed } : { passed, reason: "marker missing" },
        execution: {
          duration: 5,
          messages: [],
          toolFailures: passed
            ? []
            : [
                { name: "eval", expected: false },
                { name: "read", expected: true },
              ],
        },
      });
      const results = [
        ...(first ? [entry(first, false)] : []),
        ...rest.map((test) => entry(test, true)),
      ] as unknown as TestSuiteResult["results"];
      return {
        total: results.length,
        passed: results.length - (first ? 1 : 0),
        failed: first ? 1 : 0,
        errored: 0,
        toolFailureCount: first ? 1 : 0,
        testsWithToolFailures: first ? 1 : 0,
        skipped: 0,
        duration: 10,
        results,
      };
    }
  },
}));

const { createSystemTestingRun, runNextSelectedStage } = await import(
  "./stages.js"
);

describe("staged system-test runs", () => {
  it("runs one selected stage per call and folds results into the run", async () => {
    const { run, controls } = createSystemTestingRun();
    expect(controls.stageCount).toBe(run.stages.length);
    expect(controls.defaultStages).toEqual(
      run.stages.map((stage) => String(stage.index)),
    );
    const [first, second] = run.stages;
    run.selectedStageIndexes = [first!.index, second!.index];
    const runner = {} as HeadlessRunner;

    const one = await runNextSelectedStage(run, runner);
    expect(suites.calls[0]!.tests).toEqual(first!.tests);
    expect(one).toMatchObject({
      done: false,
      stage: first!.name,
      remainingStages: 1,
      total: first!.tests.length,
      failed: 1,
      toolFailureCount: 1,
      failedTestCount: 1,
      toolFailureTestCount: 1,
      skipped: controls.testCount - first!.tests.length,
    });
    expect(one.report).toContain(`Stage 1/2: ${first!.name}`);
    expect(one).not.toHaveProperty("results");
    expect(run.completedStages).toEqual([first!.index]);
    expect(run.lastStageSummary?.toolFailures).toEqual([
      `${first!.tests[0]}: 1 tool failure(s): eval`,
    ]);

    const two = await runNextSelectedStage(run, runner);
    expect(two).toMatchObject({ done: false, remainingStages: 0, failed: 2 });
    expect(run.results.results).toHaveLength(
      first!.tests.length + second!.tests.length,
    );
    expect(run.stageSummaries.map((summary) => summary.index)).toEqual([
      first!.index,
      second!.index,
    ]);

    const done = await runNextSelectedStage(run, runner);
    expect(done).toMatchObject({ done: true, remainingStages: 0, failed: 2 });
    expect(done.report).toBeUndefined();
    expect(suites.calls).toHaveLength(2);
  });
});
