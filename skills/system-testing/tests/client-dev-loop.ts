import { requiringUnits, type TestCase, type TestExecutionResult, type TestResult } from "../types.js";
import type {
  ClientListingLite,
  DeviceIdentities,
  IntegrationArtifact,
  LaunchOutcome,
} from "./_client-device.js";
import {
  CLIENT_AUTHORING_POLICY,
  HELLO_ID,
  UNSUPPORTED_CAPABILITY,
  echoed,
  greeting,
  prompts,
  restartFailure,
  runScenario,
  sameBystanders,
  unsupportedId,
  updatedGreeting,
  type ApprovalRecord,
  type ClientRuntimeKind,
} from "./_client-scenario.js";

/**
 * `client-dev-loop-<runtime>`: docs/client-hosts-and-clients-plan.md §7.4.
 *
 * A device host that was running BEFORE the client existed gets a new client
 * authored by an agent following the `clientdev` skill: declared, published,
 * reviewed, launched, edited live in development mode, given an OS launcher,
 * retired. Throughout, the server boot id, the host process id and every other
 * client instance are the ones recorded at the start.
 */

export type DevLoopEvidence = {
  runtime: ClientRuntimeKind;
  phase: string;
  completedPhases: string[];
  nonce: string;
  /** Step 1. */
  before?: DeviceIdentities;
  /** Step 3: the device's client index after publication, with no restart. */
  listing?: ClientListingLite;
  launch?: { state: LaunchOutcome["state"]; buildKey?: string; instanceId?: string; develop: boolean };
  /** Step 4. */
  rendered?: { text: string; hasGreeting: boolean };
  echo?: { sent: string; ok: boolean; text?: string; code?: string; message?: string };
  /** Step 5. */
  update?: {
    fromBuildKey: string;
    toBuildKey?: string;
    shownText: string;
    showsNewGreeting: boolean;
    bystandersUnchanged: boolean;
  };
  /** Step 6. */
  integration?: {
    installed?: IntegrationArtifact;
    artifactExistedAfterInstall?: boolean;
    removedAfterRetire?: boolean;
    listingGoneAfterRetire?: boolean;
    closedReason?: string;
  };
  /** Step 8. */
  negative?: { id: string; capability: string; state?: string; reason?: string; missing?: string[]; listingReason?: string };
  /** Step 9 (desktop). */
  trust?: {
    cards: Array<{ critical?: boolean; gained: string[]; lost: string[]; source: string }>;
    grantedLive?: string[];
    revoked?: { reason: string };
  };
  after?: DeviceIdentities;
  approvals?: ApprovalRecord[];
};

const checkText = (text: string, needle: string) => text.includes(needle);

function fail(reason: string, evidence: DevLoopEvidence): TestResult {
  return { passed: false, reason, details: { phase: evidence.phase, completedPhases: evidence.completedPhases } };
}

