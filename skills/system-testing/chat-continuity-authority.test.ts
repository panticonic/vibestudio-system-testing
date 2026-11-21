import { scopeCovers } from "@vibestudio/shared/authorization";
import type { AgentExecutionTestPolicySpec } from "@vibestudio/shared/authority/testPolicy";
import { expect, it } from "vitest";
import { chatContinuityPrimaryChannel, chatContinuityTestPolicy } from "./chat-continuity-authority.js";

it("permits gated inspection only on the reserved case chat", () => {
  const contextId = "5a594b5e-6c6c-4e7e-ac3b-b040eb0afd9c";
  const policy: AgentExecutionTestPolicySpec = {
    testId: "open-goal-oracle-chat-continuity-rejoin-original-owned-worker",
    agent: { model: "vibestudio-test:deterministic", approvalLevel: 2, fallback: "disabled" },
    authority: [],
    unexpectedPrompts: "fail",
  };
  const { key, target } = chatContinuityPrimaryChannel(contextId);
  expect(key).toBe(`natlang-channel-${contextId}`);
  expect(target).toBe(`do:workers/pubsub-channel:PubSubChannel:${key}`);

  const actual = chatContinuityTestPolicy(policy, contextId);
  expect(actual).toMatchObject({ testId: policy.testId, agent: policy.agent, unexpectedPrompts: "fail" });
  expect(policy.authority).toEqual([]);
  expect(actual.authority).toHaveLength(1);
  const rule = actual.authority[0]!;
  expect(rule).toMatchObject({
    decision: "once",
    tier: "gated",
    resource: { kind: "exact", key: `channel:${target}` },
  });

  const buildDigest = "b368b7d11851d85a00690e12dc846d25cb9d5d6de137802ea80facae6231ee2b";
  expect(scopeCovers(rule.capability, `userland:workers/pubsub-channel/channel.admin#${buildDigest}`)).toBe(true);
  expect(scopeCovers(rule.capability, `userland:workers/pubsub-channel/channel.read#${buildDigest}`)).toBe(false);
  expect(scopeCovers(rule.capability, `userland:workers/unrelated/channel.admin#${buildDigest}`)).toBe(false);
  expect(scopeCovers(rule.resource, `channel:${target}`)).toBe(true);
  expect(scopeCovers(rule.resource, `channel:${target}-lookalike`)).toBe(false);
  const other = chatContinuityPrimaryChannel("70d0fc78-b4a2-4ebb-b5b4-e2b67daff804");
  expect(scopeCovers(rule.resource, `channel:${other.target}`)).toBe(false);
});
