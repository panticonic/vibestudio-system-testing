import { describe, expect, it } from "vitest";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { TestExecutionResult } from "../types.js";
import { assertAgentGoalPrompt, assertSystemTestDeclaration } from "../prompt-contract.js";
import type { DeviceIdentities } from "./_client-device.js";
import {
  HELLO_ID,
  UNSUPPORTED_CAPABILITY,
  decideApproval,
  echoed,
  greeting,
  prompts,
  restartFailure,
  sameBystanders,
  unsupportedId,
  updatedGreeting,
} from "./_client-scenario.js";
import { clientDevLoopTests, validateClientDevLoop, type DevLoopEvidence } from "./client-dev-loop.js";
import {
  clientLaunchTests,
  validateClientIntentBackground,
  validateClientLaunch,
  validateClientUpdateSwap,
  type BackgroundIntentEvidence,
  type LaunchEvidence,
  type UpdateSwapEvidence,
} from "./client-launch.js";

const ids = (pid = 100, boot = "boot-1", instances: DeviceIdentities["instances"] = [{ clientId: "browser", instanceId: "w1", buildKey: "b1" }]): DeviceIdentities => ({
  serverBootId: boot,
  hostPid: pid,
  instances,
});
const run = (key: string, evidence: unknown, extra: Partial<TestExecutionResult> = {}): TestExecutionResult => ({
  messages: [],
  duration: 1,
  diagnostics: { [key]: evidence },
  ...extra,
});
const accepted = [{ approvalId: "a1", kind: "unit-install-review", decision: "accept-review" as const }];

describe("declarations", () => {
  it("are valid system tests with the planned names", () => {
    const all = [...clientDevLoopTests, ...clientLaunchTests];
    for (const test of all) assertSystemTestDeclaration(test);
    expect(all.map((t) => t.name).sort()).toEqual(
      [
        "client-dev-loop-desktop",
        "client-dev-loop-terminal",
        "client-intent-background",
        "client-launch-desktop",
        "client-launch-terminal",
        "client-update-swap",
      ].sort()
    );
  });

  it("send the agent outcomes, not tool choreography", () => {
    for (const runtime of ["terminal", "desktop"] as const) {
      for (const prompt of [
        prompts.create(runtime, "n1"),
        prompts.create(runtime, "n1", { updateAware: true }),
        prompts.edit(runtime, "n1"),
        prompts.trust(runtime),
        prompts.untrust(runtime),
        prompts.unsupported(runtime),
        prompts.retire(runtime),
        prompts.retire(runtime, false),
      ])
        assertAgentGoalPrompt(prompt, "client prompt");
    }
  });
});

describe("identities", () => {
  it("detects a restarted server or host and a moved bystander", () => {
    expect(restartFailure({ before: ids(), after: ids() })).toBeNull();
    expect(restartFailure({ before: ids(), after: ids(100, "boot-2") })).toMatch(/server restarted/);
    expect(restartFailure({ before: ids(), after: ids(101) })).toMatch(/host process restarted/);
    expect(restartFailure({ before: ids() })).toMatch(/not recorded/);
    expect(sameBystanders(ids(), ids(), ["hello"])).toBe(true);
    expect(sameBystanders(ids(), ids(100, "boot-1", [{ clientId: "browser", instanceId: "w2", buildKey: "b1" }]), ["hello"])).toBe(false);
    expect(sameBystanders(ids(100, "b", [{ clientId: "hello", instanceId: "x", buildKey: "1" }]), ids(100, "b", []), ["hello"])).toBe(true);
  });
});

describe("approval decisions", () => {
  const base = { approvalId: "p1", callerId: "x", callerKind: "do", requestedAt: 1 };
  it("accepts reviews, confirms trust cards once and denies the rest", () => {
    expect(decideApproval({ ...base, kind: "unit-install-review" } as unknown as PendingApproval).decision).toBe("accept-review");
    const trust = decideApproval({
      ...base,
      kind: "capability",
      capability: "workspace.publish",
      title: "Change client trust",
      allowedDecisions: ["once", "deny"],
      trustChange: [{ source: "clients/hello-desktop", title: "Hello", runtime: "web", gained: [{ capability: "approval-surface", summary: "" }], lost: [], effectiveVersion: null }],
    } as unknown as PendingApproval);
    expect(trust).toMatchObject({ decision: "once", critical: true, trust: [{ gained: ["approval-surface"] }] });
    expect(decideApproval({ ...base, kind: "capability", capability: "x", title: "t" } as unknown as PendingApproval).decision).toBe("deny");
  });
});

