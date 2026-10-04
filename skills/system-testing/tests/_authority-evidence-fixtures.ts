import type { ServerLogEvent } from "@workspace/pubsub";

export function taskRuleSnapshots(count = 1) {
  const rules = Array.from({ length: count }, (_, index) => ({
    id: `task-grant-${index}`, capability: "server-logs.read", action: "Read server logs",
    resource: "server-logs.read", decidedAt: 1,
  }));
  return { afterParentRead: rules, afterChildRead: rules.map((rule) => ({ ...rule })) };
}

export function childLogReadReplay(entityId = "child-entity"): ServerLogEvent[] {
  const causality = { invocationId: "invocation:native:child-read" };
  return [{
    id: 2, ts: 2, messageId: "child-read-start", senderId: "child", type: "agentic.trajectory.v1/event",
    payload: { kind: "invocation.started", causality, payload: {
      name: "eval", nativeSource: { owner: { runtimeId: entityId }, operation: { kind: "tool", name: "eval" } },
    } },
  }, {
    id: 3, ts: 3, messageId: "child-read-end", senderId: "child", type: "agentic.trajectory.v1/event",
    payload: { kind: "invocation.completed", causality, payload: {
      terminalOutcome: "success", result: { details: { operationJournal: {
        protocol: "workspace-operations.v1", entries: [{ type: "server-log.observation", receipt: {
          protocol: "server-log-observation.v1", kind: "stats", latestSeq: 1,
          totalCaptured: 1, bufferSize: 20000, byLevel: { info: 1 },
        } }], truncated: false,
      } } },
    } },
  }];
}

export function serverLogReadJournal() {
  return { protocol: "workspace-operations.v1", truncated: false, entries: [{ type: "server-log.observation", receipt: {
    protocol: "server-log-observation.v1", kind: "stats", latestSeq: 1,
    totalCaptured: 1, bufferSize: 20000, byLevel: { info: 1 },
  } }] };
}
