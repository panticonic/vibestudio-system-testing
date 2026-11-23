import { includesEvidence } from "./semantic-evidence.js";
import { isDeepStrictEqual } from "node:util";
import { fs, gad, panelTree, vcs, type PanelHandle } from "@workspace/runtime";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { waitFor } from "@workspace/testkit";
import { bindPanelHealth } from "@workspace-skills/panel-health-runtime";
import { bindChannelReview } from "@workspace-skills/gad-context/workflow";
import type {
  ChannelReview,
  ChannelReviewRequest,
  ClientActionReceipt,
  ClientCatalog,
  ClientDecision,
  ClientDiagnosticsReport,
  ClientHandoff,
  ClientSurface,
  ClientView,
  ClientViewAction,
} from "@workspace-skills/gad-context/natlang-types";
import {
  createOwnedHeadlessChannel,
  withOwnedChannelClient,
} from "./session-replay-managed.js";

export type ClientFrame = {
  version: string;
  text: string;
  minWidth?: number;
  log?: { level: "info" | "warn" | "error"; message: string };
  controls?: {
    id: string;
    label: string;
    next: string | null;
    disabled?: boolean;
  }[];
};
export type ClientScene = ClientSurface & {
  initial: string;
  frames: Record<string, ClientFrame>;
  allowed: string[];
  reload?: string;
  race?: { control: string; to: string };
};
type Expected =
  | {
      kind: "observe";
      surface: string;
      stage: string;
      width?: number;
      overflow?: boolean;
    }
  | {
      kind: "apply";
      surface: string;
      action: ClientViewAction;
      status: ClientActionReceipt["status"];
    }
  | { kind: "channel"; view: ChannelReviewRequest["view"] };
/** Native observations prove requested state coverage. Only actual effects
 * carry a prescribed sequence; repeated reads do not change that sequence. */
export function checkClientObservationTrace(trace: readonly Expected[], expected: readonly Expected[]): boolean {
  return isDeepStrictEqual(trace.filter(step => step.kind !== "observe"),
    expected.filter(step => step.kind !== "observe")) &&
    expected.filter(step => step.kind === "observe").every(step =>
      trace.some(actual => actual.kind === "observe" &&
        actual.surface === step.surface && actual.stage === step.stage &&
        (step.width === undefined || actual.width === step.width) &&
        (step.overflow === undefined || actual.overflow === step.overflow)));
}
export type ClientDiagnosticsWorld = {
  kind: "clientDiagnostics";
  workspace: "examples";
  id: string;
  goal: string;
  sourceGroup: string;
  split?: "test";
  surfaces: ClientScene[];
  channel?: { title: string; messages: string[] };
  handoff?: string;
  expected: {
    steps: Expected[];
    outcome: ClientDecision["outcome"];
    citations: string[];
    preHandoff?: Exclude<ClientDecision["outcome"], "handoff-staged">;
  };
};
type Input = {
  contextId: string;
  caseId: string;
  source: string;
  clientPanels: { surfaceId: string; panelId: string }[];
};

const root = '[data-client-stage]:not([data-client-stage=""])';
const capture = `(() => {
  const row = document.querySelector(${JSON.stringify(root)});
  if (!row) return null;
  return {
    id: row.dataset.clientId, stage: row.dataset.clientStage, instance: row.dataset.clientInstance,
    audience: row.dataset.clientAudience, device: row.dataset.clientDevice,
    title: row.querySelector("h1")?.textContent?.trim(),
    version: row.querySelector('[data-panel-health="version"]')?.textContent?.trim(),
    text: row.querySelector('[data-panel-health="message"]')?.textContent?.trim(),
    width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
    controls: Array.from(row.querySelectorAll("button[data-client-control]"))
      .map(button => ({id:button.dataset.clientControl,label:button.textContent.trim(),enabled:!button.disabled})),
  };
})()`;
type Dom = Omit<ClientView, "surface" | "id" | "signals"> & {
  id: string;
  title: string;
  audience: string;
  device: string;
  instance: string;
};
const hash = (value: unknown) => sha256HexSyncText(JSON.stringify(value));