/** Judge the retained evidence in the order a failure is most specific. */
export function validateClientDevLoop(result: TestExecutionResult, runtime: ClientRuntimeKind): TestResult {
  const evidence = result.diagnostics?.["clientDevLoop"] as DevLoopEvidence | undefined;
  if (!evidence) return { passed: false, reason: "The client dev loop retained no evidence" };
  if (result.error) return fail(`The scenario failed during ${evidence.phase}: ${result.error}`, evidence);
  if (evidence.runtime !== runtime) return fail(`Evidence is for ${evidence.runtime}, not ${runtime}`, evidence);
  const id = HELLO_ID[runtime];
  const nonce = evidence.nonce;

  const unexpected = (evidence.approvals ?? []).filter((record) => record.decision === "deny");
  if (unexpected.length)
    return fail(`Approvals nobody was meant to decide reached the person: ${unexpected.map((a) => a.title ?? a.kind).join("; ")}`, evidence);
  if (!evidence.approvals?.some((record) => record.kind === "unit-install-review"))
    return fail("No unit install review was shown for the new client", evidence);

  // Steps 2-3.
  const listing = evidence.listing;
  if (!listing || listing.id !== id || listing.runtime !== (runtime === "desktop" ? "web" : "terminal"))
    return fail(`The device's client index never gained ${id} for the ${runtime} runtime`, evidence);
  const echo = listing.intents.find((intent) => intent.name === "echo");
  if (echo?.kind !== "background" || !echo.handler)
    return fail("The published client does not declare a background echo intent with a handler", evidence);
  if (evidence.launch?.state !== "ready") return fail(`Launching ${id} did not become ready: ${evidence.launch?.state}`, evidence);

  // Step 4.
  if (!evidence.rendered?.hasGreeting || !checkText(evidence.rendered.text, greeting(nonce)))
    return fail("The launched client did not render its greeting", evidence);
  if (!evidence.echo?.ok || evidence.echo.text !== echoed(evidence.echo.sent))
    return fail(`clients.invokeIntent(echo) did not return the echoed text: ${JSON.stringify(evidence.echo)}`, evidence);

  // Step 5.
  const update = evidence.update;
  if (!evidence.launch.develop) return fail("The client was not launched in development mode", evidence);
  if (!update?.toBuildKey || update.toBuildKey === update.fromBuildKey)
    return fail("Publishing an edit did not move the running client to a new build", evidence);
  if (!update.showsNewGreeting || !checkText(update.shownText, updatedGreeting(nonce)))
    return fail("The running client does not show the edited greeting", evidence);
  if (!update.bystandersUnchanged) return fail("Another client's instance identity changed during the update", evidence);

  // Step 9 (desktop).
  if (runtime === "desktop") {
    const trust = evidence.trust;
    const card = trust?.cards.find((c) => c.source.includes(id));
    if (!card?.critical) return fail("Adding the client to trust.clients did not raise a fresh critical confirmation", evidence);
    if (!card.gained.length) return fail("The trust card did not list the capabilities gained", evidence);
    if (!card.gained.every((capability) => trust?.grantedLive?.includes(capability)))
      return fail("Approving the trust change did not give the running client its capabilities live", evidence);
    if (trust?.revoked?.reason !== "trust-revoked")
      return fail(`Removing the client from trust.clients did not close its device sessions with trust-revoked: ${JSON.stringify(trust?.revoked)}`, evidence);
    if (!trust.cards.some((c) => c.lost.length && c.source.includes(id)))
      return fail("Removing trust did not raise a confirmation naming the capabilities lost", evidence);
  }

  // Step 6.
  const integration = evidence.integration;
  if (!integration?.installed || !integration.artifactExistedAfterInstall)
    return fail("Installing the launcher left no OS artifact", evidence);
  if (!integration.removedAfterRetire || !integration.listingGoneAfterRetire)
    return fail("Retiring the client left its launcher or its index entry behind", evidence);
  if (!integration.closedReason) return fail("Retiring the client did not close its running instance with a stated reason", evidence);

  // Step 8.
  const negative = evidence.negative;
  const capability = UNSUPPORTED_CAPABILITY[runtime];
  if (negative?.state !== "unavailable") return fail(`A client requiring ${capability} was ${negative?.state ?? "never launched"}, not unavailable`, evidence);
  if (!(negative.missing?.includes(capability) || negative.reason?.includes(capability)))
    return fail(`unavailable did not name ${capability}: ${JSON.stringify(negative)}`, evidence);
  if (/restart/iu.test(negative.reason ?? "")) return fail("unavailable offered a restart", evidence);

  // Step 7.
  const restarted = restartFailure(evidence);
  if (restarted) return fail(restarted, evidence);
  if (!sameBystanders(evidence.before!, evidence.after!, [id, unsupportedId(runtime)]))
    return fail("A client instance other than the new one changed identity", evidence);
  if (result.cleanupErrors?.length) return fail(`Cleanup failed: ${result.cleanupErrors.join("; ")}`, evidence);
  return { passed: true, details: { runtime, buildKey: update.toBuildKey } };
}

