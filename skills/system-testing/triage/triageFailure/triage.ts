/** Triage one failed test: read its signals, decide the layer, quote the evidence. */
import signals from "./signals.js";
import classifyFailure from "./classifyFailure.nl";
import evidence from "./evidence.js";
import type { Failure, Triage } from "../types.js";

export default async function triage(failure: Failure): Promise<Triage> {
  const read = signals(failure);
  const failureClass = await classifyFailure(read);
  return { class: failureClass, evidence: evidence(failureClass, read) };
}
