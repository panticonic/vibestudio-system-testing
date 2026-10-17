import type { PendingApproval } from "@vibestudio/shared/approvals";
import { appendSystemTestCleanupFailure, systemTestFailure } from "../structured-error.js";
import type {
  TestExecutionResult,
  TestOrchestrationContext,
  TestAuthorityPolicy,
} from "../types.js";
import type { HeadlessSession } from "@workspace/agentic-session";
import {
  openClientDevice,
  type ClientDevice,
  type ClientDeviceKind,
  type ClientInstanceIdentity,
  type ClientListingLite,
  type DeviceIdentities,
} from "./_client-device.js";

/**
 * Shared machinery of the client system tests: the user-facing prompts an
 * agent receives, the approval surface the device plays for the person, and
 * the identity comparisons that prove nothing restarted.
 */

export type ClientRuntimeKind = ClientDeviceKind;

export const HELLO_ID: Record<ClientRuntimeKind, string> = {
  terminal: "hello-terminal",
  desktop: "hello-desktop",
};

/** A required capability this runtime's host does not implement. */
export const UNSUPPORTED_CAPABILITY: Record<ClientRuntimeKind, string> = {
  terminal: "camera",
  desktop: "terminal-app-hosting",
};

export function unsupportedId(runtime: ClientRuntimeKind): string {
  return `${HELLO_ID[runtime]}-unsupported`;
}

export function greeting(nonce: string): string {
  return `Hello ${nonce}`;
}
export function updatedGreeting(nonce: string): string {
  return `Hello again ${nonce}`;
}
export function echoed(text: string): string {
  return `echo: ${text}`;
}

const SURFACE: Record<ClientRuntimeKind, string> = {
  terminal: "terminal client that shows the greeting and quits when I press q",
  desktop: "desktop client whose window shows the greeting",
};

export const prompts = {
  create(runtime: ClientRuntimeKind, nonce: string, options: { updateAware?: boolean } = {}): string {
    const id = HELLO_ID[runtime];
    const update = options.updateAware
      ? " When the host tells it that a newer build of itself is ready, it shows the line `Update ready` and, when I press u, restarts into the new build at that point."
      : "";
    const trust =
      runtime === "desktop"
        ? " It may use the device approval surface when it is trusted, but it must run without it."
        : " It needs no device-level powers, so keep it out of the trusted clients.";
    return [
      `I want a new ${SURFACE[runtime]}, with client id ${id}, in my System workspace.`,
      `Its greeting is \`${greeting(nonce)}\`.`,
      "It also has a background action called echo that takes some text and returns it as `echo: <text>`.",
      update,
      trust,
      "Follow the clientdev skill's development loop: declare it in the workspace manifest and publish it.",
      "Tell me when it is published.",
    ]
      .filter(Boolean)
      .join(" ");
  },
  edit(runtime: ClientRuntimeKind, nonce: string): string {
    return `Change the greeting of ${HELLO_ID[runtime]} to \`${updatedGreeting(nonce)}\` and publish it.`;
  },
  trust(runtime: ClientRuntimeKind): string {
    return `Make ${HELLO_ID[runtime]} a trusted client so it can use the device approval surface, and publish. The workspace owner will confirm the change.`;
  },
  untrust(runtime: ClientRuntimeKind): string {
    return `Remove ${HELLO_ID[runtime]} from the trusted clients and publish.`;
  },
  unsupported(runtime: ClientRuntimeKind): string {
    return `Create one more minimal ${runtime} client with id ${unsupportedId(runtime)} that cannot run without the \`${UNSUPPORTED_CAPABILITY[runtime]}\` capability, declare it and publish it.`;
  },
  retire(runtime: ClientRuntimeKind, withUnsupported = true): string {
    const names = withUnsupported ? `${HELLO_ID[runtime]} and ${unsupportedId(runtime)}` : HELLO_ID[runtime];
    return `Retire ${names}: remove ${withUnsupported ? "them" : "it"} and the echo service you added from the workspace, and publish.`;
  },
};

/** The decisions the harness's test authority policy makes for the agent. */
export const CLIENT_AUTHORING_POLICY: TestAuthorityPolicy = {
  authority: ["workspace.publish", "git.publish"].map((key) => ({
    ruleId: `client-authoring-${key}`,
    capability: { kind: "exact" as const, key },
    resource: { kind: "prefix" as const, prefix: "workspace-source-change:publication:" },
    tier: "gated" as const,
    decision: "once" as const,
  })),
};

// ---------------------------------------------------------------------------
// Identities

export function sameInstance(a: ClientInstanceIdentity, b: ClientInstanceIdentity): boolean {
  return a.clientId === b.clientId && a.instanceId === b.instanceId && a.buildKey === b.buildKey;
}

