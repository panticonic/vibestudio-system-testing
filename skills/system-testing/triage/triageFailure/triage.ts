/** Triage one failed test: the typed fields decide when they can, the small model reads the rest; the evidence is quoted. */
import classify from "./classify.js";
import signals from "./signals.js";
import deliveredOutcome from "./deliveredOutcome.nl";
import evidence from "./evidence.js";
import type { Failure, FailureClass, Triage } from "../types.js";

export default async function triage(failure: Failure): Promise<Triage> {
  const read = signals(failure);
  let failureClass: FailureClass | null = classify(failure);
  if (failureClass === null) {
    // No typed signal names a layer: either the agent did the job and the check was too narrow, or it did not.
    const delivered = await deliveredOutcome(
      read.find((signal) => signal.source === "final-message")?.text ?? "",
      read.find((signal) => signal.source === "validation")?.text ?? "",
    );
    failureClass = delivered ? "validator" : "documentation";
  }
  return { class: failureClass, evidence: evidence(failureClass, read) };
}
