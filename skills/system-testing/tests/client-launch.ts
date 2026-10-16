import { requiringUnits, type TestCase, type TestExecutionResult, type TestResult } from "../types.js";
import type { ClientListingLite, DeviceIdentities, IntentOutcome, ShellResult } from "./_client-device.js";
import {
  CLIENT_AUTHORING_POLICY,
  HELLO_ID,
  greeting,
  prompts,
  restartFailure,
  runScenario,
  sameBystanders,
  updatedGreeting,
  type ApprovalRecord,
} from "./_client-scenario.js";

/**
 * Launch, background-intent and update tests of the client hosts
 * (docs/client-hosts-and-clients-plan.md §10). They run the template chat
 * clients (the worked examples) except `client-update-swap`, which needs a
 * client whose source it can publish new builds of.
 */

const CHAT_ID = "chat";
const ONLINE = "● online";

interface Common {
  phase: string;
  completedPhases: string[];
  approvals?: ApprovalRecord[];
  before?: DeviceIdentities;
  after?: DeviceIdentities;
}

function fail(reason: string, evidence: Common): TestResult {
  return { passed: false, reason, details: { phase: evidence.phase, completedPhases: evidence.completedPhases } };
}

function evidenceOf<T>(result: TestExecutionResult, key: string): T | undefined {
  return result.diagnostics?.[key] as T | undefined;
}

/** Shared head of every validator: scenario failure, stray approvals, cleanup. */
function baseFailure(result: TestExecutionResult, evidence: Common): TestResult | null {
  if (result.error) return fail(`The scenario failed during ${evidence.phase}: ${result.error}`, evidence);
  const denied = (evidence.approvals ?? []).filter((a) => a.decision === "deny");
  if (denied.length) return fail(`Approvals nobody was meant to decide reached the person: ${denied.map((a) => a.title ?? a.kind).join("; ")}`, evidence);
  if (result.cleanupErrors?.length) return fail(`Cleanup failed: ${result.cleanupErrors.join("; ")}`, evidence);
  return null;
}

// ---------------------------------------------------------------------------
// client-launch-terminal / client-launch-desktop

export interface LaunchEvidence extends Common {
  runtime: "terminal" | "desktop";
  listing?: ClientListingLite;
  launched?: { buildKey: string; instanceId: string; granted: string[]; denied: string[] };
  rendered?: string;
  /** Desktop: opening the running client again focuses it. */
  relaunchInstanceId?: string;
  /** Desktop: a different client gets its own instance. */
  otherInstanceId?: string;
  /** Terminal: `echo hi | vibestudio chat ask`. */
  piped?: ShellResult;
  closedCleanly?: boolean;
}

