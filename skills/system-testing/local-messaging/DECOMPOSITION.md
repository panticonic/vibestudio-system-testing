# Whole owned-local messaging workflow

This is canonical messaging integration, with no live messages, resources or teacher runs created during implementation.

## Existing mechanism inventory

- Base `skills/messaging/SKILL.md` defines exact recipient resolution, no substituted audience, explicit notify delivery, and ambiguity as unsent data. `resolve-addressee.ts` is the existing exact phrase resolver; reuse it rather than asking a model to replace its matching rule.
- System-testing `tests/messaging.ts:messaging-resolve-named-recipient` requires the original resolver and no send when the intended addressee is absent. `unreachable-addressee-fails-closed` rejects broadcast/substituted audience. `tests/multi-user.ts:channel-roster-identity` verifies the actual recorded participant types rather than inferring that every participant is human.
- Base `packages/agentic-do/src/agent-worker-base.ts:createDiscoveryTools/createNotifyTool` currently owns real roster projection, canonical notify routing, source/guest records, attention and run handling. Notify has no standalone typed non-tool operation today. Integration must extract/reuse that operation with the original owning synthetic agent; do not imitate it with channel.send or fabricate a ToolExecutionContext.
- `workers/pubsub-channel/broadcast.ts` broadcasts shared log envelopes to connected sessions. Addressed durable work is a distinct projection in `delivery-projection.ts`; targeting is not a promise of private channel visibility.
- Passive synthetic entity probes must receive actual `acceptChannelDelivery` calls, persist their original delivery IDs and reply processed. Join them through the existing channel relationship with `delivery:'addressed'`. They run no model and forward nothing.
- Channel `prepareDurableWorkRelease('delivery')` plus `waitDurableWorkRelease('delivery', receipt.barrier)` provides a finite owned publication/delivery boundary. After root settlement, close fixture admission and join that boundary before taking independent probe snapshots. A sleep or empty subscription read does not prove absence. `waitObservedThrough` covers log observation, not recipient delivery completion.
- All actual channels, sender and recipients belong to the disposable fixture. Use synthetic `agent` participants only; no `user`, external participant, real inbox, phone push, cross-workspace recipient or external transport. `alert:'none'` is part of this owned agent-only task. The caller's fixture binding proves ownership; a string prefix is not an ownership check.

## Decomposition

| Part | Native form | Rationale |
| --- | --- | --- |
| Read real roster → resolve → compose/hold → deliver → inspect | `program/routeMessage.nl` | Full workflow rather than an alert-classification leaf |
| Assess canonical resolution and distinguish body names from audience | `routeMessage/resolveRecipients.nl` | Typed judgment on supplied roster/resolver data; no live services |
| Compose the requested message from actual facts | `routeMessage/composeMessage.nl` | Model-owned language, no invented status |
| Compose a useful clarification for ambiguity | `routeMessage/askClarification.nl` | Actual unsent branch, not a fake delivery |
| Verify evidence against the chosen audience and body | `routeMessage/verifyDelivery.nl` | Model assessment from supplied committed evidence; cannot send |
| Exact resolver, snapshot/revision fence, original notify invocation and bounded log/probe read | `integration/createLocalMessaging.ts` | Crisp existing outside-world mechanics; no message policy |
| Independent routing/absence check after canonical release barrier | `integration/verifyOutcome.mjs` | No teacher assertion trusted; original envelopes and durable probe observations decide |

Only the orchestration root receives the send capability. Child stages receive typed JSON arguments and no services. Promotion must wire this through the host's existing service scope/compiler mechanism and inspect captured requests to verify planning children have no live delivery tools. Merely saying this in a prompt is insufficient.

## Two local worlds

1. **Named recipient with body decoy:** one Mira and one Alex are passive synthetic agents in a fresh owned channel. The caller asks to tell Mira verified release facts; the message mentions Alex as reviewer. Exactly Mira receives addressed work. Alex and the unrelated owned control channel receive no task message. Shared log visibility is not graded as private delivery.
2. **Ambiguous local recipient:** two passive synthetic agents are both named Nora, with distinct handles/roles. The caller supplies only Nora. The original resolver returns ambiguity; the root retains a draft and asks which Nora. No target, source, control channel or probe may show a task send. The clarification is the function return to the caller, not a fallback notify to the room.

## Integration dependencies

Reuse/extract real discovery and notify operations, bind them to one synthetic agent's actual subscription and original scoped RPC, register the read/send service projections, seed owned channels/probes, and expose immutable original log/probe snapshots through the existing harness. These are required integration tasks, not available fictional services. This authored directory is not live-qualified until those edges and independent barrier/oracle checks run.

## Implemented workspace integration

`workers/local-messaging-fixture` supplies real passive probe and native sender receivers. Probe delivery validates actual channel caller, participant and subscription revision before persisting the original input. The native sender uses Base AgentWorkerBase's shared original discovery/notify operation and durable exact-intent/result storage. `LocalMessagingChannelDO` subclasses the original PubSubChannel and exposes an operator-only finite join on its own instance; it calls the inherited canonical capture/wait logic. Host-only lifecycle RPCs are unchanged. No principal is impersonated.

`fixture.ts` creates only issued entities, joins their real channels, closes send admission, joins original delivery frontiers, reads complete bounded replay snapshots and all passive probes, then retires only issued resources. `runner.ts` supplies a fresh owned context and destroys it in finally; `stages.ts` registers explicit-only scenarios. The shared authored teacher entry is used only when invoked; implementation/tests launch no model. The independent oracle remains outside the common model-owned workflow package.
