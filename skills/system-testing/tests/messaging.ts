/**
 * Messaging scenarios (agent messaging unification plan §8).
 *
 * Each case grades two halves. The exact half reads the tool result — the
 * addressee that resolved, the rung that was chosen, the durable entry that was
 * written. The agent half is one discriminating token that only an agent which
 * actually used that result could produce. A failure should say which half
 * broke: "the mechanism is dead" and "the mechanism worked and the agent
 * ignored it" are different findings with different owners.
 */
import type { TestCase, TestExecutionResult } from "../types.js";
import { validateAgentCompletionReport } from "../test-runner.js";
import { findLastAgentMessage, getToolCalls } from "./_helpers.js";

type ToolCall = ReturnType<typeof getToolCalls>[number];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function callDetails(call: ToolCall): Record<string, unknown> | null {
  return record(record(call.execution?.result)?.["details"]);
}

function resultText(call: ToolCall): string {
  const result = record(call.execution?.result);
  const content = result?.["protocolContent"] ?? result?.["content"];
  const blocks = Array.isArray(content) ? content : [];
  const text = blocks
    .map((block) => record(block)?.["text"])
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  return `${text}\n${typeof result?.["error"] === "string" ? result["error"] : ""}`;
}

function succeeded(call: ToolCall): boolean {
  return call.execution?.status === "complete" && call.execution.isError !== true;
}

function messagesSent(result: TestExecutionResult): ToolCall[] {
  return getToolCalls(result).filter((call) => call.name === "notify");
}

/** Addressees the tool actually resolved, as it recorded them. */
function sentEntries(call: ToolCall): Record<string, unknown>[] {
  const sent = callDetails(call)?.["sent"];
  return Array.isArray(sent) ? sent.flatMap((entry) => (record(entry) ? [record(entry)!] : [])) : [];
}

export const messagingTests: TestCase[] = [
  {
    name: "unreachable-addressee-fails-closed",
    description:
      "An agent told to reach a participant who is not present reports it, and does not broadcast instead",
    category: "messaging",
    validation: "agent-evidence",
    // The refusal is the point of the case, not an infrastructure defect.
    expectedToolFailures: [{ name: "notify" }],
    prompt:
      "Send a short note to the archivist on this channel letting them know the sync finished. " +
      "If you cannot reach that exact person, tell me so and tell me who is here instead — " +
      "do not announce it to everyone as a fallback.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const sends = messagesSent(result);
      // The load-bearing property: an addressee that cannot be resolved never
      // degrades into telling everyone. Assert this first — it is the failure
      // that actually costs someone something.
      const broadcast = sends.find(
        (call) => succeeded(call) && call.arguments?.["to"] === undefined
      );
      if (broadcast) {
        return {
          passed: false,
          reason: "The agent addressed the whole channel when its exact addressee was unavailable",
        };
      }
      // Either route through the mechanism is correct, and neither is better:
      // attempting the send and being refused, or enumerating first and finding
      // nobody. Requiring one of them would grade choreography, not behaviour.
      const refused = sends.find((call) => call.execution?.isError === true);
      const enumerated = getToolCalls(result).find(
        (call) => call.name === "list_addressees" && succeeded(call)
      );
      if (!refused && !enumerated) {
        return {
          passed: false,
          reason:
            "The agent neither attempted the send nor checked who was addressable; the absence was asserted, not established",
        };
      }
      // Fail-closed is only useful if it also names an alternative; an agent
      // told nothing but "no" has nowhere to go but a broadcast.
      if (refused && !/did you mean|list_addressees|no participant/iu.test(resultText(refused))) {
        return {
          passed: false,
          reason: "The refusal carried neither a suggestion nor a way to see who is addressable",
        };
      }
      if (enumerated) {
        const rows = callDetails(enumerated)?.["addressees"];
        const refs = (Array.isArray(rows) ? rows : []).map((row) => record(row)?.["ref"]);
        if (refs.some((ref) => typeof ref === "string" && /archivist/iu.test(ref))) {
          return {
            passed: false,
            reason: "The addressee the agent reported unreachable was in fact enumerated as present",
          };
        }
      }
      const final = findLastAgentMessage(result);
      if (!/archivist/iu.test(final)) {
        return {
          passed: false,
          reason: "The final response did not tell the user which addressee could not be reached",
        };
      }
      return { passed: true };
    },
  },
  {
    name: "addressees-are-enumerable",
    description: "An agent can answer who it is able to message here, in the form it would use",
    category: "messaging",
    validation: "agent-evidence",
    prompt:
      "Who can you send a message to in this conversation right now? For each one, show me the " +
      "exact form you would use to address them.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const listing = getToolCalls(result).find(
        (call) => call.name === "list_addressees" && succeeded(call)
      );
      if (!listing) {
        return {
          passed: false,
          reason: "The agent never enumerated its addressees; it answered from guesswork",
        };
      }
      const rows = callDetails(listing)?.["addressees"];
      const refs = (Array.isArray(rows) ? rows : [])
        .map((row) => record(row)?.["ref"])
        .filter((ref): ref is string => typeof ref === "string" && ref.length > 0);
      if (refs.length === 0) {
        return { passed: false, reason: "The addressee listing returned no addressable rows" };
      }
      // The whole point of the surface: what it prints is what the send tool
      // accepts, so an answer that repeats a printed ref proves the round trip.
      const final = findLastAgentMessage(result);
      if (!refs.some((ref) => final.includes(ref))) {
        return {
          passed: false,
          reason: "The response quoted none of the enumerated refs, so the round trip is unproven",
        };
      }
      return { passed: true };
    },
  },
  {
    name: "steer-a-running-child",
    description: "A supervisor corrects a live child by messaging it rather than polling it",
    category: "messaging",
    validation: "agent-evidence",
    timeoutMs: 600_000,
    prompt:
      "Delegate to a subagent to count the markdown files under the skills directory in the background. " +
      "Once it is under way, tell it you also want the total line count, then give me both numbers.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const steer = messagesSent(result).find((call) => {
        if (!succeeded(call)) return false;
        const to = call.arguments?.["to"];
        const refs = Array.isArray(to) ? to : [to];
        return refs.some((ref) => typeof ref === "string" && ref.startsWith("run:"));
      });
      if (!steer) {
        return {
          passed: false,
          reason:
            "The supervisor never steered the child; new instructions reached it by some other route or not at all",
        };
      }
      if (!sentEntries(steer).some((entry) => typeof entry["runId"] === "string")) {
        return {
          passed: false,
          reason: "The steering send resolved to no exact run, so it cannot have reached one child",
        };
      }
      const final = findLastAgentMessage(result);
      if (!/\d/u.test(final)) {
        return {
          passed: false,
          reason: "The supervisor reported no numbers, so the corrected work never came back",
        };
      }
      return { passed: true };
    },
  },
];