/** Instances of every client except `exceptClientIds`, ordered for comparison. */
export function bystanders(
  identities: DeviceIdentities,
  exceptClientIds: readonly string[]
): ClientInstanceIdentity[] {
  return identities.instances
    .filter((instance) => !exceptClientIds.includes(instance.clientId))
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
}

export function sameBystanders(
  before: DeviceIdentities,
  after: DeviceIdentities,
  exceptClientIds: readonly string[]
): boolean {
  const a = bystanders(before, exceptClientIds);
  const b = bystanders(after, exceptClientIds);
  return a.length === b.length && a.every((instance, index) => sameInstance(instance, b[index]!));
}

export interface NoRestartEvidence {
  before?: DeviceIdentities;
  after?: DeviceIdentities;
}

/** Null when the server and the host process are the ones the scenario began with. */
export function restartFailure(evidence: NoRestartEvidence): string | null {
  const { before, after } = evidence;
  if (!before || !after) return "The server boot id and host process id were not recorded at both ends";
  if (before.serverBootId !== after.serverBootId)
    return `The server restarted (boot id ${before.serverBootId} became ${after.serverBootId})`;
  if (before.hostPid !== after.hostPid)
    return `The host process restarted (pid ${before.hostPid} became ${after.hostPid})`;
  return null;
}

// ---------------------------------------------------------------------------
// The device as the person's approval surface

export interface ApprovalRecord {
  approvalId: string;
  kind: string;
  decision: "once" | "deny" | "accept-review";
  title?: string;
  /** For a `trustChange` card: the client and the capabilities gained and lost. */
  trust?: Array<{ source: string; gained: string[]; lost: string[] }>;
  /** True for a critical (fresh, per-operation) confirmation. */
  critical?: boolean;
}

/** What the person has agreed to in advance, because the scenario itself asks for it. */
export interface ApprovalConsent {
  /**
   * The scenario puts a question to an agent the workspace starts for the
   * client (the `ask` intent), and that agent uses the connected model account.
   * The person allows that use once; nothing else about the account is allowed.
   */
  modelUse?: boolean;
}

/**
 * Decide, as the person, what the device's approval surface shows: accept the
 * unit install review, confirm a trust-change card once, allow the model use a
 * scenario asked for, and deny (and record) anything else so the agent can
 * proceed and the validator can fail the run.
 */
export function decideApproval(approval: PendingApproval, consent: ApprovalConsent = {}): ApprovalRecord {
  const base = { approvalId: approval.approvalId, kind: approval.kind };
  if (approval.kind === "unit-install-review")
    return { ...base, decision: "accept-review", title: "unit install review" };
  if (approval.kind === "capability" && approval.trustChange?.length)
    return {
      ...base,
      decision: "once",
      title: approval.title,
      critical: approval.allowedDecisions
        ? !approval.allowedDecisions.some((d) => d === "always" || d === "session" || d === "version")
        : undefined,
      trust: approval.trustChange.map((change) => ({
        source: change.source,
        gained: change.gained.map((g) => g.capability),
        lost: change.lost.map((l) => l.capability),
      })),
    };
  if (consent.modelUse && approval.kind === "credential" && approval.callerKind === "do")
    return { ...base, decision: "once", title: `model use by ${approval.callerId}` };
  return {
    ...base,
    decision: "deny",
    title: approval.kind === "capability" ? `${approval.capability}: ${approval.title}` : approval.kind,
  };
}

export class ApprovalSurface {
  readonly answered: ApprovalRecord[] = [];
  readonly #done: Promise<void>;

  constructor(
    private readonly device: ClientDevice,
    private readonly consent: ApprovalConsent = {},
    /** The test's: cancelling it cancels the outstanding `nextApproval`. */
    private readonly signal?: AbortSignal
  ) {
    this.#done = this.#run();
    // `stop` joins and reports this loop; a failure before then is not unhandled.
    this.#done.catch(() => {});
  }

