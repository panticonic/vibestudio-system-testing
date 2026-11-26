import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  capturedProviderOutage,
  ProviderOutageAdmission,
  providerErrorSha256,
} from "./provider-outage-admission.js";
import { TestRunner } from "./test-runner.js";
import { runSystemTests } from "./cli.js";

const fixtures = vi.hoisted(() => ({
  tests: Array.from({ length: 64 }, (_, i) => ({
    name: `TEST-provider-${i}`,
    category: "smoke",
    description: "TEST-only local scripted execution",
    prompt: "TEST-only",
    validate: () => ({ passed: true }),
  })),
}));
vi.mock("./stages.js", () => ({ allTests: () => fixtures.tests }));
vi.mock("@workspace/runtime", () => ({
  rpc: { call: async () => ({}) },
  vcs: {},
  workers: {},
  workspace: {},
}));
vi.mock("./runner.js", () => ({
  HeadlessRunner: class {
    snapshotAll() {
      return [];
    }
    modelPolicySnapshot() {
      return {
        primaryModel: "TEST:local",
        activeModel: "TEST:local",
        fallbackModel: null,
        activations: [],
      };
    }
  },
}));
afterEach(() => vi.restoreAllMocks());
function entry(name: string, message = "fetch failed"): any {
  const id = `TEST-call-${name}`,
    model = "TEST:scripted-no-inference";
  return {
    test: {
      name,
      category: "smoke",
      description: "TEST-only",
      prompt: "TEST-only",
    },
    result: { passed: false, reason: message },
    execution: {
      messages: [],
      duration: 1,
      diagnostics: {
        natlangTeacher: {
          captureErrors: [],
          rootCallIds: [id],
          rootOutcome: "failed",
          executionError: { name: "NatlangCallError", message },
          calls: [
            {
              record: {
                call_id: id,
                parent_call_id: null,
                outcome: "failed",
                executor: { kind: "agent", model_id: model },
                model_turns: [
                  {
                    schema: "natlang.model-exchange/1",
                    kind: "generation",
                    request: {
                      invocation_id: id,
                      messages: [{ role: "user", content: "TEST-only" }],
                    },
                    error: { name: "Error", message },
                  },
                ],
              },
              events: [
                {
                  kind: "model_request",
                  phase: "error",
                  call_id: id,
                  actor: { id: model },
                },
              ],
            },
          ],
        },
      },
    },
  };
}
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((r) => (resolve = r));
  return { promise, resolve };
};

