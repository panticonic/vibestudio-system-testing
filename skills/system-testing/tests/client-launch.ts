import { requiringUnits, type TestCase, type TestExecutionResult, type TestResult } from "../types.js";
import type {
  ClientDevice,
  ClientListingLite,
  ClientSessionOutcome,
  DeviceIdentities,
  IntentOutcome,
  ShellResult,
} from "./_client-device.js";
import {
  CLIENT_AUTHORING_POLICY,
  helloId,
  greeting,
  prompts,
  restartFailure,
  runScenario,
  sameBystanders,
  updatedGreeting,
  type ApprovalConsent,
  type ApprovalRecord,
} from "./_client-scenario.js";

/**
 * Launch, background-intent and update tests of the client hosts
 * (docs/client-hosts-and-clients-plan.md §10). They run the template chat
 * clients (the worked examples) except `client-update-swap`, which needs a
 * client whose source it can publish new builds of.
 */

const CHAT_ID = "chat";
/**
 * The desktop shell client: the one that hosts panels (the chat window does
 * not) and whose manifest requests the workspace runtime-state authority.
 */
const BROWSER_ID = "browser";
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
    if (!piped || piped.exitCode !== 0) return fail(`echo hi | vibestudio chat ask failed: ${piped?.stderr || piped?.output}`, e);
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
  return runScenario(context, { name: `client-launch-${runtime}`, kind: runtime, evidence, diagnosticsKey: "clientLaunch", agent: false, consent: { modelUse: runtime === "terminal" } }, async ({ device }) => {
    evidence.before = await device.identities();
    evidence.phase = "list";
    evidence.listing = (await device.list()).find((l) => l.id === CHAT_ID);
    evidence.phase = "launch";
    const opened = await device.launch({ id: CHAT_ID });
    if (opened.state !== "ready") throw new Error(`${CHAT_ID} did not launch: ${JSON.stringify(opened)}`);
    // The build a client runs is made by launching it, so the active build the
    // instance is checked against is the one the index names once it has.
    evidence.listing = (await device.list()).find((l) => l.id === CHAT_ID);
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
      // The piped command is a second CLI process of the same device, run once
      // the open client has closed.
      evidence.phase = "pipe";
      evidence.piped = await device.call("shell", { commandLine: "echo hi | vibestudio chat ask" });
    }
    evidence.after = await device.identities();
  });
}

// ---------------------------------------------------------------------------
// client-panel-creation-desktop

type PanelCreated = Awaited<ReturnType<ClientDevice["createPanelAsClient"]>>;

/** One private workspace of the account and a panel source that ships in it. */
const PANEL_TARGETS = [
  { workspace: "system", source: "about/about" },
  { workspace: "personal", source: "panels/tour" },
] as const;

export interface PanelCreationEvidence extends Common {
  launched?: { instanceId: string };
  created: Partial<Record<(typeof PANEL_TARGETS)[number]["workspace"], PanelCreated>>;
  closedCleanly?: boolean;
}

export function validateClientPanelCreation(result: TestExecutionResult): TestResult {
  const e = evidenceOf<PanelCreationEvidence>(result, "clientPanelCreation");
  if (!e) return { passed: false, reason: "The client panel creation retained no evidence" };
  const base = baseFailure(result, e);
  if (base) return base;
  if (!e.launched) return fail("The client never launched", e);
  const workspaceIds = new Set<string>();
  for (const { workspace } of PANEL_TARGETS) {
    const created = e.created[workspace];
    if (!created?.panelId) return fail(`The client window created no panel in the ${workspace} workspace`, e);
    if (!created.registered) return fail(`The ${workspace} workspace's panel registry does not hold ${created.panelId}`, e);
    workspaceIds.add(created.workspaceId);
  }
  if (workspaceIds.size !== PANEL_TARGETS.length) return fail("The System and Personal panels were created in the same workspace", e);
  const restarted = restartFailure(e);
  if (restarted) return fail(restarted, e);
  if (!e.closedCleanly) return fail("The launched client did not close when the test closed it", e);
  return { passed: true };
}

async function orchestratePanelCreation(
  context: Parameters<NonNullable<TestCase["orchestrate"]>>[0]
): Promise<TestExecutionResult> {
  const evidence: PanelCreationEvidence = { phase: "record", completedPhases: [], created: {} };
  return runScenario(context, { name: "client-panel-creation-desktop", kind: "desktop", evidence, diagnosticsKey: "clientPanelCreation", agent: false, consent: { modelUse: false } }, async ({ device }) => {
    evidence.before = await device.identities();
    evidence.phase = "launch";
    const opened = await device.launch({ id: BROWSER_ID });
    if (opened.state !== "ready") throw new Error(`${BROWSER_ID} did not launch: ${JSON.stringify(opened)}`);
    evidence.launched = { instanceId: opened.instance.instanceId };
    // The window creates panels as its client principal in each private
    // workspace: the scoped session, build default ref and entity reservation
    // of the second workspace connection are all on this path.
    for (const { workspace, source } of PANEL_TARGETS) {
      evidence.phase = `create-${workspace}`;
      evidence.created[workspace] = await device.createPanelAsClient({ surfaceId: opened.surface.surfaceId, workspace, source });
    }
    evidence.phase = "close";
    await opened.surface.close();
    evidence.closedCleanly = (await opened.surface.waitForClosed()).reason.length > 0;
    evidence.after = await device.identities();
  });
}