  async #run(): Promise<void> {
    // `nextApproval` is answered by the device from its approval queue's
    // events; it settles with null when the surface is released, and with the
    // test's cancellation when the test is cancelled.
    for (;;) {
      const approval = await this.device.call("nextApproval", {});
      if (!approval) return;
      const record = decideApproval(approval, this.consent);
      this.answered.push(record);
      await this.device.call("resolveApproval", { approvalId: approval.approvalId, decision: record.decision });
    }
  }

  /** The `trustChange` confirmations answered so far. */
  trustCards(): ApprovalRecord[] {
    return this.answered.filter((record) => record.trust);
  }

  unexpected(): ApprovalRecord[] {
    return this.answered.filter((record) => record.decision === "deny");
  }

  /**
   * Release the approval surface and join the loop; its failure, if any, is
   * returned. A cancelled test has nothing to release: its cancellation already
   * ended the pending `nextApproval`, and the loop's own cancellation is the
   * expected way for it to end.
   */
  async stop(): Promise<unknown> {
    const cancelled = this.signal?.aborted === true;
    try {
      if (!cancelled) await this.device.call("releaseApprovals", {});
    } catch (cause) {
      await this.#done.catch(() => {});
      return cause;
    }
    try {
      await this.#done;
      return undefined;
    } catch (cause) {
      // The loop's rejection is the call's cancellation, wrapped by the transport.
      return cancelled ? undefined : cause;
    }
  }
}

// ---------------------------------------------------------------------------
// What an agent's turn produced

/**
 * The state an agent's turn was asked to produce, read once the turn has
 * completed. The device's waits end on a host event; none of them can end when
 * the agent never did the work, so a scenario awaits the turn first and then
 * checks, failing with what is missing rather than waiting for an event that
 * nothing will cause.
 */
export async function listingAfterTurn(
  device: ClientDevice,
  id: string,
  present: boolean
): Promise<ClientListingLite | undefined> {
  const listing = (await device.list()).find((candidate) => candidate.id === id);
  if (present && !listing)
    throw new Error(`The agent's turn ended without ${id} in the device's client index`);
  if (!present && listing)
    throw new Error(`The agent's turn ended with ${id} still in the device's client index`);
  return listing;
}

/** The client's active build after an edit turn; fails when the turn published none. */
export async function newBuildAfterTurn(
  device: ClientDevice,
  id: string,
  fromBuildKey: string
): Promise<string> {
  const listing = await listingAfterTurn(device, id, true);
  const active = listing?.activeBuildKey;
  if (!active || active === fromBuildKey)
    throw new Error(`The agent's turn ended without publishing a new build of ${id}`);
  return active;
}

// ---------------------------------------------------------------------------
// Orchestration frame

export interface ScenarioFrame<E> {
  context: TestOrchestrationContext;
  device: ClientDevice;
  /** Present only when the scenario asked for an agent. */
  session: HeadlessSession | null;
  approvals: ApprovalSurface;
  evidence: E;
  /** One agent turn. */
  turn(prompt: string, phase: string): Promise<void>;
}

/**
 * Run `body` on a fresh agent session against the device for `kind`, keeping
 * `evidence` current for the harness, and join every owned resource on exit.
 */
export async function runScenario<E extends { phase: string; completedPhases: string[] }>(
  context: TestOrchestrationContext,
  options: {
    name: string;
    kind: ClientDeviceKind;
    evidence: E;
    diagnosticsKey: string;
    agent: boolean;
    consent?: ApprovalConsent;
  },
  body: (frame: ScenarioFrame<E>) => Promise<void>
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const { evidence } = options;
  context.diagnostics[options.diagnosticsKey] = evidence;
  const execution: TestExecutionResult = {
    messages: [],
    duration: 0,
    diagnostics: { [options.diagnosticsKey]: evidence },
  };
  let session: HeadlessSession | null = null;
  let approvals: ApprovalSurface | null = null;
  try {
    const device = await openClientDevice(options.kind, context.signal);
    if (options.agent) session = await context.runner.spawn({ context: "isolated" });
    approvals = new ApprovalSurface(device, options.consent, context.signal);
    await body({
      context,
      device,
      session,
      approvals,
      evidence,
      async turn(prompt, phase) {
        evidence.completedPhases.push(evidence.phase);
        evidence.phase = phase;
        if (!session) throw new Error(`The ${options.name} scenario has no agent for phase ${phase}`);
        await context.sendAndWait(session, prompt, phase);
      },
    });
    evidence.completedPhases.push(evidence.phase);
    evidence.phase = "done";
  } catch (cause) {
    const failure = systemTestFailure(`${options.name}:${evidence.phase}`, cause);
    execution.failure = failure;
    execution.error = `${evidence.phase}: ${failure.error.message}`;
  } finally {
    if (approvals) {
      const failure = await approvals.stop();
      if (failure) appendSystemTestCleanupFailure(execution, "approval surface", failure);
      (evidence as { approvals?: ApprovalRecord[] }).approvals = approvals.answered;
    }
    if (session) {
      execution.messages = [...session.messages];
      try {
        await session.close();
      } catch (cause) {
        appendSystemTestCleanupFailure(execution, "close session", cause);
      }
    }
    execution.duration = Date.now() - startedAt;
  }
  return execution;
}
