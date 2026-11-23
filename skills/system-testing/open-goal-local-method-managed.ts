import type { InvocationObservations } from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { stableSha256Hex } from "@vibestudio/content-addressing";
import type { RuntimeEntityHandle } from "@vibestudio/shared/runtime/entitySpec";
import type { WorkspaceRuntime } from "@workspace/runtime/hosted";
import { channelClientRpcMethods as channelMethods } from "@workspace/pubsub/rpc-contract";
import { ownedMethodPeerMethods as peers } from "@workspace-workers/local-messaging-fixture/contract";
import type {
  LocalMethodKind,
  LocalMethodWorld,
} from "./open-goal-local-method-worlds.js";

type Ports = {
  runtime: Pick<WorkspaceRuntime["runtime"], "createEntity" | "retireEntity">;
  rpc: WorkspaceRuntime["rpc"];
};
type Plan = {
  action:
    | "request"
    | "recover"
    | "hold-authority"
    | "hold-route"
    | "hold-moved";
  method: LocalMethodKind;
  finding: string;
};
type Attempt = {
  transport: string;
  invocation: string;
  disposition: "submitted" | "interrupted";
};
type Terminal = {
  channel: string;
  transport: string;
  invocation: string;
  method: LocalMethodKind;
  outcome: "success" | "error";
  detail: string;
  executed: number;
  start: number;
  terminal: number;
};
type Journal = {
  service: string;
  method: string;
  args: unknown[];
  result: unknown;
};
const read = "localMethodRead";
const write = "localMethodDispatch";
const fixtureSource = "workers/local-messaging-fixture";
const scope = "owned-local-method-exchange";
const expectedActions: Record<LocalMethodWorld["profile"], Plan["action"]> = {
  fresh: "request",
  interrupted: "request",
  refused: "request",
  retained: "recover",
  "retained-refusal": "recover",
  "no-grant": "hold-authority",
  "no-provider": "hold-route",
  moved: "hold-moved",
};
type EventProjection = {
  kind?: string;
  causality?: { transportCallId?: string; invocationId?: string };
  payload?: {
    name?: string;
    request?: unknown;
    terminalOutcome?: string;
    result?: unknown;
    error?: unknown;
    reason?: string;
    transport?: {
      channelId?: string;
      target?: { id?: string; participantId?: string };
    };
  };
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function prepareOpenLocalMethod(
  input: { contextId: string; caseId: string },
  world: LocalMethodWorld,
  { runtime, rpc }: Ports,
) {
  if (!input.contextId || input.caseId !== world.id)
    throw new Error("Local method belongs to another assignment");
  const fixtureId = crypto.randomUUID();
  const channelKey = "owned-method-" + fixtureId;
  const transport = "transport:" + fixtureId;
  const invocation = "invocation:" + fixtureId;
  const key = crypto.randomUUID();
  const issued: Extract<RuntimeEntityHandle, { kind: "do" }>[] = [];
  async function create(className: string, objectKey: string) {
    const entity = await runtime.createEntity({
      kind: "do",
      execution: { surface: "code", source: fixtureSource },
      className,
      key: objectKey,
      contextId: input.contextId,
    });
    if (entity.kind !== "do" || entity.contextId !== input.contextId)
      throw new Error("Owned method fixture escaped its context");
    issued.push(entity);
    return entity;
  }
  async function close() {
    const errors: unknown[] = [];
    for (const entity of issued.splice(0).reverse()) {
      try {
        await runtime.retireEntity({ id: entity.id });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(
        errors,
        "Disposable method fixture retirement failed",
      );
  }
  const card = {
    id: key,
    title: world.title,
    method: world.method,
    edition: "current" as const,
  };
  const archive = {
    ...card,
    id: crypto.randomUUID(),
    title: world.title + " retired",
    edition: "retired" as const,
  };
  const permitted = world.profile !== "no-grant";
  const refused =
    world.profile === "refused" || world.profile === "retained-refusal";
  const retainedProfile =
    world.profile === "retained" || world.profile === "retained-refusal";

  try {
    const channel = await create("LocalMessagingChannelDO", channelKey);
    await rpc.call(channel.targetId, channelMethods.initializeConversation, [
      input.contextId,
      { title: world.title },
    ]);
    const caller = await create(
      "OwnedMethodPeerDO",
      "method-" + fixtureId + "-caller",
    );
    const provider =
      world.profile === "no-provider"
        ? null
        : await create(
            "OwnedMethodPeerDO",
            "method-" + fixtureId + "-provider",
          );
    const base = {
      contextId: input.contextId,
      fixtureId,
      channel: channelKey,
      channelTarget: channel.targetId,
      method: world.method,
      detail: world.detail,
      refused,
      withholdFirstResponse: world.profile === "interrupted",
    };
    const source = await rpc.call(caller.targetId, peers.configureMethodPeer, [
      { ...base, role: "caller", peer: provider?.id ?? null },
    ]);
    const target = provider
      ? await rpc.call(provider.targetId, peers.configureMethodPeer, [
          { ...base, role: "provider", peer: caller.id },
        ])
      : null;
    if (
      source.id !== caller.id ||
      (target?.id ?? null) !== (provider?.id ?? null)
    )
      throw new Error("Local method admission returned a foreign entity");
    const executions = async () =>
      provider
        ? await rpc.call(provider.targetId, peers.readOwnedExecutions, [])
        : [];
    const send = async (): Promise<Attempt["disposition"]> => {
      try {
        const observed = await rpc.call(
          caller.targetId,
          peers.submitOwnedMethod,
          [transport, invocation],
        );
        if (
          observed.transport !== transport ||
          observed.invocation !== invocation
        )
          throw new Error("Native method submit returned a foreign invocation");
        return "submitted";
      } catch (error) {
        if (
          world.profile === "interrupted" &&
          error instanceof Error &&
          error.message.includes("Owned method transport response withheld")
        )
          return "interrupted";
        throw error;
      }
    };
    const envelopes = async () => ({
      start: await rpc.call(channel.targetId, channelMethods.getEnvelope, [
        invocation,
      ]),
      terminal: await rpc.call(channel.targetId, channelMethods.getEnvelope, [
        "terminal:" + transport,
      ]),
    });
    async function readTerminal(required: boolean): Promise<Terminal | null> {
      let { start, terminal } = await envelopes();
      for (let attempt = 0; required && !terminal && attempt < 14; attempt++) {
        await wait(25 * (attempt + 1));
        ({ start, terminal } = await envelopes());
      }
      if (!start || !terminal) {
        if (!required && !start && !terminal && !(await executions()).length)
          return null;
        throw new Error("Exact local method invocation did not settle");
      }
      const request = start.payload as EventProjection;
      const end = terminal.payload as EventProjection;
      const matched = (event: EventProjection) =>
        event.causality?.transportCallId === transport &&
        event.causality?.invocationId === invocation;
      const rows = await executions();
      const execution = rows[0];
      const body = (refused ? end.payload?.error : end.payload?.result) as
        | { detail?: unknown }
        | undefined;
      const requestedTarget = request.payload?.transport?.target;
      if (
        request?.kind !== "invocation.started" ||
        !matched(request) ||
        start.senderId !== caller.id ||
        request.payload?.name !== world.method ||
        request.payload.transport?.channelId !== channelKey ||
        (requestedTarget?.participantId ?? requestedTarget?.id) !==
          provider?.id ||
        !isDeepStrictEqual(request.payload?.request, {
          fixtureId,
          source: caller.id,
          transport,
        }) ||
        end?.kind !==
          (refused ? "invocation.failed" : "invocation.completed") ||
        !matched(end) ||
        terminal.id <= start.id ||
        rows.length !== 1 ||
        execution?.transport !== transport ||
        execution.invocation !== invocation ||
        execution.method !== world.method ||
        execution.refused !== refused ||
        execution.executions !== 1 ||
        body?.detail !== execution.detail
      )
        throw new Error(
          "Provider execution and retained channel terminal do not match the exact local request",
        );
      return {
        channel: channelKey,
        transport,
        invocation,
        method: world.method,
        outcome: refused ? "error" : "success",
        detail: execution.detail,
        executed: execution.executions,
        start: start.id,
        terminal: terminal.id,
      };
    }

    if (world.profile === "moved" && provider && target)
      await rpc.call(provider.targetId, peers.retireOwnedMembership, [
        target.revision,
      ]);
    const retained = retainedProfile
      ? (await send(), await readTerminal(true))
      : null;
    const relationship = async () => ({
      caller: await rpc.call(caller.targetId, peers.readOwnedRelationship, []),
      provider: provider
        ? await rpc.call(provider.targetId, peers.readOwnedRelationship, [])
        : null,
    });
    async function inspect() {
      const live = await relationship();
      if (!live.caller.active || live.caller.revision !== source.revision)
        throw new Error("The owned method caller changed");
      const current =
        target === null ||
        (live.provider?.active === true && live.provider.revision === target.revision);
      const admitted = live.provider?.active ? (provider?.id ?? null) : null;
      return {
        cardId: key,
        channel: channelKey,
        caller: caller.id,
        provider: admitted,
        basis: stableSha256Hex({
          key,
          channel: channelKey,
          caller: source,
          target,
          live,
        }),
        permitted,
        current,
        retained,
      };
    }
    const current = await inspect();
    const journal: Journal[] = [];
    const keep = <T>(
      service: string,
      method: string,
      args: unknown[],
      result: T,
    ): T => {
      journal.push({
        service,
        method,
        args: structuredClone(args),
        result: structuredClone(result),
      });
      return result;
    };
    const assign = (id: string, basis = current.basis) => {
      if (id !== key || basis !== current.basis)
        throw new Error("Read only the exact assigned method lane");
    };
    let observed = false;
    let attempted: Attempt | null = null;
    let dispatched = false;
    const services = {
      localMethodRead: {
        async discover() {
          return keep(read, "discover", [], [card, archive]);
        },
        async inspect(id: string) {
          assign(id);
          observed = true;
          return keep(read, "inspect", [id], await inspect());
        },
        async settle(id: string, basis: string, requested: string | null) {
          assign(id, basis);
          if (
            !observed ||
            requested !== (attempted?.transport ?? retained?.transport ?? null)
          )
            throw new Error("Read only the exact assigned invocation result");
          return keep(
            read,
            "settle",
            [id, basis, requested],
            await readTerminal(requested !== null),
          );
        },
      },
      localMethodDispatch: {
        async request(id: string, basis: string, method: LocalMethodKind) {
          assign(id, basis);
          const latest = await inspect();
          if (
            !observed ||
            dispatched ||
            latest.basis !== basis ||
            !latest.provider ||
            !latest.current ||
            !latest.permitted ||
            retained ||
            method !== card.method
          )
            throw new Error(
              "The owned native method request is out of scope, moved, or already settled",
            );
          dispatched = true;
          attempted = { transport, invocation, disposition: await send() };
          return keep(write, "request", [id, basis, method], attempted);
        },
      },
    };

    async function verify(value: unknown, observations?: InvocationObservations) {
      const result = value as Terminal | {action:string;finding:string} | null;
      const expectedAction = expectedActions[world.profile];
      const expectsCall = ["request", "recover"].includes(expectedAction);
      const expected = await readTerminal(expectsCall);
      const latest = await inspect();
      const exact = (
        service: string,
        method: string,
        args: unknown[],
        result: unknown,
      ) => {
        const rows = journal.filter(
          (row) => row.service === service && row.method === method,
        );
        return (
          rows.some(row => isDeepStrictEqual(row.args, args) && isDeepStrictEqual(row.result, result))
        );
      };
      const checks = {
        returnedMethodValue: expectsCall ? !!expected&&isDeepStrictEqual(result,expected) :
          !!result&&"action" in result&&result.action===expectedAction&&typeof result.finding==="string"&&!!result.finding.trim(),
        exactOwnedMethodLane: Boolean(

          exact(read, "discover", [], [card, archive]) &&
          exact(read, "inspect", [key], latest) &&
          latest.current === (world.profile !== "moved") &&
          Boolean(latest.provider) ===
            !["moved", "no-provider"].includes(world.profile),
        ),
        groundedMethodDisposition: !expectsCall || expected?.method===world.method,
        exactDispatchOrRetainedRead: Boolean(

          (expectedAction === "request"
            ? attempted?.transport === transport &&
              attempted.invocation === invocation &&
              attempted.disposition ===
                (world.profile === "interrupted"
                  ? "interrupted"
                  : "submitted") &&
              exact(
                write,
                "request",
                [key, latest.basis, world.method],
                attempted,
              )
            : attempted === null &&
              journal.every((row) => row.service !== write)) &&
          (expectedAction === "recover"
            ? isDeepStrictEqual(latest.retained, expected)
            : latest.retained === null),
        ),
        exactNativeTerminalAndExecution: Boolean(

          exact(
            read,
            "settle",
            [key, latest.basis, expectsCall ? transport : null],
            expected,
          ) &&
          (expectsCall
            ? expected?.executed === 1 &&
              expected.detail === world.detail &&
              expected.outcome === (refused ? "error" : "success")
            : expected === null),
        ),
      };
      return {
      outcomeContract: {
        effects: {checks:["exactOwnedMethodLane", "groundedMethodDisposition", "exactDispatchOrRetainedRead", "exactNativeTerminalAndExecution"],rationale:"Actual native invocation ownership, terminal settlement and execution counts establish the exchange."},
        returnedValue: {checks:["returnedMethodValue"],required:true,rationale:"The requested exact method result or specific hold finding is application data."},
        incidentalValues: {checks:[],rationale:"A known incorrect emitted application value is excluded using the actual root definition."},
      },
      incorrectReturnValues: result!==undefined&&!(checks.returnedMethodValue) ? [{
        required:true,definition:observations?.calls.find(call=>call.parentCallId===null)?.definition??{name:"reconcileOwnedMethodCall",source:"reconcileOwnedMethodCall.nl"},value:result,
      }] : [],
        contextId: input.contextId,
        caseId: world.id,
        goal: world.goal,
        passed: Object.values(checks).every(Boolean),
        checks,
        card,
        evidence: latest,
        attempt: attempted,
        terminal: expected,
        journal: structuredClone(journal),
      };
    }

    async function qualify() {
      await services.localMethodRead.discover();
      let denied = 0;
      try {
        await services.localMethodRead.inspect(archive.id);
      } catch {
        denied++;
      }
      const evidence = await services.localMethodRead.inspect(key);
      try {
        await services.localMethodDispatch.request(
          key,
          "foreign-basis",
          card.method,
        );
      } catch {
        denied++;
      }
      const action = expectedActions[world.profile];
      const attempt =
        action === "request"
          ? await services.localMethodDispatch.request(
              key,
              evidence.basis,
              card.method,
            )
          : null;
      const terminal = await services.localMethodRead.settle(
        key,
        evidence.basis,
        attempt?.transport ?? retained?.transport ?? null,
      );
      const report = terminal ?? {action,finding:"The current owned lane determines this disposition."};
      const verification = await verify(report);
      const wrong = structuredClone(report);
      if ("invocation" in wrong) wrong.invocation = "foreign"; else wrong.action = "invented" as typeof wrong.action;
      const rejected = !(await verify(wrong)).passed;
      if (terminal) {
        if ((await send()) !== "submitted")
          throw new Error(
            "Native redrive did not return its exact acknowledgement",
          );
        if (!isDeepStrictEqual(await readTerminal(true), terminal))
          throw new Error("Re-drive changed a settled local method");
      }
      const rejectedAlteredEvidence = denied === 2 && rejected;
      return {
        ...verification,
      outcomeContract:{...verification.outcomeContract,effects:{...verification.outcomeContract.effects,checks:[...verification.outcomeContract.effects.checks,"rejectedAlteredEvidence"]}},
        passed: verification.passed && rejectedAlteredEvidence,
        checks: { ...verification.checks, rejectedAlteredEvidence },
        referenceReport: report,
      };
    }
    return { services, verify, qualify, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "Local method fixture setup and cleanup failed",
      );
    }
    throw error;
  }
}