// ---------------------------------------------------------------------------
// client-approval-desktop

/**
 * A call that is gated for a client principal and harmless: it rebuilds the
 * workspace's panel-search index from its active panels. The person sees its
 * card as "Manage running apps and tasks".
 */
const GATED_CALL = {
  service: "workspace-state",
  method: "panel.rebuildIndex",
  capability: "workspace.runtime-state.manage",
} as const;

type ClientCalled = Awaited<ReturnType<ClientDevice["callAsClient"]>>;

export interface ClientApprovalEvidence extends Common {
  launched?: { instanceId: string };
  /** The gated call's outcome in each private workspace; the call returns only once its approval was accepted. */
  called: Partial<Record<(typeof PANEL_TARGETS)[number]["workspace"], ClientCalled>>;
  closedCleanly?: boolean;
}

export function validateClientApproval(result: TestExecutionResult): TestResult {
  const e = evidenceOf<ClientApprovalEvidence>(result, "clientApproval");
  if (!e) return { passed: false, reason: "The client approval test retained no evidence" };
  const base = baseFailure(result, e);
  if (base) return base;
  if (!e.launched) return fail("The client never launched", e);
  const principals = new Set<string>();
  const workspaceIds = new Set<string>();
  for (const { workspace } of PANEL_TARGETS) {
    const called = e.called[workspace];
    if (!called) return fail(`The client's gated call did not complete in the ${workspace} workspace`, e);
    principals.add(called.principalId);
    workspaceIds.add(called.workspaceId);
  }
  if (principals.size !== 1) return fail(`The calls were made as different principals: ${[...principals].join(", ")}`, e);
  if (workspaceIds.size !== PANEL_TARGETS.length) return fail("The System and Personal calls ran in the same workspace", e);
  const [principalId] = principals;
  const answered = (e.approvals ?? []).filter(
    (a) => a.capability === GATED_CALL.capability && a.callerId === principalId && a.decision === "once"
  );
  if (answered.length < PANEL_TARGETS.length)
    return fail(
      `${GATED_CALL.capability} was asked of ${principalId} ${answered.length} time(s) on the approval surface, once per workspace was expected`,
      e
    );
  const restarted = restartFailure(e);
  if (restarted) return fail(restarted, e);
  if (!e.closedCleanly) return fail("The launched client did not close when the test closed it", e);
  return { passed: true };
}

async function orchestrateClientApproval(
  context: Parameters<NonNullable<TestCase["orchestrate"]>>[0]
): Promise<TestExecutionResult> {
  const evidence: ClientApprovalEvidence = { phase: "record", completedPhases: [], called: {} };
  // The person agrees in advance to the one request the scenario provokes, of the client it launches.
  const consent: ApprovalConsent = {
    clientCapabilities: [{ capability: GATED_CALL.capability, callerIdPrefix: `client:${BROWSER_ID}:` }],
  };
  return runScenario(context, { name: "client-approval-desktop", kind: "desktop", evidence, diagnosticsKey: "clientApproval", agent: false, consent }, async ({ device }) => {
    evidence.before = await device.identities();
    evidence.phase = "launch";
    const opened = await device.launch({ id: BROWSER_ID });
    if (opened.state !== "ready") throw new Error(`${BROWSER_ID} did not launch: ${JSON.stringify(opened)}`);
    evidence.launched = { instanceId: opened.instance.instanceId };
    // The call is made over the window's own principal session and waits for the
    // decision as that principal: it returns only after the approval surface
    // accepted the card, and fails with the server's original error if the
    // acquisition were owned by anyone else.
    for (const { workspace } of PANEL_TARGETS) {
      evidence.phase = `call-${workspace}`;
      evidence.called[workspace] = await device.callAsClient({
        surfaceId: opened.surface.surfaceId,
        workspace,
        service: GATED_CALL.service,
        method: GATED_CALL.method,
      });
    }
    evidence.phase = "close";
    await opened.surface.close();
    evidence.closedCleanly = (await opened.surface.waitForClosed()).reason.length > 0;
    evidence.after = await device.identities();
  });
}

// ---------------------------------------------------------------------------
// client-revoke-desktop

/** The reasons the server states when it ends a client's principal for good. */
const REVOKED_REASONS = ["trust-revoked", "retired"];

export interface ClientRevokeEvidence extends Common {
  launched?: { instanceId: string; principalOpen: ClientSessionOutcome };
  closedReason?: string;
  /** A new session of the revoked principal, per workspace. */
  afterRevoke: Partial<Record<(typeof PANEL_TARGETS)[number]["workspace"], ClientSessionOutcome>>;
}