async function orchestrate(
  context: Parameters<NonNullable<TestCase["orchestrate"]>>[0],
  runtime: ClientRuntimeKind
): Promise<TestExecutionResult> {
  const id = HELLO_ID[runtime];
  const nonce = `cdl-${crypto.randomUUID().slice(0, 8)}`;
  const evidence: DevLoopEvidence = { runtime, phase: "record", completedPhases: [], nonce };
  return runScenario(context, { name: `client-dev-loop-${runtime}`, kind: runtime, evidence, diagnosticsKey: "clientDevLoop", agent: true }, async (frame) => {
    const { device, approvals } = frame;

    // 1. Identities, with one bystander client already running.
    const listings = await device.list();
    const bystander = listings.find((l) => l.isDefault && l.id !== id);
    if (bystander) {
      const opened = await device.launch({ id: bystander.id });
      if (opened.state !== "ready") throw new Error(`The default client ${bystander.id} did not launch: ${JSON.stringify(opened)}`);
    }
    evidence.before = await device.identities();

    // 2-3. Author, declare, publish, review; the index gains the client.
    await frame.turn(prompts.create(runtime, nonce), "create-declare-publish");
    evidence.phase = "index";
    evidence.listing = (await device.call("waitForListing", { id, present: true })) ?? undefined;
    if (runtime === "terminal") {
      // Linking the launcher before the client runs keeps the order the person
      // would follow: the shim exists before the first `vibestudio open`.
      const bin = await device.call("binDirectory", {});
      const linked = await device.call("shell", { commandLine: `PATH="${bin}:$PATH" vibestudio clients link ${id} --name ${id}` });
      if (linked.exitCode !== 0) throw new Error(`vibestudio clients link failed: ${linked.stderr || linked.output}`);
    }
    const launched = await device.launch({ id, develop: true });
    evidence.launch = {
      state: launched.state,
      develop: true,
      ...(launched.state === "ready" ? { buildKey: launched.instance.buildKey, instanceId: launched.instance.instanceId } : {}),
    };
    if (launched.state !== "ready") throw new Error(`${id} did not launch: ${JSON.stringify(launched)}`);
    const surface = launched.surface;

    // 4. It renders and its background intent answers.
    evidence.phase = "render";
    const text = await surface.waitForText(greeting(nonce));
    evidence.rendered = { text, hasGreeting: text.includes(greeting(nonce)) };
    const sent = `ping-${nonce}`;
    const outcome = await device.call("invokeIntent", { id, intent: "echo", params: { text: sent } });
    evidence.echo = { sent, ...(outcome.ok ? { ok: true, text: outcome.text } : { ok: false, code: outcome.code, message: outcome.message }) };

    // 5. Edit in development mode: the same client moves to the new build in place.
    const fromBuildKey = launched.instance.buildKey;
    await frame.turn(prompts.edit(runtime, nonce), "edit-publish");
    evidence.phase = "adopt";
    const adopted = await device.call("waitForBuildChange", { surfaceId: surface.surfaceId, fromBuildKey });
    const shownText = await surface.waitForText(updatedGreeting(nonce));
    const mid = await device.identities();
    evidence.update = {
      fromBuildKey,
      toBuildKey: adopted.buildKey,
      shownText,
      showsNewGreeting: shownText.includes(updatedGreeting(nonce)),
      bystandersUnchanged: sameBystanders(evidence.before, mid, [id]),
    };

    // 9. Trust (desktop): a fresh critical confirmation, applied live, revoked with a reason.
    if (runtime === "desktop") {
      evidence.phase = "trust";
      evidence.trust = { cards: [] };
      await frame.turn(prompts.trust(runtime), "trust-add");
      evidence.trust.cards = approvals.trustCards().map((card) => ({ ...card.trust![0]!, critical: card.critical }));
      const addCard = evidence.trust.cards[0];
      if (!addCard) throw new Error(`The agent's turn ended without a trust confirmation reaching the device for ${id}`);
      const granted = [] as string[];
      for (const capability of addCard?.gained ?? []) {
        const info = await device.call("waitForGranted", { surfaceId: surface.surfaceId, capability });
        if (info.grantedCapabilities.includes(capability)) granted.push(capability);
      }
      evidence.trust.grantedLive = granted;
      await frame.turn(prompts.untrust(runtime), "trust-remove");
      evidence.trust.cards = approvals.trustCards().map((card) => ({ ...card.trust![0]!, critical: card.critical }));
      if (!evidence.trust.cards.some((card) => card.lost.length))
        throw new Error(`The agent's turn ended without a trust confirmation naming what ${id} loses`);
      evidence.trust.revoked = await device.call("waitForSessionClosed", { clientId: id });
    }

    // 6. Launcher, then retire.
    evidence.phase = "install-launcher";
    const integration: NonNullable<DevLoopEvidence["integration"]> = (evidence.integration = {});
    integration.installed = await device.call("installLauncher", { id });
    integration.artifactExistedAfterInstall = (await device.call("integrationArtifacts", {})).some(
      (artifact) => artifact.clientId === id && artifact.path === integration.installed!.path
    );
    // The negative case needs its own client; retire both together afterwards.
    evidence.phase = "negative";
    const negId = unsupportedId(runtime);
    await frame.turn(prompts.unsupported(runtime), "unsupported-client");
    await device.call("waitForListing", { id: negId, present: true });
    const unavailable = await device.launch({ id: negId });
    const listed = (await device.list()).find((l) => l.id === negId);
    evidence.negative = {
      id: negId,
      capability: UNSUPPORTED_CAPABILITY[runtime],
      state: unavailable.state,
      ...(unavailable.state === "unavailable"
        ? { reason: unavailable.reason, missing: unavailable.missing?.capabilities ?? [] }
        : {}),
      ...(listed?.unavailableReason ? { listingReason: listed.unavailableReason } : {}),
    };

    evidence.phase = "retire";
    await frame.turn(prompts.retire(runtime), "retire");
    await device.call("waitForListing", { id, present: false });
    integration.closedReason = (await surface.waitForClosed()).reason;
    await device.call("waitForArtifactsRemoved", { clientId: id });
    integration.removedAfterRetire = !(await device.call("integrationArtifacts", {})).some((a) => a.clientId === id);
    integration.listingGoneAfterRetire = true;

    // 7. Nothing restarted.
    evidence.after = await device.identities();
  });
}

const RUNTIME_DESCRIPTION: Record<ClientRuntimeKind, string> = {
  terminal: "an agent authors a terminal client following clientdev; it is published, opened with vibestudio open, edited live, linked as a shim and retired with no restart",
  desktop: "an agent authors a desktop client following clientdev; it is published, launched in its own window, edited live, trusted, given a .desktop launcher and retired with no restart",
};

export const clientDevLoopTests: TestCase[] = requiringUnits(
  ["skills/clientdev"],
  (["terminal", "desktop"] as const).map(
    (runtime): TestCase => ({
      name: `client-dev-loop-${runtime}`,
      description: `Develop and deploy a ${runtime} client on a running server and host: ${RUNTIME_DESCRIPTION[runtime]}`,
      category: "clients",
      timeoutMs: 60 * 60_000,
      resources: [`client-device:${runtime}`, "vcs:protected-main"],
      authorityPolicy: CLIENT_AUTHORING_POLICY,
      prompt: "Harness-orchestrated client development loop driven through a paired device host.",
      validation: "harness",
      orchestrate: (context) => orchestrate(context, runtime),
      validate: (result) => validateClientDevLoop(result, runtime),
    })
  )
);
