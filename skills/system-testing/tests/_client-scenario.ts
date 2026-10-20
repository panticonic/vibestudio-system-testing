import type { PendingApproval } from "@vibestudio/shared/approvals";
import { appendSystemTestCleanupFailure, systemTestFailure } from "../structured-error.js";
import type {
  TestExecutionResult,
  TestOrchestrationContext,
  TestAuthorityPolicy,
} from "../types.js";
import type { HeadlessSession } from "@workspace/agentic-session";
import type { ChatMessage } from "@workspace/agentic-core";
import {
  openClientDevice,
  type ClientDevice,
  type ClientDeviceKind,
  type ClientInstanceIdentity,
  type DeviceIdentities,
} from "./_client-device.js";

/**
 * Shared machinery of the client system tests: the user-facing prompts an
 * agent receives, the approval surface the device plays for the person, and
 * the identity comparisons that prove nothing restarted.
 */

export type ClientRuntimeKind = ClientDeviceKind;

const HELLO_BASE: Record<ClientRuntimeKind, string> = {
  terminal: "hello-terminal",
  desktop: "hello-desktop",
};

/**
 * The client id of one run. Publications persist on protected main and a
 * retired project's repository keeps its path, so a fixed id would collide
 * with the previous run's leftovers in the same workspace.
 */
export function helloId(runtime: ClientRuntimeKind, nonce: string): string {
  return `${HELLO_BASE[runtime]}-${nonce}`;
}

/**
 * A required capability this runtime's host does not implement. It must be in
 * the runtime's manifest vocabulary (a capability some host of that runtime
 * could implement), or the build refuses the manifest before any host is asked;
 * and it must be absent from the host's implemented set (`TERMINAL_HOST_CAPABILITIES`,
 * `DESKTOP_IMPLEMENTED_CAPABILITIES`).
 */
export const UNSUPPORTED_CAPABILITY: Record<ClientRuntimeKind, string> = {
  terminal: "integration.install",
  desktop: "camera",
};

export function unsupportedId(runtime: ClientRuntimeKind, nonce: string): string {
  return `${helloId(runtime, nonce)}-unsupported`;
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
    const id = helloId(runtime, nonce);
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
    return `Change the greeting of ${helloId(runtime, nonce)} to \`${updatedGreeting(nonce)}\` and publish it.`;
  },
  trust(runtime: ClientRuntimeKind, nonce: string): string {
    return `Make ${helloId(runtime, nonce)} a trusted client so it can use the device approval surface, and publish. The workspace owner will confirm the change.`;
  },
  untrust(runtime: ClientRuntimeKind, nonce: string): string {
    return `Remove ${helloId(runtime, nonce)} from the trusted clients and publish. It must keep running without the device approval surface, so make that capability optional for it in the same publish instead of required.`;
  },
  unsupported(runtime: ClientRuntimeKind, nonce: string): string {
    return `Create one more minimal ${runtime} client with id ${unsupportedId(runtime, nonce)} that cannot run without the \`${UNSUPPORTED_CAPABILITY[runtime]}\` capability, declare it and publish it.`;
  },
  retire(runtime: ClientRuntimeKind, nonce: string, withUnsupported = true): string {
    const id = helloId(runtime, nonce);
    const names = withUnsupported ? `${id} and ${unsupportedId(runtime, nonce)}` : id;
    return `Retire ${names}: remove ${withUnsupported ? "them" : "it"} and ${withUnsupported ? "their" : "its"} own echo service (the worker named after the client id) from the workspace, and publish.`;
  },
};

/** The decisions the harness's test authority policy makes for the agent. */
export const CLIENT_AUTHORING_POLICY: TestAuthorityPolicy = {
  authority: [
    ...["workspace.publish", "git.publish"].map((key) => ({
      ruleId: `client-authoring-${key}`,
      capability: { kind: "exact" as const, key },
      resource: { kind: "prefix" as const, prefix: "workspace-source-change:publication:" },
      tier: "gated" as const,
      decision: "once" as const,
    })),
    // A trust change is confirmed by the person (the device's approval surface),
    // never by the harness: it continues through the real queue.
    {
      ruleId: "client-trust-change-person",
      capability: { kind: "exact" as const, key: "workspace.publish" },
      resource: { kind: "prefix" as const, prefix: "workspace-trust-change:publication:" },
      tier: "critical" as const,
      decision: "queue" as const,
    },
  ],
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
  /** For a capability card the scenario consented to: what was asked, and of whom. */
  capability?: string;
  callerId?: string;
}

