/** Which signals support a class: the record's own fields, in the order that class is decided by. */
import type { FailureClass, Signal, SignalSource } from "../types.js";

const DECISIVE: Record<FailureClass, SignalSource[]> = {
  validator: ["validator-error", "validation", "final-message"],
  harness: ["fixture", "orchestration", "phase", "session-error"],
  infrastructure: [
    "tool-failure",
    "phase",
    "session-error",
    "cleanup",
    "latency",
    "incomplete-invocation",
  ],
  documentation: ["tool-failure", "final-message", "validation"],
};

/** At most three signals, those of the decisive sources first; never empty when the record has any signal. */
export default function evidence(
  failureClass: FailureClass,
  signals: readonly Signal[],
): Signal[] {
  const order = DECISIVE[failureClass];
  const decisive = order.flatMap((source) =>
    signals.filter((signal) => signal.source === source),
  );
  const rest = signals.filter((signal) => !order.includes(signal.source));
  return [...decisive, ...rest].slice(0, 3);
}