export async function prepareOpenClientDiagnostics(
  input: Input,
  world: ClientDiagnosticsWorld,
) {
  if (
    !input.source ||
    world.id !== input.caseId ||
    input.clientPanels.length !== world.surfaces.length ||
    new Set(input.clientPanels.map((row) => row.panelId)).size !==
      world.surfaces.length ||
    new Set(input.clientPanels.map((row) => row.surfaceId)).size !==
      world.surfaces.length
  )
    throw new Error("Client diagnostics requires its exact owned renderer set");
  const slots = new Map(
    input.clientPanels.map((row) => [
      row.surfaceId,
      panelTree.get(row.panelId),
    ]),
  );
  const scenes = new Map(world.surfaces.map((scene) => [scene.id, scene]));
  const before = await vcs.status({ contextId: input.contextId });
  const viewportSessions = new Map<string, Awaited<ReturnType<PanelHandle["cdp"]["session"]>>>();
  async function read(surfaceId: string) {
    const panel = slots.get(surfaceId);
    if (!panel) throw new Error("A foreign client cannot be inspected");
    const scope = (observation: Awaited<ReturnType<PanelHandle["observe"]>>) =>
      observation.kind === "workspace" &&
      observation.panelId === panel.id &&
      observation.contextId === input.contextId &&
      observation.source === input.source &&
      observation.requestedRef === "ctx:" + input.contextId;
    const original = await panel.observe();
    if (!scope(original))
      throw new Error("The client belongs to another workspace");
    const retained = viewportSessions.get(surfaceId);
    const session = retained ?? await panel.cdp.session();
    try {
      await session.page.waitForSelector(root);
      const dom = await session.page.evaluate<Dom | null>(capture);
      const after = await panel.observe();
      const generation = session.receipt?.generation;
      if (
        !dom ||
        dom.id !== surfaceId ||
        !generation ||
        !scope(after) ||
        generation.panelId !== panel.id ||
        generation.attemptId !== original.attemptId ||
        generation.buildKey !== original.buildKey ||
        generation.runtimeEntityId !== original.runtimeEntityId ||
        after.attemptId !== original.attemptId ||
        after.buildKey !== original.buildKey ||
        after.runtimeEntityId !== original.runtimeEntityId
      )
        throw new Error("The CDP client changed while observing owned state");
      const owned = (await panel.stateArgs.get<{ scene: ClientScene }>()).scene;
      if (
        owned?.id !== surfaceId ||
        !isDeepStrictEqual(owned, scenes.get(surfaceId))
      )
        throw new Error(
          "The current panel scene belongs to another assignment",
        );
      return {
        revision: hash({ dom, generation }),
        generation,
        dom,
        owned,
        panel,
      };
    } finally {
      if (!retained) await session.close();
    }
  }

  const journal: {
    service: string;
    method: string;
    args: unknown[];
    result: unknown;
  }[] = [];
  const record = <T>(
    service: string,
    method: string,
    args: unknown[],
    result: T,
  ) => {
    journal.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };
  const log = <T>(method: string, args: unknown[], result: T) =>
    record("clientDiagnostics", method, args, result);
  const baseline = new Map<string, Awaited<ReturnType<typeof read>>>();
  for (const scene of world.surfaces)
    baseline.set(scene.id, await read(scene.id));
  const catalog: ClientCatalog = {
    surfaces: [...baseline.values()].map(({ dom, owned }) => ({
      id: dom.id,
      title: dom.title,
      audience: dom.audience,
      device: dom.device,
      modifiable: owned.modifiable,
    })),
    channel: world.channel?.title ?? null,
  };
  let current: ClientView | undefined;
  let currentRevision: string | undefined;
  let writing = false;
  const moved = new Set<string>();
  const views: ClientView[] = [];
  const issuedViews = new Map<string, { view: ClientView; revision: string }>();
  const effects: ClientActionReceipt[] = [];
  const trace: Expected[] = [];
  let saved: ClientHandoff | null = null;
  const folder = world.handoff
    ? await fs.mkdtemp("client-diagnostic-handoff")
    : null;
  const file = folder ? folder + "/handoff.json" : null;
  const lane = world.channel
    ? await createOwnedHeadlessChannel(input.contextId, world.channel.title)
    : null;
  const sent =
    lane && world.channel?.messages?.length
      ? await withOwnedChannelClient(lane, input.contextId, async (client) => {
          const ids: string[] = [];
          for (const [index, text] of world.channel!.messages.entries())
            ids.push(
              await client.send(text, {
                idempotencyKey: "client-owned-" + index,
              }),
            );
          return ids;
        })
      : [];
  async function durableTail() {
    if (!lane) return [];
    const page = await gad.inspectChannelEnvelopes({
      channelId: lane.key,
      window: { kind: "tail" },
      limit: 40,
    });
    return page.items.flatMap((row) => {
      const event = row.payloadSummary as {
        kind?: string;
        causality?: { messageId?: string };
        payload?: {
          role?: string;
          blocks?: { type: string; content: string }[];
        };
      } | null;
      const id = event?.causality?.messageId;
      const text = event?.payload?.blocks?.find(
        (block) => block.type === "text",
      )?.content;
      return row.payloadKind === "agentic.trajectory.v1/event" &&
        event?.kind === "message.completed" &&
        event.payload?.role === "user" &&
        id &&
        typeof text === "string"
        ? [{ id, seq: row.seq, text }]
        : [];
    });
  }
  const durable = lane
    ? await waitFor(
        async () => {
          const latest = await durableTail();
          return isDeepStrictEqual(
            latest.map((row) => row.id),
            sent,
          )
            ? latest
            : undefined;
        },
        {
          label: "exact published owned client conversation",
          timeoutMs: 20_000,
          intervalMs: 400,
        },
      )
    : [];
  let review: ReturnType<typeof bindChannelReview> | undefined;
  let nativeHealth: Awaited<
    ReturnType<
      ReturnType<typeof bindChannelReview>["services"]["gadHealth"]["observe"]
    >
  > | null = null;
  let nativeTail: Awaited<
    ReturnType<
      ReturnType<
        typeof bindChannelReview
      >["services"]["gadConversation"]["read"]
    >
  > | null = null;
  let nativeFollow: Awaited<
    ReturnType<
      ReturnType<typeof bindChannelReview>["services"]["gadFollowUp"]["inspect"]
    >
  > | null = null;
  const evidenceIds = () => [
    ...views.map((view) => view.id),
    ...(nativeTail ? [nativeTail.receipt] : []),
    ...(nativeHealth ? [nativeHealth.receipt] : []),
    ...(nativeFollow ? [nativeFollow.receipt] : []),
  ];

  const services = {
    clientDiagnostics: {
      async discover() {
        return log("discover", [], catalog);
      },
      async observe(surfaceId: string) {
        if (writing || !slots.has(surfaceId))
          return log("observe", [surfaceId], null);
        const native = await read(surfaceId);
        const health = await bindPanelHealth(native.panel, {
          contextId: input.contextId,
          source: input.source,
          markerIds: ["version", "message"],
          session: viewportSessions.get(surfaceId),
        }).panelHealth.observe();
        const stable = await read(surfaceId);
        if (
          stable.revision !== native.revision ||
          health.attemptId !== native.generation.attemptId ||
          health.buildKey !== native.generation.buildKey ||
          !isDeepStrictEqual(health.markers, [
            { id: "version", values: [native.dom.version] },
            { id: "message", values: [native.dom.text] },
          ])
        )
          throw new Error(
            "The health observation is not of the same current client",
          );
        const { stage, text, version, width, overflow, controls } = native.dom;
        const surface = catalog.surfaces.find((row) => row.id === surfaceId)!;
        const view = {
          id: crypto.randomUUID(),
          surface,
          stage,
          text,
          version,
          width,
          overflow,
          controls,
          signals: health.diagnostics.filter((row) =>
            row.message.includes("owned-client:"),
          ),
        };
        current = view;
        currentRevision = native.revision;
        views.push(view);
        issuedViews.set(view.id, { view, revision: native.revision });
        trace.push({
          kind: "observe",
          surface: surfaceId,
          stage,
          width,
          overflow,
        });
        return log("observe", [surfaceId], view);
      },
      async apply(viewId: string, action: ClientViewAction) {
        const issued = issuedViews.get(viewId);
        if (issued) { current = issued.view; currentRevision = issued.revision; }
        const currentSurface = current?.surface?.id;
        const finish = (status: ClientActionReceipt["status"]) => {
          const result = { status, id: crypto.randomUUID() };
          effects.push(result);
          if (currentSurface)
            trace.push({
              kind: "apply",
              surface: currentSurface,
              action,
              status,
            });
          return log("apply", [viewId, action], result);
        };
        if (!current || current.id !== viewId || writing)
          return finish("changed");
        writing = true;
        try {
          const live = await read(current.surface.id);
          const { dom, owned, panel } = live;
          if (live.revision !== currentRevision) return finish("changed");
          if (!owned.modifiable) return finish("denied");
          if (action?.kind === "click") {
            if (
              !owned.allowed.includes(action.control) ||
              !dom.controls.some(
                (row) => row.id === action.control && row.enabled,
              )
            )
              return finish("denied");
            const observedControl = owned.frames[dom.stage]?.controls?.find(
              (row) => row.id === action.control,
            );
            if (!observedControl || !observedControl.next)
              return finish("denied");
            if (
              owned.race?.control === action.control &&
              !moved.has(owned.id)
            ) {
              await panel.stateArgs.patch({ ownerStage: owned.race.to });
              await waitFor(
                async () =>
                  (await read(owned.id)).dom.stage === owned.race!.to ||
                  undefined,
                { label: "owner changed the client scene" },
              );
              moved.add(owned.id);
              return finish("changed");
            }
            const session = await panel.cdp.session();
            try {
              if (
                !isDeepStrictEqual(session.receipt?.generation, live.generation)
              )
                return finish("changed");
              const clicked = await session.page.evaluate<boolean>(`(() => {
                const row=document.querySelector(${JSON.stringify(root)});
                if (row?.dataset?.clientStage !== ${JSON.stringify(dom.stage)} || row.dataset.clientInstance !== ${JSON.stringify(dom.instance)}) return false;
                const control=Array.from(row.querySelectorAll("button[data-client-control]:enabled")).find(button=>button.dataset.clientControl===${JSON.stringify(action.control)});
                if (!control) return false;
                control.click();
                return true;
              })()`);
              if (!clicked) return finish("changed");
            } finally {
              await session.close();
            }
            await waitFor(
              async () =>
                (await read(owned.id)).dom.stage === observedControl.next ||
                undefined,
              { label: "read back exact owned click" },
            );
          } else if (action?.kind === "viewport") {
            if (
              !owned.allowed.includes("viewport") ||
              ![320, 390, 1280].includes(action.width)
            )
              return finish("denied");
            const session = viewportSessions.get(owned.id) ?? await panel.cdp.session();
            viewportSessions.set(owned.id, session);
            // Device metrics belong to the debugger session. Keep that session
            // through subsequent reads and the explicit viewport restoration.
            const steady = await read(owned.id);
            if (steady.revision !== live.revision) return finish("changed");
            await session.page.setViewportSize({ width: action.width, height: 844 });
            await waitFor(async () => {
              const observed = await read(owned.id);
              if (!isDeepStrictEqual(observed.generation, live.generation))
                throw new Error("The owned viewport target was replaced");
              return observed.dom.width === action.width || undefined;
            }, { label: `read back owned viewport width ${action.width}` });
          } else if (action?.kind === "reload") {
            if (!owned.allowed.includes("reload") || !owned.reload)
              return finish("denied");
            await panel.stateArgs.patch({ boot: owned.reload });
            await panel.reload();
            await waitFor(
              async () => {
                const latest = await read(owned.id);
                return latest.dom.instance !== dom.instance &&
                  latest.dom.stage === owned.reload
                  ? true
                  : undefined;
              },
              { label: "verify the newly mounted owned client" },
            );
          } else return finish("denied");
          currentRevision = undefined;
          return finish("applied");
        } finally {
          writing = false;
        }
      },
      async channel(view: ChannelReviewRequest["view"]) {
        if (
          !lane ||
          review ||
          !["health", "triage", "recap"].includes(view)
        )
          return log("channel", [view], null);
        review = bindChannelReview({
          channelId: lane.key,
          goal: world.goal,
          view,
        });
        trace.push({ kind: "channel", view });
        return log("channel", [view], review.request);
      },
      async stage(audience: string, decision: ClientDecision) {
        if (
          !file ||
          audience !== world.handoff ||
          saved ||
          !decision?.answer?.trim() ||
          !isDeepStrictEqual(decision.evidenceIds, evidenceIds()) ||
          !current?.surface ||
          writing
        )
          return log("stage", [audience, decision], null);
        writing = true;
        try {
          if (
            (await read(current.surface.id)).revision !== currentRevision ||
            !isDeepStrictEqual(await durableTail(), durable)
          )
            return log("stage", [audience, decision], null);
          const candidate = {
            audience,
            receipt: crypto.randomUUID(),
            decision,
          };
          await fs.writeFile(file, JSON.stringify(candidate));
          saved = JSON.parse(await fs.readFile(file, "utf8"));
          return log(
            "stage",
            [audience, decision],
            isDeepStrictEqual(candidate, saved) ? saved : null,
          );
        } finally {
          writing = false;
        }
      },
    },
    gadHealth: {
      async observe(id: string) {
        if (!review) throw new Error("Choose the owned channel review first");
        nativeHealth = await review.services.gadHealth.observe(id);
        return record("gadHealth", "observe", [id], nativeHealth);
      },
    },
    gadFollowUp: {
      async inspect(id: string, kind: string) {
        if (!review) throw new Error("Choose the owned channel review first");
        nativeFollow = await review.services.gadFollowUp.inspect(id, kind);
        return record("gadFollowUp", "inspect", [id, kind], nativeFollow);
      },
    },
    gadConversation: {
      async read(id: string) {
        if (!review) throw new Error("Choose the owned channel review first");
        nativeTail = await review.services.gadConversation.read(id);
        return record("gadConversation", "read", [id], nativeTail);
      },
    },
  };

  async function verify(
    wrapper: Pick<ClientDiagnosticsReport,"channel"|"decision"|"handoff"> | null,
  ) {
    const report =
      wrapper;
    const after = await vcs.status({ contextId: input.contextId });
    const fresh = await Promise.all(
      world.surfaces.map(
        async (scene) => [scene.id, await read(scene.id)] as const,
      ),
    );
    const final = Object.fromEntries(fresh.map(([id, row]) => [id, row.dom]));
    const expected = world.expected.steps;
    const exactTrace = checkClientObservationTrace(trace, expected);
    const latest = durable.at(-1);
    const channelStep = expected.find((step) => step.kind === "channel");
    const roster =
      lane && channelStep?.view === "triage"
        ? await gad.inspectChannelRoster({ channelId: lane.key, limit: 12 })
        : null;
    const channelExact =
      channelStep?.view === "recap"
        ? Boolean(
            nativeTail &&
            lane &&
            report?.channel?.conversation &&
            nativeTail.channelId === lane.key &&
            report.channel.conversation.meaning ===
              (latest ? "other" : "unestablished") &&
            isDeepStrictEqual(
              report.channel.conversation.evidence,
              nativeTail,
            ) &&
            nativeTail.latest?.text === latest?.text &&
            nativeTail.latest?.seq === latest?.seq &&
            nativeTail.standing === (latest ? "awaiting-agent" : "empty") &&
            report.channel.followUp === null &&
            report.channel.health === null,
          )
        : channelStep?.view === "triage"
          ? Boolean(
              nativeHealth &&
              lane &&
              report?.channel?.health &&
              nativeHealth.channelId === lane.key &&
              nativeHealth.integrity === "ok" &&
              isDeepStrictEqual(report.channel.health.evidence, nativeHealth) &&
              report.channel.health.status === "investigate" &&
              nativeFollow?.inspector === "inspectChannelRoster" &&
              roster?.summary?.activeParticipants === 0 &&
              isDeepStrictEqual(report.channel.followUp, nativeFollow) &&
              report.channel.conversation === null,
            )
          : !channelStep && report?.channel === null;
    const savedBytes =
      file && saved ? JSON.parse(await fs.readFile(file, "utf8")) : null;
    const files = folder ? await fs.readdir(folder) : [];
    const checks = {
      exactOwnedClientOrder:exactTrace,
      joinedCurrentRendererFields:
        views.every((view) => {
          const scene = scenes.get(view.surface.id);
          const frame = scene?.frames[view.stage];
          return (
            frame?.version === view.version &&
            frame.text === view.text &&
            isDeepStrictEqual(
              view.controls,
              (frame.controls ?? []).map(({ id, label, disabled }) => ({
                id,
                label,
                enabled: !disabled,
              })),
            ) &&
            (!frame.log ||
              view.signals.some((row) =>
                row.message.includes("owned-client: " + frame.log!.message),
              ))
          );
        }) &&
        fresh.every(([id, row]) => {
          const last = views.findLast((view) => view.surface.id === id);
          return last
            ? last.stage === row.dom.stage &&
                last.width === row.dom.width &&
                last.version === row.dom.version &&
                last.text === row.dom.text &&
                isDeepStrictEqual(last.controls, row.dom.controls)
            : row.revision === baseline.get(id)?.revision;
        }),
      exactOwnedGadEvidence:
        channelExact && isDeepStrictEqual(await durableTail(), durable),
      resolvedClientGoal:
        report?.decision?.outcome === world.expected.outcome &&
        typeof report.decision.answer === "string" &&
        world.expected.citations.every((text) =>
          report.decision.answer.includes(text),
        ) &&
        isDeepStrictEqual(report.decision.evidenceIds, evidenceIds()),
      verifiedLocalClientHandoff: world.handoff
        ? Boolean(
            saved &&
            saved.audience === world.handoff &&
            saved.decision.outcome === world.expected.preHandoff &&
            isDeepStrictEqual(saved, savedBytes) &&
            isDeepStrictEqual(report?.handoff, saved) &&
            isDeepStrictEqual(
              { ...saved.decision, outcome: "handoff-staged" },
              report?.decision,
            ),
          )
        : !saved && report?.handoff === null && !files.includes("handoff.json"),
      protectedClientSource:
        before.mainEventId === after.mainEventId &&
        isDeepStrictEqual(before.workingHead, after.workingHead),
    };
    return {
      contextId: input.contextId,
      caseId: world.id,
      goal: world.goal,
      checks,
      catalog,
      trace: structuredClone(trace),
      journal: structuredClone(journal),
      final,
      durable,
      handoff: savedBytes,
      passed: Object.values(checks).every(Boolean),
    };
  }

  async function qualify() {
    const client = services.clientDiagnostics;
    await client.discover();
    const rejectsForeign = (await client.observe("foreign-screen")) === null;
    let channel: ChannelReview | null = null;
    for (const step of world.expected.steps) {
      if (step.kind === "observe") await client.observe(step.surface);
      else if (step.kind === "apply")
        await client.apply(current!.id, step.action);
      else {
        const request = await client.channel(step.view);
        if (!request)
          throw new Error(
            "The owned channel could not be selected for the reference",
          );
        if (step.view === "recap") {
          const evidence = await services.gadConversation.read(
            request.operationId,
          );
          channel = {
            health: null,
            followUp: null,
            conversation: {
              evidence,
              meaning: "other",
              note: "Read the exact owned publication.",
            },
          };
        } else {
          const evidence = await services.gadHealth.observe(
            request.operationId,
          );
          const followUp = await services.gadFollowUp.inspect(
            evidence.receipt,
            "empty-roster",
          );
          channel = {
            health: {
              evidence,
              status: "investigate",
              judgments: [{ kind: "empty-roster", urgency: "investigate" }],
            },
            followUp,
            conversation: null,
          };
        }
      }
    }
    const decision: ClientDecision = {
      outcome: world.expected.preHandoff ?? world.expected.outcome,
      answer: world.expected.citations.join(" · "),
      evidenceIds: evidenceIds(),
    };
    const rejectsWrongAudience =
      (await client.stage("other-recipient", decision)) === null;
    const handoff = world.handoff
      ? await client.stage(world.handoff, decision)
      : null;
    const outcome: ClientDiagnosticsReport = {
      views,
      effects,
      channel,
      decision: handoff ? { ...decision, outcome: "handoff-staged" } : decision,
      handoff,
    };
    const wrapped = {channel:outcome.channel,decision:outcome.decision,handoff:outcome.handoff};
    const result = await verify(wrapped);
    const rejectsWrongOutcome = !(
      await verify({
          ...outcome,
          decision: { ...outcome.decision, evidenceIds: ["foreigner"] },
        })
    ).passed;
    const rejectsStale =
      (await client.apply("foreign-basis", { kind: "reload" })).status ===
      "changed";
    return {
      ...result,
      checks: {
        ...result.checks,
        rejectsForeign,
        rejectsWrongAudience,
        rejectsWrongOutcome,
        rejectsStale,
      },
      passed:
        result.passed &&
        rejectsForeign &&
        rejectsWrongAudience &&
        rejectsWrongOutcome &&
        rejectsStale,
    };
  }

  async function close() {
    try {
      await Promise.all([...viewportSessions.values()].map(session => session.close()));
    } finally {
      viewportSessions.clear();
    }
  }

  return { services, verify, qualify, close };
}
