import { isDeepStrictEqual } from "node:util";
import { contextId, rpc } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { doTargetId } from "@vibestudio/shared/workspaceServiceRpc";
import { addAgentToChannel, agentObjectKey } from "@workspace-skills/agents";
import { createChannelMembershipServices } from "@workspace-skills/agents/channel-membership";
import { localMessagingFixtureMethods } from "@workspace-workers/local-messaging-fixture/contract";
import { channelRpcMethods } from "@workspace-workers/pubsub-channel/contract";
import { managedChannelRosterWorlds } from "./channel-roster-worlds.js";

type Assignment = Parameters<typeof createChannelMembershipServices>[0];
type Membership = ReturnType<typeof createChannelMembershipServices>;
type Observation = Awaited<ReturnType<Membership["channelAgentRead"]["read"]>>;
type Result = {
  status:
    | "observed"
    | "unchanged"
    | "applied"
    | "reconciled"
    | "held"
    | "uncertain";
  state: Observation["state"];
  participantId: string | null;
};
type Finding = { id: string; result: Result | null; blockedBy: string | null };
type Report = { findings: Finding[] };

const worker = { source: "workers/test-agent", className: "TestAgentWorker" };
const channelSource = "workers/pubsub-channel";
const channelClass = "PubSubChannel";
const channelNames = ["oncall", "review"] as const;
const options = {
  replay: false,
  response: "mentioned-strict",
  modelRef: null,
} as const;