function devLoop(runtime: "terminal" | "desktop"): DevLoopEvidence {
  const id = HELLO_ID[runtime];
  const nonce = "n1";
  const cap = UNSUPPORTED_CAPABILITY[runtime];
  return {
    runtime,
    phase: "done",
    completedPhases: [],
    nonce,
    before: ids(),
    after: ids(),
    approvals: accepted,
    listing: {
      id,
      source: `clients/${id}`,
      runtime: runtime === "desktop" ? "web" : "terminal",
      status: "available",
      trusted: false,
      isDefault: false,
      intents: [{ name: "echo", kind: "background", handler: "vibestudio.hello.v1#echo" }],
      activeBuildKey: "b1",
    },
    launch: { state: "ready", buildKey: "b1", instanceId: "i1", develop: true },
    rendered: { text: greeting(nonce), hasGreeting: true },
    echo: { sent: "p", ok: true, text: echoed("p") },
    update: { fromBuildKey: "b1", toBuildKey: "b2", shownText: updatedGreeting(nonce), showsNewGreeting: true, bystandersUnchanged: true },
    integration: {
      installed: { clientId: id, kind: "launcher", path: "/x" },
      artifactExistedAfterInstall: true,
      removedAfterRetire: true,
      listingGoneAfterRetire: true,
      closedReason: "retired",
    },
    negative: { id: unsupportedId(runtime), capability: cap, state: "unavailable", reason: `needs ${cap}`, missing: [cap] },
    ...(runtime === "desktop"
      ? {
          trust: {
            cards: [
              { source: `clients/${id}`, critical: true, gained: ["approval-surface"], lost: [] },
              { source: `clients/${id}`, critical: true, gained: [], lost: ["approval-surface"] },
            ],
            grantedLive: ["approval-surface"],
            revoked: { reason: "trust-revoked" },
          },
        }
      : {}),
  };
}

describe("validateClientDevLoop", () => {
  for (const runtime of ["terminal", "desktop"] as const) {
    it(`passes a complete ${runtime} loop`, () => {
      expect(validateClientDevLoop(run("clientDevLoop", devLoop(runtime)), runtime).passed).toBe(true);
    });
    const mutate = (change: (e: DevLoopEvidence) => void) => {
      const e = devLoop(runtime);
      change(e);
      return validateClientDevLoop(run("clientDevLoop", e), runtime);
    };
    it(`fails each ${runtime} step it must prove`, () => {
      expect(mutate((e) => (e.listing = undefined)).reason).toMatch(/never gained/);
      expect(mutate((e) => (e.echo = { sent: "p", ok: true, text: "p" })).reason).toMatch(/echoed text/);
      expect(mutate((e) => (e.update!.toBuildKey = "b1")).reason).toMatch(/new build/);
      expect(mutate((e) => (e.update!.bystandersUnchanged = false)).reason).toMatch(/identity changed/);
      expect(mutate((e) => (e.integration!.removedAfterRetire = false)).reason).toMatch(/launcher/);
      expect(mutate((e) => { e.negative!.reason = "no"; e.negative!.missing = []; }).reason).toMatch(/name/);
      expect(mutate((e) => (e.after = ids(100, "boot-2"))).reason).toMatch(/server restarted/);
      expect(mutate((e) => (e.approvals = [...accepted, { approvalId: "z", kind: "capability", decision: "deny", title: "x" }])).reason).toMatch(/nobody was meant/);
      expect(mutate((e) => (e.approvals = [])).reason).toMatch(/install review/);
    });
  }
  it("requires the desktop trust proof", () => {
    const e = devLoop("desktop");
    e.trust!.cards[0]!.critical = false;
    expect(validateClientDevLoop(run("clientDevLoop", e), "desktop").reason).toMatch(/critical/);
    const g = devLoop("desktop");
    g.trust!.grantedLive = [];
    expect(validateClientDevLoop(run("clientDevLoop", g), "desktop").reason).toMatch(/live/);
    const r = devLoop("desktop");
    r.trust!.revoked = { reason: "retired" };
    expect(validateClientDevLoop(run("clientDevLoop", r), "desktop").reason).toMatch(/trust-revoked/);
  });
  it("reports a scenario failure first", () => {
    expect(validateClientDevLoop(run("clientDevLoop", devLoop("terminal"), { error: "boom" }), "terminal").reason).toMatch(/boom/);
    expect(validateClientDevLoop({ messages: [], duration: 0 }, "terminal").reason).toMatch(/no evidence/);
  });
});

