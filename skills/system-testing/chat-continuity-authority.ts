import type { AgentExecutionTestPolicySpec } from "@vibestudio/shared/authority/testPolicy";
import { doTargetId } from "@vibestudio/shared/workspaceServiceRpc";

export function chatContinuityPrimaryChannel(contextId: string) {
  const key = `natlang-channel-${contextId}`;
  const target = doTargetId({ source: "workers/pubsub-channel", className: "PubSubChannel", objectKey: key });
  return { key, target };
}

export function chatContinuityTestPolicy(
  policy: AgentExecutionTestPolicySpec,
  contextId: string,
): AgentExecutionTestPolicySpec {
  const { target } = chatContinuityPrimaryChannel(contextId);
  return {
    ...policy,
    authority: [
      ...policy.authority,
      {
        ruleId: "inspect-owned-chat-continuity-worker",
        capability: { kind: "prefix", prefix: "userland:workers/pubsub-channel/channel.admin#" },
        resource: { kind: "exact", key: `channel:${target}` },
        tier: "gated",
        decision: "once",
      },
    ],
  };
}
