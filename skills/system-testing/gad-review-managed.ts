import { isDeepStrictEqual } from "node:util";
import { waitFor } from "@workspace/testkit";
import { gad } from "@workspace/runtime";
import { bindChannelReview } from "@workspace-skills/gad-context/workflow";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import {
  createOwnedHeadlessChannel,
  withOwnedChannelClient,
} from "./session-replay-managed.js";
import { gadReviewWorld } from "./gad-review-worlds.js";

type Services = ReturnType<typeof bindChannelReview>["services"];
type Health = Awaited<ReturnType<Services["gadHealth"]["observe"]>>;
type FollowUp = Awaited<ReturnType<Services["gadFollowUp"]["inspect"]>>;
type Tail = Awaited<ReturnType<Services["gadConversation"]["read"]>>;
type Report = {
  health: {
    evidence: Health;
    status: string;
    judgments: { kind: string; urgency: string }[];
  } | null;
  followUp: FollowUp | null;
  conversation: { evidence: Tail; meaning: string; note: string } | null;
};

function observedMessage(row: {
  seq: number;
  payloadKind?: string;
  payloadSummary: unknown;
}) {
  if (row.payloadKind !== "agentic.trajectory.v1/event") return null;
  const event = row.payloadSummary as {
    kind?: string;
    causality?: { messageId?: string };
    payload?: { role?: string; blocks?: { type?: string; content?: string }[] };
  } | null;
  const messageId = event?.causality?.messageId;
  if (
    event?.kind !== "message.completed" ||
    event.payload?.role !== "user" ||
    !messageId
  )
    return null;
  const text = event.payload.blocks?.find(
    (block) => block.type === "text",
  )?.content;
  return typeof text === "string" ? { messageId, seq: row.seq, text } : null;
}

export async function prepareManagedGadReview(
  contextId: string,
  caseId: string,
) {
  const world = gadReviewWorld(caseId);
  const lane = await createOwnedHeadlessChannel(contextId, "Owned GAD review");
  const seeded =
    world.view === "recap"
      ? await withOwnedChannelClient(lane, contextId, async (client) => {
          const ids: string[] = [];
          for (const [index, text] of world.messages.entries()) {
            ids.push(
              await client.send(text, {
                idempotencyKey: `gad-review-${index}`,
              }),
            );
          }
          // A local submission is visible to the client before its canonical publication.
          return await waitFor(
            async () => {
              const page = await gad.inspectChannelEnvelopes({
                channelId: lane.key,
                window: { kind: "tail" },
                limit: 40,
              });
              const messages = page.items
                .map(observedMessage)
                .filter((message) => message !== null);
              return isDeepStrictEqual(
                messages.map(({ messageId }) => messageId),
                ids,
              )
                ? messages
                : undefined;
            },
            {
              label: "assigned GAD publications",
              timeoutMs: 20_000,
              intervalMs: 400,
            },
          );
        })
      : [];
  const { request, services: bound } = bindChannelReview({
    channelId: lane.key,
    goal: world.goal,
    view: world.view,
  });

  const observations: {
    health: Health | null;
    followUp: FollowUp | null;
    tail: Tail | null;
  } = {
    health: null,
    followUp: null,
    tail: null,
  };
  const services: Services = {
    gadHealth: {
      async observe(id) {
        const result = await bound.gadHealth.observe(id);
        observations.health = structuredClone(result);
        return result;
      },
    },
    gadFollowUp: {
      async inspect(id, kind) {
        const result = await bound.gadFollowUp.inspect(id, kind);
        observations.followUp = structuredClone(result);
        return result;
      },
    },
    gadConversation: {
      async read(id) {
        const result = await bound.gadConversation.read(id);
        observations.tail = structuredClone(result);
        return result;
      },
    },
  };

  function verify(report: Report | null) {
    const { health, followUp, tail } = observations;
    const latest = seeded[seeded.length - 1];
    const checks =
      world.view === "triage"
        ? {
            observations:
              health?.channelId === lane.key &&
              health.integrity === "ok" &&
              health.activity === "idle" &&
              health.findings.length === 1 &&
              health.findings[0]?.kind === "empty-roster" &&
              health.findings[0].count === 1 &&
              followUp?.kind === "empty-roster" &&
              followUp.inspector === "inspectChannelRoster" &&
              followUp.counters.some(
                ({ name, count }) =>
                  name === "activeParticipants" && count === 0,
              ) &&
              tail === null,
            report:
              report?.health?.status === "investigate" &&
              report.conversation === null &&
              isDeepStrictEqual(report.health.evidence, health) &&
              isDeepStrictEqual(report.health.judgments, [
                { kind: "empty-roster", urgency: "investigate" },
              ]) &&
              isDeepStrictEqual(report.followUp, followUp),
          }
        : {
            observations:
              isDeepStrictEqual(
                seeded.map(({ text }) => text),
                [...world.messages],
              ) &&
              latest !== undefined &&
              tail?.latest?.seq === latest.seq &&
              tail.latest.text === latest.text &&
              tail.latest.speaker === "user" &&
              tail.channelId === lane.key &&
              tail.range.toSeq >= latest.seq &&
              tail.standing === "awaiting-agent" &&
              tail.status === "observed" &&
              health === null &&
              followUp === null,
            report:
              report?.health === null &&
              report.followUp === null &&
              report.conversation?.meaning === "other" &&
              typeof report.conversation.note === "string" &&
              report.conversation.note.trim().length > 0 &&
              isDeepStrictEqual(report.conversation.evidence, tail),
          };
    return {
      passed: Object.values(checks).every(Boolean),
      caseId,
      contextId,
      channelId: lane.key,
      request,
      seeded,
      observations,
      checks,
    };
  }

  async function qualify() {
    let rejectedForeignReceipt = false;
    let report: Report;
    if (world.view === "triage") {
      const health = await services.gadHealth.observe(request.operationId);
      try {
        await services.gadFollowUp.inspect("unknown", "empty-roster");
      } catch (error) {
        rejectedForeignReceipt =
          error instanceof Error && /assigned channel/.test(error.message);
      }
      const followUp = await services.gadFollowUp.inspect(
        health.receipt,
        "empty-roster",
      );
      report = {
        health: {
          evidence: health,
          status: "investigate",
          judgments: [{ kind: "empty-roster", urgency: "investigate" }],
        },
        followUp,
        conversation: null,
      };
    } else {
      try {
        await services.gadConversation.read("unknown");
      } catch (error) {
        rejectedForeignReceipt =
          error instanceof Error && /assigned channel/.test(error.message);
      }
      const evidence = await services.gadConversation.read(request.operationId);
      report = {
        health: null,
        followUp: null,
        conversation: {
          evidence,
          meaning: "other",
          note: "The latest published message is the user's handoff question.",
        },
      };
    }
    return { verification: verify(report), rejectedForeignReceipt };
  }
  return { request, services, verify, qualify };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedGadReview>>;
type Input = { contextId: string; caseId: string };
export interface ManagedGadReviewReceiver {
  runManagedGadReviewTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyManagedGadReview(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedGadReviewMethods =
  createReceiverRpcMethods<ManagedGadReviewReceiver>([
    "runManagedGadReviewTeacher",
    "qualifyManagedGadReview",
  ]);