describe("validateClientLaunch", () => {
  const launch = (runtime: "terminal" | "desktop"): LaunchEvidence => ({
    runtime,
    phase: "close",
    completedPhases: [],
    before: ids(),
    after: ids(),
    approvals: [],
    listing: { id: "chat", source: "clients/chat", runtime: runtime === "desktop" ? "web" : "terminal", status: "running", trusted: true, isDefault: false, intents: [], activeBuildKey: "b1" },
    launched: { buildKey: "b1", instanceId: "i1", granted: ["device-session"], denied: [] },
    rendered: "Chat ● online",
    closedCleanly: true,
    ...(runtime === "terminal" ? { piped: { exitCode: 0, output: "Hi there\n" } } : { relaunchInstanceId: "i1", otherInstanceId: "i2" }),
  });
  it("passes both runtimes", () => {
    expect(validateClientLaunch(run("clientLaunch", launch("terminal")), "terminal").passed).toBe(true);
    expect(validateClientLaunch(run("clientLaunch", launch("desktop")), "desktop").passed).toBe(true);
  });
  it("rejects a stale build, structured ask output and a new window on reopen", () => {
    const stale = launch("terminal");
    stale.launched!.buildKey = "b0";
    expect(validateClientLaunch(run("clientLaunch", stale), "terminal").reason).toMatch(/active build/);
    const json = launch("terminal");
    json.piped = { exitCode: 0, output: '{"text":"x"}' };
    expect(validateClientLaunch(run("clientLaunch", json), "terminal").reason).toMatch(/plain text/);
    const dup = launch("desktop");
    dup.relaunchInstanceId = "i9";
    expect(validateClientLaunch(run("clientLaunch", dup), "desktop").reason).toMatch(/focus/);
    const gone = launch("terminal");
    gone.after = ids(7);
    expect(validateClientLaunch(run("clientLaunch", gone), "terminal").reason).toMatch(/host process restarted/);
  });
});

describe("validateClientIntentBackground", () => {
  const good = (): BackgroundIntentEvidence => ({
    phase: "ask",
    completedPhases: [],
    before: ids(),
    after: ids(),
    approvals: [],
    listing: { id: "chat", source: "c", runtime: "terminal", status: "running", trusted: true, isDefault: false, intents: [{ name: "ask", kind: "background", handler: "vibestudio.quickfire.v1#ask" }], activeBuildKey: "b" },
    undeclaredIntent: { ok: false, code: "ENOENT", message: "" },
    unknownParam: { ok: false, code: "EINVAL", message: "" },
    foreground: { ok: false, code: "EINVAL", message: "" },
    answer: { ok: true, text: "Yes", fields: ["text"] },
  });
  it("accepts text-only results and rejects everything else", () => {
    expect(validateClientIntentBackground(run("clientIntentBackground", good())).passed).toBe(true);
    const extra = good();
    extra.answer = { ok: true, text: "Yes", fields: ["text", "result"] };
    expect(validateClientIntentBackground(run("clientIntentBackground", extra)).reason).toMatch(/nothing else/);
    const lax = good();
    lax.foreground = { ok: true, text: "x", fields: ["text"] };
    expect(validateClientIntentBackground(run("clientIntentBackground", lax)).reason).toMatch(/foreground/);
    const loaded = good();
    loaded.after = ids(100, "boot-1", []);
    expect(validateClientIntentBackground(run("clientIntentBackground", loaded)).reason).toMatch(/instance/);
  });
});

describe("validateClientUpdateSwap", () => {
  const good = (): UpdateSwapEvidence => ({
    phase: "retire",
    completedPhases: [],
    nonce: "n",
    before: ids(),
    after: ids(),
    approvals: accepted,
    launched: { buildKey: "b1", instanceId: "i", develop: false },
    offered: { pendingBuildKey: "b2", runningBuildKey: "b1", text: `${greeting("n")}\nUpdate ready` },
    swapped: { buildKey: "b2", text: updatedGreeting("n"), bystandersUnchanged: true },
  });
  it("requires the offer before the swap", () => {
    expect(validateClientUpdateSwap(run("clientUpdateSwap", good())).passed).toBe(true);
    const adopted = good();
    adopted.offered!.text = `${updatedGreeting("n")}\nUpdate ready`;
    expect(validateClientUpdateSwap(run("clientUpdateSwap", adopted)).reason).toMatch(/loaded build/);
    const none = good();
    none.offered!.pendingBuildKey = null;
    expect(validateClientUpdateSwap(run("clientUpdateSwap", none)).reason).toMatch(/newer ready build/);
    const dev = good();
    dev.launched!.develop = true;
    expect(validateClientUpdateSwap(run("clientUpdateSwap", dev)).reason).toMatch(/development mode/);
  });
});