export function validateClientRevoke(result: TestExecutionResult): TestResult {
  const e = evidenceOf<ClientRevokeEvidence>(result, "clientRevoke");
  if (!e) return { passed: false, reason: "The client revoke test retained no evidence" };
  const base = baseFailure(result, e);
  if (base) return base;
  if (!e.launched) return fail("The client never launched", e);
  if (!e.launched.principalOpen.ok)
    return fail(`The running client's principal was not admitted before the revoke, so a refusal afterwards proves nothing: ${JSON.stringify(e.launched.principalOpen)}`, e);
  if (!e.closedReason || !REVOKED_REASONS.includes(e.closedReason))
    return fail(`The host closed the window with ${JSON.stringify(e.closedReason)}, not ${REVOKED_REASONS.join(" or ")}`, e);
  for (const { workspace } of PANEL_TARGETS) {
    const outcome = e.afterRevoke[workspace];
    if (!outcome) return fail(`The revoked principal was not tried in the ${workspace} workspace`, e);
    if (outcome.ok) return fail(`The ${workspace} workspace admitted a new session with the revoked principal's credential`, e);
    // The host must have presented the old credential and the server refused it.
    if (/No client launched/u.test(outcome.message))
      return fail(`The host no longer held the credential, so the server was never asked in ${workspace}: ${outcome.message}`, e);
  }
  const restarted = restartFailure(e);
  if (restarted) return fail(restarted, e);
  return { passed: true };
}

async function orchestrateClientRevoke(
  context: Parameters<NonNullable<TestCase["orchestrate"]>>[0]
): Promise<TestExecutionResult> {
  const evidence: ClientRevokeEvidence = { phase: "record", completedPhases: [], afterRevoke: {} };
  return runScenario(context, { name: "client-revoke-desktop", kind: "desktop", evidence, diagnosticsKey: "clientRevoke", agent: false, consent: { modelUse: false } }, async ({ device }) => {
    evidence.before = await device.identities();
    evidence.phase = "launch";
    const opened = await device.launch({ id: CHAT_ID });
    if (opened.state !== "ready") throw new Error(`${CHAT_ID} did not launch: ${JSON.stringify(opened)}`);
    const surfaceId = opened.surface.surfaceId;
    evidence.launched = {
      instanceId: opened.instance.instanceId,
      principalOpen: await device.call("openClientSession", { surfaceId, workspace: "system" }),
    };
    // The workspace retires the client; the hub revokes its principals and
    // closes their sessions, and the host closes the window on that signal.
    // The client is not removed: a later launch runs it again.
    evidence.phase = "revoke";
    await device.call("retireClient", { id: CHAT_ID });
    evidence.closedReason = (await opened.surface.waitForClosed()).reason;
    for (const { workspace } of PANEL_TARGETS) {
      evidence.phase = `refused-${workspace}`;
      evidence.afterRevoke[workspace] = await device.call("openClientSession", { surfaceId, workspace });
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
  return runScenario(context, { name: "client-intent-background", kind: "terminal", evidence, diagnosticsKey: "clientIntentBackground", agent: false, consent: { modelUse: true } }, async ({ device }) => {
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
  const nonce = `cus-${crypto.randomUUID().slice(0, 8)}`;
  const id = helloId(runtime, nonce);
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
    await frame.turn(prompts.retire(runtime, nonce, false), "retire");
    await device.call("waitForListing", { id, present: false });
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
    {
      ...harness,
      name: "client-panel-creation-desktop",
      description: "A desktop client window creates a panel in the System and in the Personal workspace through its principal's scoped session, and each workspace's registry holds the panel",
      timeoutMs: 20 * 60_000,
      resources: ["client-device:desktop"],
      prompt: "Harness-orchestrated panel creation as a desktop client window through a paired device host.",
      orchestrate: orchestratePanelCreation,
      validate: validateClientPanelCreation,
    },
    {
      ...harness,
      name: "client-approval-desktop",
      description: "A desktop client window's gated call over its own principal session raises an approval owned by that principal in the System and in the Personal workspace; accepting it on the approval surface completes the original call",
      timeoutMs: 20 * 60_000,
      resources: ["client-device:desktop"],
      prompt: "Harness-orchestrated gated call as a desktop client window through a paired device host.",
      orchestrate: orchestrateClientApproval,
      validate: validateClientApproval,
    },
    {
      ...harness,
      name: "client-revoke-desktop",
      description: "Retiring a running desktop client revokes its principal at the hub: the host closes the window with the server's stated reason and a new session with the old credential is refused in both private workspaces",
      timeoutMs: 20 * 60_000,
      resources: ["client-device:desktop"],
      prompt: "Harness-orchestrated client revocation through a paired device host.",
      orchestrate: orchestrateClientRevoke,
      validate: validateClientRevoke,
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