export async function prepareManagedChannelRoster(caseId: string) {
  const world = managedChannelRosterWorlds.find((entry) => entry.id === caseId);
  const scope = contextId;
  if (!world || !scope)
    throw new Error("An owned context and roster assignment are required");

  const token = crypto.randomUUID();
  const channels = new Map<
    (typeof channelNames)[number],
    { id: string; targetId: string }
  >();
  async function create(source: string, className: string, key: string) {
    const entity = await rpc.call(
      "main",
      mainRpcMethods["runtime.createEntity"],
      [
        {
          kind: "do",
          execution: { surface: "code", source },
          className,
          key,
          contextId: scope,
        },
      ],
    );
    if (entity.contextId !== scope)
      throw new Error("Roster entity context does not match the fixture");
    return entity;
  }
  for (const name of channelNames) {
    const id = `natlang-roster-${token}-${name}`;
    const { targetId } = await create(channelSource, channelClass, id);
    await rpc.call(targetId, channelClientRpcMethods.initializeConversation, [
      scope,
      { title: `Owned ${name} roster channel` },
    ]);
    channels.set(name, { id, targetId });
  }
  const channel = (name: (typeof channelNames)[number]) => channels.get(name)!;
  function participantId(name: (typeof channelNames)[number], handle: string) {
    return doTargetId({
      ...worker,
      objectKey: agentObjectKey(handle, channel(name).id),
    });
  }
  for (const [name, handle] of world.starting.members ?? []) {
    const result = await addAgentToChannel({
      ...worker,
      contextId: scope,
      channelId: channel(name).id,
      handle,
      replay: false,
      config: { respondPolicy: options.response },
    });
    if (!result.ok || result.participantId !== participantId(name, handle)) {
      throw new Error("Roster seed did not establish the exact worker");
    }
  }
  const conflicts = new Map<string, string>();
  const location = (name: string, handle: string) => name + "/" + handle;
  for (const [name, handle] of world.starting.conflicts ?? []) {
    const source = "workers/local-messaging-fixture";
    const className = "LocalMessagingProbeDO";
    const { targetId } = await create(
      source,
      className,
      `natlang-roster-conflict-${token}-${name}-${handle}`,
    );
    const { id: channelId, targetId: channelTargetId } = channel(name);
    const result = await rpc.call(
      targetId,
      localMessagingFixtureMethods.configure,
      [
        {
          contextId: scope,
          fixtureId: token,
          channelId,
          channelTargetId,
          channelRef: {
            source: channelSource,
            className: channelClass,
            objectKey: channelId,
          },
          handle,
          name: "Conflicting test participant",
        },
      ],
    );
    conflicts.set(location(name, handle), result.participantId);
  }

  const steps = world.steps.map((step, index) => ({
    id: `step-${index + 1}`,
    request: {
      goal: `Step ${index + 1}. ${step.action} ${step.handle} in the ${step.channel} channel.`,
      channelId: channel(step.channel).id,
      contextId: scope,
      handle: step.handle,
      action: step.action,
      options: step.action === "attach" ? { ...options } : null,
    } satisfies Assignment,
  }));
  const bound = steps.map(({ request }) =>
    createChannelMembershipServices(request, worker),
  );
  const activity: { id: string; kind: string; value: unknown }[] = [];
  const workflowRequest = { goal: world.goal, steps };
  const capture = async <T>(
    request: Assignment,
    kind: string,
    effect: (services: Membership) => Promise<T>,
  ) => {
    const index = steps.findIndex((step) =>
      isDeepStrictEqual(step.request, request),
    );
    if (index < 0)
      throw new Error("Roster action differs from its exact assignment");
    const value = await effect(bound[index]!);
    activity.push({
      id: steps[index]!.id,
      kind,
      value: structuredClone(value),
    });
    return value;
  };
  const services: Membership = {
    channelAgentRead: {
      read: (request) =>
        capture(request, "read", (ports) =>
          ports.channelAgentRead.read(request),
        ),
    },
    channelAgentAttach: {
      attach: (request, supplied) =>
        capture(request, "attach", (ports) =>
          ports.channelAgentAttach.attach(request, supplied),
        ),
    },
    channelAgentDetach: {
      detach: (request) =>
        capture(request, "detach", (ports) =>
          ports.channelAgentDetach.detach(request),
        ),
    },
  };

  async function roster() {
    const rows = await Promise.all(
      channelNames.map(async (name) => {
        const { id, targetId } = channel(name);
        const related = await rpc.call(
          targetId,
          channelClientRpcMethods.getContextId,
          [],
        );
        const participants = await rpc.call(
          targetId,
          channelClientRpcMethods.getParticipants,
          [],
        );
        const replay = await rpc.call(
          targetId,
          channelRpcMethods.getReplayAfter,
          [{ after: 0, limit: 100 }],
        );
        if (replay.ready.hasMoreAfter)
          throw new Error(
            "The roster replay exceeded the assigned test window",
          );
        return [
          name,
          {
            channelId: id,
            contextId: related,
            participants: participants
              .map((entry) => ({
                id: entry.participantId,
                handle: entry.metadata["handle"],
                type: entry.metadata["type"],
              }))
              .sort((a, b) => a.id.localeCompare(b.id)),
            messages: replay.logEvents.filter(
              ({ type, payload }) =>
                type === "message" ||
                (type === "agentic.trajectory.v1/event" &&
                  typeof payload === "object" &&
                  payload &&
                  "kind" in payload &&
                  String(payload.kind).startsWith("message.")),
            ).length,
          },
        ] as const;
      }),
    );
    return Object.fromEntries(rows);
  }

  const initial = await roster();
  const memberFrom = (name: (typeof channelNames)[number], handle: string) => ({
    id: participantId(name, handle),
    handle,
    type: "agent",
  });
  const memberLists = (source: Map<string, ReturnType<typeof memberFrom>>) =>
    Object.fromEntries(
      channelNames.map((name) => [
        name,
        [...source]
          .filter(([location]) => location.startsWith(name + "/"))
          .map(([, row]) => row)
          .sort((a, b) => a.id.localeCompare(b.id)),
      ]),
    );
  const baseline = new Map<string, ReturnType<typeof memberFrom>>();
  for (const [name, handle] of world.starting.members ?? [])
    baseline.set(location(name, handle), memberFrom(name, handle));
  for (const [name, handle] of world.starting.conflicts ?? []) {
    baseline.set(location(name, handle), {
      id: conflicts.get(location(name, handle))!,
      handle,
      type: "agent",
    });
  }

  function expected() {
    const members = new Map(baseline);
    const transcript: typeof activity = [];
    const findings: Finding[] = [];
    for (const [index, step] of world.steps.entries()) {
      const id = steps[index]!.id;
      const key = location(step.channel, step.handle);
      const desired = participantId(step.channel, step.handle);
      if (step.expected === "blocked") {
        const prior = findings.findLast(
          (finding, at) =>
            finding.result &&
            world.steps[at]?.channel === step.channel &&
            world.steps[at]?.handle === step.handle,
        );
        if (!prior)
          throw new Error(
            "A blocked roster step needs earlier conflict evidence",
          );
        findings.push({ id, result: null, blockedBy: prior.id });
        continue;
      }
      const before = {
        state: step.precondition,
        participantId: step.precondition === "member" ? desired : null,
      };
      transcript.push({ id, kind: "read", value: before });
      let after = before;
      if (step.expected === "applied") {
        if (step.action === "attach")
          members.set(key, memberFrom(step.channel, step.handle));
        else if (step.action === "detach") members.delete(key);
        else throw new Error("An inspection cannot apply a membership change");
        after =
          step.action === "attach"
            ? { state: "member", participantId: desired }
            : { state: "absent", participantId: null };
        transcript.push(
          {
            id,
            kind: step.action,
            value: {
              outcome: "acknowledged",
              participantId: after.participantId,
            },
          },
          { id, kind: "read", value: after },
        );
      }
      findings.push({
        id,
        result: { status: step.expected, ...after },
        blockedBy: null,
      });
    }
    return { transcript, findings, members: memberLists(members) };
  }

  async function verify(report: Report | null) {
    const final = await roster();
    const assigned = expected();
    const originals = memberLists(baseline);
    const checks = {
      initial: channelNames.every((name) =>
        isDeepStrictEqual(initial[name]?.participants, originals[name]),
      ),
      exactOperations: isDeepStrictEqual(activity, assigned.transcript),
      finalRoster: channelNames.every((name) =>
        isDeepStrictEqual(final[name]?.participants, assigned.members[name]),
      ),
      isolatedChannels: channelNames.every(
        (name) =>
          initial[name]?.contextId === scope &&
          final[name]?.contextId === scope &&
          initial[name]?.channelId === final[name]?.channelId,
      ),
      noMessages: channelNames.every(
        (name) => initial[name]?.messages === 0 && final[name]?.messages === 0,
      ),
      report: isDeepStrictEqual(report?.findings, assigned.findings),
    };
    return {
      caseId,
      contextId: scope,
      steps,
      checks,
      initial,
      final,
      activity,
      assigned,
      passed: Object.values(checks).every(Boolean),
    };
  }

  async function qualify() {
    // The crisp reference executes the authored operations through the same scoped live ports.
    const reference = expected();
    let rejectsOtherChannel = false;
    const first = steps[0]!.request;
    try {
      await services.channelAgentRead.read({
        ...first,
        channelId: "unassigned-channel",
      });
    } catch (error) {
      rejectsOtherChannel =
        error instanceof Error && error.message.includes("exact assignment");
    }
    for (const item of reference.transcript) {
      const assignment = steps.find(({ id }) => id === item.id)!.request;
      if (item.kind === "read")
        await services.channelAgentRead.read(assignment);
      else if (item.kind === "attach")
        await services.channelAgentAttach.attach(
          assignment,
          assignment.options!,
        );
      else await services.channelAgentDetach.detach(assignment);
    }
    const verification = await verify({ findings: reference.findings });
    const rejectsWrongReceipt = !(
      await verify({ findings: reference.findings.slice(1) })
    ).passed;
    return { verification, rejectsOtherChannel, rejectsWrongReceipt };
  }

  return { request: workflowRequest, services, verify, qualify };
}