/** What the person has agreed to in advance, because the scenario itself asks for it. */
export interface ApprovalConsent {
  /**
   * The scenario puts a question to an agent the workspace starts for the
   * client (the `ask` intent), and that agent uses the connected model account.
   * The person allows that use once; nothing else about the account is allowed.
   */
  modelUse?: boolean;
  /**
   * Capability requests the scenario itself provokes from a client principal
   * (the call it made through the client's own session), allowed once. A
   * request of any other capability, or by any other principal, is not.
   */
  clientCapabilities?: Array<{ capability: string; callerIdPrefix: string }>;
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
  if (
    approval.kind === "capability" &&
    approval.callerKind === "client" &&
    consent.clientCapabilities?.some(
      (grant) => grant.capability === approval.capability && approval.callerId.startsWith(grant.callerIdPrefix)
    )
  )
    return { ...base, decision: "once", title: approval.title, capability: approval.capability, callerId: approval.callerId };
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
  /** This surface's own lifetime on the device; releasing it never ends another test's. */
  readonly #token: Promise<string>;

  constructor(
    private readonly device: ClientDevice,
    private readonly consent: ApprovalConsent = {},
    /** The test's: cancelling it cancels the outstanding `nextApproval`. */
    private readonly signal?: AbortSignal,
    /**
     * Told the moment the loop fails. With the loop gone no approval is answered
     * again, so every device wait that needs one would stay pending forever; the
     * owner ends them with this failure instead of waiting for `stop`.
     */
    private readonly onFailure?: (cause: unknown) => void
  ) {
    this.#token = this.device.call("openApprovals", {}).then((opened) => opened.surfaceToken);
    // `stop` and the loop observe a failed open; it is not unhandled here.
    this.#token.catch(() => {});
    this.#done = this.#run();
    // `stop` joins and reports this loop; a failure before then is not unhandled.
    this.#done.catch(() => {});
  }

  async #run(): Promise<void> {
    // `nextApproval` is answered by the device from its approval queue's
    // events; it settles with null when the surface is released, and with the
    // test's cancellation when the test is cancelled.
    try {
      const surfaceToken = await this.#token;
      for (;;) {
        const approval = await this.device.call("nextApproval", { surfaceToken });
        if (!approval) return;
        const record = decideApproval(approval, this.consent);
        this.answered.push(record);
        await this.device.call("resolveApproval", { approvalId: approval.approvalId, decision: record.decision });
      }
    } catch (cause) {
      if (this.signal?.aborted !== true) this.onFailure?.(cause);
      throw cause;
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
      if (!cancelled) {
        const surfaceToken = await this.#token;
        await this.device.call("releaseApprovals", { surfaceToken });
      }
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
 * Whether a message list holds a protected-main push that succeeded, among the
 * messages from index `since` on.
 *
 * What a published change does to the device (the index gaining or losing a
 * client, a new build adopted) happens after the push returns, on the server's
 * own schedule, and the device's waits end on the host event that announces it.
 * None of them can end when the agent never published, so a turn is checked for
 * its publication first and the device is then awaited.
 */
export function pushedSince(messages: readonly ChatMessage[], since: number): boolean {
  return messages.slice(since).some((message) => {
    const invocation = message.invocation;
    if (invocation?.execution?.status !== "complete" || invocation.execution.terminalOutcome !== "success")
      return false;
    // The `vcs` tool's push.
    if (
      invocation.name === "vcs" &&
      (invocation.arguments as { operation?: unknown } | undefined)?.operation === "push"
    )
      return true;
    // Runtime code (`vcs.publish`, `vcs.push` in an eval) reaches the same
    // push; the eval's operation journal records it as a fulfilled `vcs.push`.
    return evalJournaledPush(invocation.execution.result);
  });
}

function evalJournaledPush(result: unknown): boolean {
  const details = (result as { details?: { operationJournal?: { entries?: unknown } } } | null)?.details;
  const entries = details?.operationJournal?.entries;
  return (
    Array.isArray(entries) &&
    entries.some((entry) => {
      const receipt = (entry as { receipt?: { method?: unknown; outcome?: unknown } } | null)?.receipt;
      return receipt?.method === "vcs.push" && receipt.outcome === "fulfilled";
    })
  );
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
  /** One agent turn, which must publish to protected main. */
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
  // The test's cancellation, and the scenario's own: a failed approval loop ends
  // every outstanding device operation with its cause.
  const scenario = new AbortController();
  const endScenario = (reason: unknown) => {
    if (!scenario.signal.aborted) scenario.abort(reason);
  };
  if (context.signal.aborted) endScenario(context.signal.reason);
  else context.signal.addEventListener("abort", () => endScenario(context.signal.reason), { once: true });
  try {
    const device = await openClientDevice(options.kind, scenario.signal);
    if (options.agent) session = await context.runner.spawn({ context: "isolated" });
    approvals = new ApprovalSurface(device, options.consent, context.signal, endScenario);
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
        const before = session.messages.length;
        await context.sendAndWait(session, prompt, phase);
        if (!pushedSince(session.messages, before))
          throw new Error("The agent's turn ended without publishing to protected main");
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