const ANSI_OR_JSON = /\x1b\[|^\s*[{[]/u;

export function validateClientLaunch(result: TestExecutionResult, runtime: "terminal" | "desktop"): TestResult {
  const e = evidenceOf<LaunchEvidence>(result, "clientLaunch");
  if (!e) return { passed: false, reason: "The client launch retained no evidence" };
  const base = baseFailure(result, e);
  if (base) return base;
  if (e.runtime !== runtime) return fail(`Evidence is for ${e.runtime}`, e);
  if (!e.listing || e.listing.runtime !== (runtime === "desktop" ? "web" : "terminal") || !e.listing.trusted)
    return fail(`The ${runtime} host's client index has no trusted ${CHAT_ID} client`, e);
  const launched = e.launched;
  if (!launched) return fail("The client never launched", e);
  if (launched.buildKey !== e.listing.activeBuildKey)
    return fail(`The instance runs build ${launched.buildKey}, not the active build ${e.listing.activeBuildKey}`, e);
  if (!launched.granted.includes("device-session")) return fail("The launched client was not granted device-session", e);
  if (!e.rendered?.trim()) return fail("The launched client rendered nothing", e);
  if (runtime === "terminal") {
    if (!e.rendered.includes(ONLINE)) return fail("The chat did not show itself online", e);
    const piped = e.piped;
    if (!piped || piped.exitCode !== 0) return fail(`echo hi | vibestudio chat ask failed: ${piped?.output}`, e);
    const text = piped.output.trim();
    if (!text || ANSI_OR_JSON.test(text)) return fail(`chat ask must print the answer as plain text, got: ${piped.output.slice(0, 200)}`, e);
  } else {
    if (!e.relaunchInstanceId || e.relaunchInstanceId !== launched.instanceId)
      return fail("Opening a running client again did not focus its existing instance", e);
    if (!e.otherInstanceId || e.otherInstanceId === launched.instanceId)
      return fail("A second client did not get its own instance", e);
  }
  const restarted = restartFailure(e);
  if (restarted) return fail(restarted, e);
  if (!e.closedCleanly) return fail("The launched client did not close when the test closed it", e);
  return { passed: true };
}

async function orchestrateLaunch(
  context: Parameters<NonNullable<TestCase["orchestrate"]>>[0],
  runtime: "terminal" | "desktop"
): Promise<TestExecutionResult> {
  const evidence: LaunchEvidence = { runtime, phase: "record", completedPhases: [] };
  return runScenario(context, { name: `client-launch-${runtime}`, kind: runtime, evidence, diagnosticsKey: "clientLaunch", agent: false }, async ({ device }) => {
    evidence.before = await device.identities();
    evidence.phase = "list";
    evidence.listing = (await device.list()).find((l) => l.id === CHAT_ID);
    evidence.phase = "launch";
    const opened = await device.launch({ id: CHAT_ID });
    if (opened.state !== "ready") throw new Error(`${CHAT_ID} did not launch: ${JSON.stringify(opened)}`);
    const info = await opened.surface.info();
    evidence.launched = {
      buildKey: opened.instance.buildKey,
      instanceId: opened.instance.instanceId,
      granted: info.grantedCapabilities,
      denied: info.deniedOptional,
    };
    evidence.phase = "render";
    if (runtime === "terminal") evidence.rendered = await opened.surface.waitForText(ONLINE);
    else evidence.rendered = await opened.surface.text();
    if (runtime === "desktop") {
      evidence.phase = "focus";
      const again = await device.launch({ id: CHAT_ID });
      if (again.state === "ready") evidence.relaunchInstanceId = again.instance.instanceId;
      const other = (await device.list()).find((l) => l.isDefault && l.id !== CHAT_ID);
      if (other) {
        const second = await device.launch({ id: other.id });
        if (second.state === "ready") evidence.otherInstanceId = second.instance.instanceId;
      }
    }
    evidence.phase = "close";
    await opened.surface.close();
    evidence.closedCleanly = (await opened.surface.waitForClosed()).reason.length > 0;
    if (runtime === "terminal") {
      // A CLI profile admits one process per Iroh endpoint, so the piped
      // command runs once the open client has released it.
      evidence.phase = "pipe";
      evidence.piped = await device.call("shell", { commandLine: "echo hi | vibestudio chat ask" });
    }
    evidence.after = await device.identities();
  });
}

// ---------------------------------------------------------------------------
// client-intent-background

export interface BackgroundIntentEvidence extends Common {
  listing?: ClientListingLite;
  undeclaredIntent?: IntentOutcome;
  unknownParam?: IntentOutcome;
  foreground?: IntentOutcome;
  answer?: IntentOutcome;
}

export function validateClientIntentBackground(result: TestExecutionResult): TestResult {
  const e = evidenceOf<BackgroundIntentEvidence>(result, "clientIntentBackground");
  if (!e) return { passed: false, reason: "The background intent test retained no evidence" };
  const base = baseFailure(result, e);
  if (base) return base;
  const ask = e.listing?.intents.find((intent) => intent.name === "ask");
  if (ask?.kind !== "background" || !ask.handler?.includes("#"))
    return fail("The chat client's ask is not a background intent naming a service handler", e);
  for (const [label, outcome] of [
    ["an undeclared intent", e.undeclaredIntent],
    ["an undeclared parameter", e.unknownParam],
    ["a foreground intent", e.foreground],
  ] as const) {
    if (!outcome || outcome.ok) return fail(`clients.invokeIntent accepted ${label}`, e);
  }
  if (e.unknownParam && !e.unknownParam.ok && e.unknownParam.code !== "EINVAL")
    return fail(`An undeclared parameter was rejected with ${e.unknownParam.code}, not EINVAL`, e);
  const answer = e.answer;
  if (!answer?.ok || !answer.text.trim()) return fail(`ask returned no text: ${JSON.stringify(answer)}`, e);
  if (answer.fields.length !== 1 || answer.fields[0] !== "text")
    return fail(`A background intent returns text and nothing else; the result had ${answer.fields.join(", ")}`, e);
  if (e.before && e.after && e.after.instances.length !== e.before.instances.length)
    return fail("Running a background intent started or stopped a client instance", e);
  const restarted = restartFailure(e);
  if (restarted) return fail(restarted, e);
  return { passed: true };
}

async function orchestrateBackgroundIntent(
  context: Parameters<NonNullable<TestCase["orchestrate"]>>[0]
): Promise<TestExecutionResult> {
  const evidence: BackgroundIntentEvidence = { phase: "record", completedPhases: [] };
  return runScenario(context, { name: "client-intent-background", kind: "terminal", evidence, diagnosticsKey: "clientIntentBackground", agent: false }, async ({ device }) => {
    evidence.before = await device.identities();
    evidence.listing = (await device.list()).find((l) => l.id === CHAT_ID);
    evidence.phase = "rejections";
    evidence.undeclaredIntent = await device.call("invokeIntent", { id: CHAT_ID, intent: "no-such-intent" });
    evidence.unknownParam = await device.call("invokeIntent", { id: CHAT_ID, intent: "ask", params: { nonsense: "x" } });
    evidence.foreground = await device.call("invokeIntent", { id: CHAT_ID, intent: "open" });
    evidence.phase = "ask";
    evidence.answer = await device.call("invokeIntent", { id: CHAT_ID, intent: "ask", params: { text: "Reply with one short word." } });
    evidence.after = await device.identities();
  });
}

// ---------------------------------------------------------------------------
// client-update-swap

export interface UpdateSwapEvidence extends Common {
  nonce: string;
  launched?: { buildKey: string; instanceId: string; develop: boolean };
  /** After the edit is published: the running client keeps its build and is offered the new one. */
  offered?: { pendingBuildKey: string | null; runningBuildKey: string; text: string };
  /** After the person accepts at a safe point. */
  swapped?: { buildKey: string; text: string; bystandersUnchanged: boolean };
}

export function validateClientUpdateSwap(result: TestExecutionResult): TestResult {
  const e = evidenceOf<UpdateSwapEvidence>(result, "clientUpdateSwap");
  if (!e) return { passed: false, reason: "The update swap retained no evidence" };
  const base = baseFailure(result, e);
  if (base) return base;
  if (!e.launched || e.launched.develop) return fail("The client must run outside development mode, where updates are offered", e);
  const offered = e.offered;
  if (!offered?.pendingBuildKey || offered.pendingBuildKey === offered.runningBuildKey)
    return fail("The host did not hold a newer ready build for the running client", e);
  if (offered.runningBuildKey !== e.launched.buildKey)
    return fail("The running client changed build before the person accepted the update", e);
  if (!offered.text.includes("Update ready")) return fail("The client did not show that an update was ready", e);
  if (!offered.text.includes(greeting(e.nonce)) || offered.text.includes(updatedGreeting(e.nonce)))
    return fail("The running client did not keep its loaded build until the safe point", e);
  const swapped = e.swapped;
  if (!swapped || swapped.buildKey !== offered.pendingBuildKey)
    return fail("Accepting the update did not move the client to the offered build", e);
  if (!swapped.text.includes(updatedGreeting(e.nonce))) return fail("The swapped client does not show the new greeting", e);
  if (!swapped.bystandersUnchanged) return fail("Another client's instance identity changed during the swap", e);
  const restarted = restartFailure(e);
  if (restarted) return fail(restarted, e);
  return { passed: true };
}

async function orchestrateUpdateSwap(
  context: Parameters<NonNullable<TestCase["orchestrate"]>>[0]
): Promise<TestExecutionResult> {
  const runtime = "terminal" as const;
  const id = HELLO_ID[runtime];
  const nonce = `cus-${crypto.randomUUID().slice(0, 8)}`;
  const evidence: UpdateSwapEvidence = { phase: "record", completedPhases: [], nonce };
  return runScenario(context, { name: "client-update-swap", kind: runtime, evidence, diagnosticsKey: "clientUpdateSwap", agent: true }, async (frame) => {
    const { device } = frame;
    evidence.before = await device.identities();
    await frame.turn(prompts.create(runtime, nonce, { updateAware: true }), "create-declare-publish");
    evidence.phase = "launch";
    await device.call("waitForListing", { id, present: true });
    const opened = await device.launch({ id });
    if (opened.state !== "ready") throw new Error(`${id} did not launch: ${JSON.stringify(opened)}`);
    const surface = opened.surface;
    evidence.launched = { buildKey: opened.instance.buildKey, instanceId: opened.instance.instanceId, develop: false };
    await surface.waitForText(greeting(nonce));

    await frame.turn(prompts.edit(runtime, nonce), "edit-publish");
    evidence.phase = "offered";
    const text = await surface.waitForText("Update ready");
    const info = await surface.info();
    evidence.offered = { pendingBuildKey: info.pendingBuildKey, runningBuildKey: info.instance.buildKey, text };

    evidence.phase = "swap";
    await surface.sendKeys("u");
    const adopted = await device.call("waitForBuildChange", { surfaceId: surface.surfaceId, fromBuildKey: opened.instance.buildKey });
    const after = await surface.waitForText(updatedGreeting(nonce));
    const mid = await device.identities();
    evidence.swapped = { buildKey: adopted.buildKey, text: after, bystandersUnchanged: sameBystanders(evidence.before, mid, [id]) };

    evidence.phase = "retire";
    await frame.turn(prompts.retire(runtime, false), "retire");
    await surface.waitForClosed();
    evidence.after = await device.identities();
  });
}

// ---------------------------------------------------------------------------

const harness = {
  category: "clients",
  validation: "harness" as const,
};

export const clientLaunchTests: TestCase[] = [
  ...requiringUnits(["clients/chat-terminal"], [
    {
      ...harness,
      name: "client-launch-terminal",
      description: "A paired terminal host opens the chat client in its terminal, verified to the active build, and `echo hi | vibestudio chat ask` prints the answer as plain text",
      timeoutMs: 20 * 60_000,
      resources: ["client-device:terminal"],
      prompt: "Harness-orchestrated terminal client launch through a paired device host.",
      orchestrate: (context) => orchestrateLaunch(context, "terminal"),
      validate: (result) => validateClientLaunch(result, "terminal"),
    },
    {
      ...harness,
      name: "client-intent-background",
      description: "A background intent runs server-side as the client principal, returns text only, and rejects undeclared intents, parameters and foreground intents",
      timeoutMs: 20 * 60_000,
      resources: ["client-device:terminal"],
      prompt: "Harness-orchestrated background intent invocation through a paired device host.",
      orchestrate: orchestrateBackgroundIntent,
      validate: validateClientIntentBackground,
    },
  ]),
  ...requiringUnits(["clients/chat-desktop"], [
    {
      ...harness,
      name: "client-launch-desktop",
      description: "A headless desktop host opens the chat client in its own window from the verified cache, focuses it on reopen, and gives another client its own instance",
      timeoutMs: 20 * 60_000,
      resources: ["client-device:desktop"],
      prompt: "Harness-orchestrated desktop client launch through a paired device host.",
      orchestrate: (context) => orchestrateLaunch(context, "desktop"),
      validate: (result) => validateClientLaunch(result, "desktop"),
    },
  ]),
  ...requiringUnits(["skills/clientdev"], [
    {
      ...harness,
      name: "client-update-swap",
      description: "A running terminal client keeps its loaded build when an edit is published, is offered the new one, and swaps to it at its safe point without disturbing any other client",
      timeoutMs: 45 * 60_000,
      resources: ["client-device:terminal", "vcs:protected-main"],
      authorityPolicy: CLIENT_AUTHORING_POLICY,
      prompt: "Harness-orchestrated client update offer and swap through a paired device host.",
      orchestrate: orchestrateUpdateSwap,
      validate: validateClientUpdateSwap,
    },
  ]),
];
