import { sha256HexSyncText } from "@vibestudio/content-addressing";

export type ObservedCall = {
  callId: string;
  parentCallId: string | null;
  definition: { name: string; source: string };
  outcome: string;
};
export type ObservedReturn = ObservedCall & { value: unknown };
export type InvocationObservations = {
  readonly calls: readonly ObservedCall[];
  returns(select?: (call: ObservedCall) => boolean): Promise<ObservedReturn[]>;
};
type CapturedCall = {
  callId: string;
  summary: { run_id: string; owner_key: string; owner_kind: string };
  record: {
    call_id: string; parent_call_id: string | null;
    definition: { name: string; source: string }; outcome: string;
    output?: { complete?: boolean; hash?: string } | null;
  };
};

/** Read existing execution values, never model-facing copies or bounded previews.
 * Selecting a recorded value is optional evidence, not a required execution route.
 */
export function observeInvocation(
  capture: { evalRunId: string; calls: CapturedCall[]; captureErrors: string[]; rootCallIds: string[] },
  readValue: (hash: string) => Promise<string | null>,
): InvocationObservations {
  if (capture.captureErrors.length || capture.rootCallIds.length !== 1 || !capture.calls.length)
    throw new Error("Cannot inspect an incomplete invocation capture");
  // Captures also carry full prompts, replies and events. Keep only references
  // needed for verification instead of cloning that large retained payload.
  const byId = new Map(capture.calls.map(call => {
    if (!call.record) throw new Error("Missing invocation record");
    return [call.callId, {
      callId: call.callId,
      summary: { run_id: call.summary.run_id, owner_key: call.summary.owner_key, owner_kind: call.summary.owner_kind },
      record: {
        call_id: call.record.call_id, parent_call_id: call.record.parent_call_id,
        definition: { name: call.record.definition.name, source: call.record.definition.source },
        outcome: call.record.outcome,
        output: call.record.output ? { complete: call.record.output.complete, hash: call.record.output.hash } : null,
      },
    }] as const;
  }));
  const owner = capture.calls[0].summary;
  if (byId.size !== capture.calls.length) throw new Error("Duplicate invocation record");
  for (const call of byId.values()) {
    if (!call.record || call.summary.run_id !== capture.evalRunId || call.record.call_id !== call.callId ||
        call.summary.owner_key !== owner.owner_key || call.summary.owner_kind !== owner.owner_kind)
      throw new Error("Invocation records cross an execution or owner");
    const visited = new Set<string>();
    let current = call;
    while (current.record.parent_call_id !== null) {
      if (visited.has(current.callId)) throw new Error("Cyclic invocation lineage");
      visited.add(current.callId);
      const parent = byId.get(current.record.parent_call_id);
      if (!parent) throw new Error("Incomplete invocation lineage");
      current = parent;
    }
    if (current.callId !== capture.rootCallIds[0]) throw new Error("Unrelated invocation root");
  }
  const calls = Object.freeze([...byId.values()].map(({ callId, record }) => Object.freeze({
    callId, parentCallId: record.parent_call_id,
    definition: Object.freeze({ ...record.definition }), outcome: record.outcome,
  })));
  return {
    calls,
    async returns(select = () => true) {
      const values: ObservedReturn[] = [];
      for (const call of calls) {
        if (call.outcome !== "done" || !select(call)) continue;
        const output = byId.get(call.callId)!.record.output;
        if (!output?.complete || !output.hash) throw new Error("Incomplete recorded return: " + call.callId);
        const text = await readValue(output.hash);
        if (text === null || sha256HexSyncText(text) !== output.hash)
          throw new Error("Missing or corrupt recorded return: " + call.callId);
        values.push({ ...call, value: JSON.parse(text) });
      }
      return values;
    },
  };
}