describe("source-bound provider outage admission", () => {
  it("uses two independently failed cases, or one actual already-open provider circuit", () => {
    const policy = new ProviderOutageAdmission();
    expect(policy.observe(entry("one"))).toBeUndefined();
    expect(policy.observe(entry("one"))).toBeUndefined();
    expect(policy.observe(entry("two"))).toHaveLength(2);
    expect(
      new ProviderOutageAdmission().observe(
        entry(
          "circuit",
          "Circuit breaker is open; last failure: GET https://provider.invalid/responses: upstream HTTP 503",
        ),
      ),
    ).toHaveLength(1);
  });
  for (const mutation of [
    "prose",
    "wrong-invocation",
    "wrong-actor",
    "missing-event",
    "foreign-parent",
    "successful-root",
    "capture-error",
    "local-cancellation",
    "recovered",
  ]) {
    it(`does not turn ${mutation} into an outage`, () => {
      const x = entry("negative"),
        t = x.execution.diagnostics.natlangTeacher,
        c = t.calls[0],
        r = c.record,
        last = r.model_turns[0];
      if (mutation === "prose") {
        last.reply = { text: last.error.message };
        delete last.error;
      }
      if (mutation === "wrong-invocation")
        last.request.invocation_id = "foreign";
      if (mutation === "wrong-actor") c.events[0].actor.id = "foreign";
      if (mutation === "missing-event") c.events = [];
      if (mutation === "foreign-parent") {
        t.rootCallIds = ["foreign"];
      }
      if (mutation === "successful-root") {
        t.rootOutcome = "done";
        r.outcome = "done";
      }
      if (mutation === "capture-error") t.captureErrors = ["missing record"];
      if (mutation === "local-cancellation")
        t.executionError.name = "NatlangCancelledError";
      if (mutation === "recovered") {
        r.definition = { key: "TEST-definition" };
        c.annotations = [
          { kind: "retried", source: "runtime", value: { by: "retry" } },
        ];
        t.calls.push({
          record: { ...r, call_id: "retry", outcome: "done", model_turns: [] },
          events: [],
        });
      }
      expect(capturedProviderOutage(x).evidence).toEqual([]);
    });
  }
  it("does not let many errors within one invocation impersonate different failed cases", () => {
    const p = new ProviderOutageAdmission();
    const x = entry("one");
    x.execution.diagnostics.natlangTeacher.calls[0].record.model_turns.push(
      x.execution.diagnostics.natlangTeacher.calls[0].record.model_turns[0],
    );
    expect(p.observe(x)).toBeUndefined();
  });
  it("closes a real64-case scheduler, joins four admitted cases, preserves60queued and never aborts their waits", async () => {
    const started: string[] = [],
      waits: AbortController[] = [],
      done = Array.from({ length: 4 }, () => deferred());
    vi.spyOn(TestRunner.prototype as any, "runOne").mockImplementation(
      function (this: any, test: any) {
        const i = started.push(test.name) - 1;
        const a = new AbortController();
        waits.push(a);
        this.activeWaits.add(a);
        return done[i]!.promise.finally(() => this.activeWaits.delete(a));
      },
    );
    const running = runSystemTests({
      runId: "TEST-outage",
      contextId: "TEST-context",
      names: fixtures.tests.map((t) => t.name),
      concurrency: 4,
    });
    await vi.waitFor(() => expect(started).toHaveLength(4));
    done[0].resolve(entry(started[0]!));
    done[1].resolve(entry(started[1]!));
    await vi.waitFor(() =>
      expect(waits.slice(0, 2).every((w) => !w.signal.aborted)).toBe(true),
    );
    await new Promise((r) => setImmediate(r));
    expect(started).toHaveLength(4);
    expect(waits.every((w) => !w.signal.aborted)).toBe(true);
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    for (const i of [2, 3]) {
      const e = entry(started[i]!);
      e.result = { passed: true };
      done[i].resolve(e);
    }
    const record = await running;
    expect(record.status).toBe("cancelled");
    expect(record.summary).toMatchObject({
      total: 4,
      passed: 2,
      failed: 2,
      admissionStopped: {
        reason: "provider-transport-outage",
        queuedTests: fixtures.tests.slice(4).map((t) => t.name),
      },
    });
    expect(record.suite.results).toHaveLength(4);
    expect(record.admissionStopped?.evidence).toHaveLength(2);
    expect(waits.every((w) => !w.signal.aborted)).toBe(true);
  });
  it("supports an explicit programmatic continuation opt-out without changing individual verdicts", async () => {
    vi.spyOn(TestRunner.prototype as any, "runOne").mockImplementation(
      async (test: any) => entry(test.name),
    );
    const record = await runSystemTests({
      runId: "TEST-opt-out",
      contextId: "TEST-context",
      names: fixtures.tests.slice(0, 3).map((t) => t.name),
      stopOnProviderOutage: false,
    });
    expect(record.status).toBe("completed");
    expect(record.summary.failed).toBe(3);
    expect(record.admissionStopped).toBeUndefined();
  });
  it.runIf(Boolean(process.env.NATLANG_TEST_PROVIDER_ORIGINAL))(
    "recognizes the immutable original provider failure without another request",
    () => {
      const bytes = readFileSync(process.env.NATLANG_TEST_PROVIDER_ORIGINAL!);
      const packet = JSON.parse(gunzipSync(bytes).toString());
      const result = capturedProviderOutage(packet);
      expect(result.attempted).toBe(true);
      expect(result.evidence).toHaveLength(1);
      const error =
        packet.execution.diagnostics.natlangTeacher.calls[0].record
          .model_turns[0].error;
      expect(result.evidence[0].errorSha256).toBe(providerErrorSha256(error));
    expect(result.evidence[0].errorSha256).toBe(process.env.NATLANG_TEST_PROVIDER_ERROR_SHA256);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        process.env.NATLANG_TEST_PROVIDER_ORIGINAL_SHA256,
      );
    },
  );
});
