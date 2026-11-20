import type { Failure } from "../types.js";

const RUN_CONTEXT_FIELDS = new Set([
  "generatedAt",
  "contextId",
  "channelId",
  "branchId",
  "agentEntityId",
  "agentTargetId",
  "buildProvenance",
  "concurrentTestAgents",
  "durableWork",
  "channelDelivery",
  "agentHealth",
  "buildProvenanceFailure",
  "durableWorkFailure",
  "channelDeliveryFailure",
  "agentHealthFailure",
  "diagnosticCollectionFailure",
]);

/** Select scenario evidence from the retained diagnostic, apart from automatic run observations. */
export default function orchestrationSignals(
  orchestration: Failure["orchestration"],
): [string, string][] {
  return Object.entries(orchestration ?? {}).filter(
    ([key]) => !RUN_CONTEXT_FIELDS.has(key),
  );
}
