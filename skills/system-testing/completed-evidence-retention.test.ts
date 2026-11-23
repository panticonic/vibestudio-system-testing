import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { TestRunner } from "./test-runner.js";
import { retainedSystemTestEntry } from "./completed-evidence-retention.js";
import type { HeadlessRunner } from "./runner.js";
import type { TestCase, TestExecutionResult, TestSuiteResultEntry } from "./types.js";

const cases = ["one", "two", "three"].map(name => ({ name, category: "unit", description: name, prompt: name })) as TestCase[];
function execution(name: string): TestExecutionResult {
  return { messages: [], duration: 10, diagnostics: { natlangTeacher: { prompt: name + ":" + "full evidence ".repeat(25_000) } },
    toolFailures: name === "two" ? [{ name: "actual failed tool", source: "snapshot", expected: false }] : [] };
}
function runOne(tester: TestRunner, operation: (test: TestCase) => Promise<{ result: { passed: boolean }; execution: TestExecutionResult }>) {
  vi.spyOn(tester as unknown as { runOne: typeof operation }, "runOne").mockImplementation(operation);
}
it("releases completed full packets only after durable acknowledgement and preserves exact original evidence", async () => {
  const stored = new Map<string, string>();
  const tester = new TestRunner({} as HeadlessRunner, { onTestResult: async (entry, aggregate) => {
    // Only the newly completed packet is still resident in this sequential run.
    expect(aggregate.results.filter(row => !row.retainedEvidence)).toHaveLength(1);
    const text = JSON.stringify(entry), digest = createHash("sha256").update(text).digest("hex");
    stored.set(entry.test.name, text);
    return { digest, size: Buffer.byteLength(text) };
  } });
  runOne(tester, async test => ({ result: { passed: true }, execution: execution(test.name) }));
  const suite = await tester.runSuite(cases);
  expect(suite.passed).toBe(3);
  expect(suite.toolFailureCount).toBe(1);
  expect(suite.testsWithToolFailures).toBe(1);
  for (const entry of suite.results) {
    expect(entry.execution.diagnostics).toBeUndefined();
    expect(entry.retainedEvidence?.digest).toBe(createHash("sha256").update(stored.get(entry.test.name)!).digest("hex"));
    expect(JSON.parse(stored.get(entry.test.name)!).execution).toEqual(execution(entry.test.name));
  }
  expect(JSON.stringify(suite)).not.toContain("full evidence");
});
it("keeps full evidence when no durable sink acknowledges it", async () => {
  const tester = new TestRunner({} as HeadlessRunner);
  runOne(tester, async test => ({ result: { passed: true }, execution: execution(test.name) }));
  const suite = await tester.runSuite(cases.slice(0, 1));
  expect(suite.results[0]!.execution).toEqual(execution("one"));
  expect(suite.results[0]!.retainedEvidence).toBeUndefined();
});
it("stops admission and joins owned workers when durable retention fails", async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started: string[] = [];
  const tester = new TestRunner({} as HeadlessRunner, { onTestResult: async entry => {
    if (entry.test.name === "one") throw new Error("Original durable write failure");
  } });
  runOne(tester, async test => {
    started.push(test.name);
    if (test.name === "two") await waiting;
    return { result: { passed: true }, execution: execution(test.name) };
  });
  let settled = false;
  const running = tester.runSuite(cases, { concurrency: 2 }).finally(() => { settled = true; });
  const rejected = expect(running).rejects.toThrow("Original durable write failure");
  await vi.waitFor(() => expect(tester.cancelled).toBe(true));
  expect(settled).toBe(false);
  expect(started).toEqual(["one", "two"]);
  release();
  await rejected;
});
it("refuses an invalid acknowledgement instead of dropping a packet", () => {
  const entry: TestSuiteResultEntry = { test: { name: "one", category: "unit", description: "one", prompt: "one" },
    result: { passed: true }, execution: execution("one") };
  expect(() => retainedSystemTestEntry(entry, { digest: "invented", size: 1 })).toThrow("acknowledged");
  expect(entry.execution.diagnostics).toBeDefined();
});
