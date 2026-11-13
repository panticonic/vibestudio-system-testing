/**
 * Natlang skill-port scenarios, wave 1 (plan section 6).
 *
 * Each case gives a user-level goal and grades two halves. The surface half
 * reads the eval result's `natlang.calls`: the ported function ran to
 * completion, so the small model was actually asked. The agent half checks one
 * discriminating token that only an agent which used the result could produce.
 * The prompts never name the function or the skill; finding it is the point.
 */
import type { TestCase, TestExecutionResult } from "../types.js";
import { validateAgentCompletionReport } from "../test-runner.js";
import { findLastAgentMessage, getToolCalls } from "./_helpers.js";

const CATEGORY = "natlang-skills";

// The small-model cases are explicitOnly until each function meets its suite gates on the executor
// (see the skill's DECOMPOSITION.md): a skill whose function is not ported does not direct the agent to it,
// so a default run would fail for a reason the suite already records.

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The natlang calls the successful eval cells reported, by function name and outcome. */
function natlangCalls(result: TestExecutionResult): Array<{ name: string; outcome: string }> {
  return getToolCalls(result).flatMap((call) => {
    if (call.name !== "eval" || call.execution?.status !== "complete" || call.execution.isError) return [];
    const section = record(record(record(call.execution.result)?.["details"])?.["natlang"]);
    const calls = section?.["calls"];
    return Array.isArray(calls)
      ? calls.flatMap((entry) => {
          const summary = record(entry);
          return typeof summary?.["name"] === "string" && typeof summary["outcome"] === "string"
            ? [{ name: summary["name"], outcome: summary["outcome"] }]
            : [];
        })
      : [];
  });
}

/** Every named function completed at least once ("done" is natlang's success outcome). */
function requireNatlang(result: TestExecutionResult, names: readonly string[]) {
  const calls = natlangCalls(result);
  const missing = names.filter((name) => !calls.some((call) => call.name === name && call.outcome === "done"));
  return missing.length === 0
    ? { passed: true as const }
    : {
        passed: false as const,
        reason: `The natlang function(s) ${missing.join(", ")} never completed in an eval. Reported calls: ${
          calls.map((call) => `${call.name}:${call.outcome}`).join(", ") || "(none)"
        }`,
      };
}

function sentTool(result: TestExecutionResult, name: string) {
  return getToolCalls(result).filter(
    (call) => call.name === name && call.execution?.status === "complete" && call.execution.isError !== true
  );
}

export const natlangSkillsWave1Tests: TestCase[] = [
  {
    name: "natlang-automations-weekday-reminder",
    description:
      "A recurring reminder is launched as a fixed-text notify on a weekday cron, after the executor and schedule were read by the small model",
    category: CATEGORY,
    explicitOnly: true,
    prompt:
      "Set up a reminder for me: every weekday at 9am New York time, tell me to stretch.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["chooseExecutor", "readSchedule"]);
      if (!natlang.passed) return natlang;
      const launch = sentTool(result, "launch_automation")[0];
      const action = record(launch?.arguments?.["action"]);
      const trigger = record(launch?.arguments?.["trigger"]);
      if (!launch || action?.["kind"] !== "notify") {
        return { passed: false, reason: "The reminder was not launched as a fixed-text notify action" };
      }
      if (
        trigger?.["kind"] !== "cron" ||
        trigger["timezone"] !== "America/New_York" ||
        !/^0 9 \* \* (?:MON,TUE,WED,THU,FRI|MON-FRI)$/u.test(String(trigger["expression"]))
      ) {
        return { passed: false, reason: `The trigger does not say every weekday at 09:00 New York time: ${JSON.stringify(trigger)}` };
      }
      return /stretch/iu.test(findLastAgentMessage(result))
        ? { passed: true }
        : { passed: false, reason: "The final response did not say what the reminder tells the user" };
    },
  },
  {
    name: "natlang-messaging-build-failure-alert",
    description:
      "A failure report for a person who is away is given a rung above none, after the rung was chosen by the small model",
    category: CATEGORY,
    explicitOnly: true,
    // A headless test channel has no human participant for `owner` to resolve to, so the goal asks which rung to use, not for a send.
    prompt:
      "I am going to be away from this chat for the evening. The nightly build on main just failed with three red tests. Which alert level (none, inbox, or interrupt) would you use to tell me about it, and why? Do not send anything yet.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["alertRung"]);
      if (!natlang.passed) return natlang;
      if (sentTool(result, "notify").length > 0) {
        return { passed: false, reason: "The agent sent a message although the user asked only which level it would use" };
      }
      return /\binbox\b/iu.test(findLastAgentMessage(result))
        ? { passed: true }
        : { passed: false, reason: "The final response did not recommend the inbox rung for a failure the user would find later" };
    },
  },
  {
    name: "natlang-visualize-revenue-chart",
    description:
      "Monthly figures are answered with a Chart whose props were read by the small model and rendered by the strict helper",
    category: CATEGORY,
    explicitOnly: true,
    prompt:
      "Show me how our revenue moved this year: January 12k, February 14k, March 13k, April 18k, May 21k.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["chooseComponent", "readProps"]);
      if (!natlang.passed) return natlang;
      const message = findLastAgentMessage(result);
      return /<Chart\b/u.test(message) && /\b21\b/u.test(message)
        ? { passed: true }
        : { passed: false, reason: "The final message does not carry a Chart tag with the May figure" };
    },
  },
  {
    name: "natlang-provenance-original-request",
    description:
      "A question about why a file says what it says is answered through the provenance mechanism the small model chose",
    category: CATEGORY,
    explicitOnly: true,
    prompt:
      "skills/messaging/SKILL.md says notifications should be rare. What was being attempted when that was written, as far as the recorded history shows? If the record does not reach a person's request, say how far it does reach.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["provenanceMechanism"]);
      if (!natlang.passed) return natlang;
      return sentTool(result, "provenance").length > 0
        ? { passed: true }
        : { passed: false, reason: "The agent never called the provenance tool after choosing a mechanism" };
    },
  },
  {
    name: "natlang-sandbox-optional-choice",
    description:
      "A choice the work does not depend on is offered as non-blocking Choices, after the surface was picked by the small model",
    category: CATEGORY,
    explicitOnly: true,
    prompt:
      "I will need to pick a colour theme for the new dashboard at some point, but I want you to keep going on the layout in the meantime. Give me a few themes I can choose from whenever I get to it.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["interactionSurface"]);
      if (!natlang.passed) return natlang;
      const blocking = getToolCalls(result).some((call) => ["ask_user", "feedback_form", "feedback_custom"].includes(call.name));
      if (blocking) return { passed: false, reason: "The agent blocked on the user for a choice the work did not depend on" };
      return /<Choices\b/u.test(findLastAgentMessage(result))
        ? { passed: true }
        : { passed: false, reason: "The final message does not offer the themes as Choices" };
    },
  },
  {
    name: "natlang-workspace-dev-brand-icon",
    description:
      "A worker that integrates Gmail gets the Gmail brand mark, chosen by the small model and confirmed against the shipped catalog",
    category: CATEGORY,
    explicitOnly: true,
    prompt:
      "I am adding a worker called gmail-summaries that summarizes my Gmail messages. Which identity icon should it have in the workspace? Tell me the one you picked.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["iconIntent"]);
      if (!natlang.passed) return natlang;
      return /brand:gmail|gmail (?:brand )?(?:mark|logo|icon)/iu.test(findLastAgentMessage(result))
        ? { passed: true }
        : { passed: false, reason: "The final response did not name the Gmail brand mark" };
    },
  },
  {
    name: "natlang-templates-private-source",
    description:
      "A failed template inspection of a private source is answered with the credential step, classified by the small model",
    category: CATEGORY,
    explicitOnly: true,
    prompt:
      'Inspecting the template at https://github.com/acme/private-template failed with: Connect credential "github-personal" for https://github.com/acme/private-template.git. What should I do next?',
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["templateRemedy"]);
      if (!natlang.passed) return natlang;
      return /credential|connect/iu.test(findLastAgentMessage(result))
        ? { passed: true }
        : { passed: false, reason: "The final response did not point the user at connecting the credential" };
    },
  },
  {
    name: "natlang-remote-access-probe-failure",
    description:
      "A remote doctor failure at the hub probe is attributed to the hub control layer by the small model",
    category: CATEGORY,
    explicitOnly: true,
    requiresUnits: ["skills/remote-access"],
    prompt:
      "My phone cannot reach my Vibestudio server any more. This is what the doctor printed:\n\nVibestudio remote doctor\n  ✓ native-binding: @number0/iroh 1.1.0 native binding loads\n  ✓ credential-endpoint: device credential owns endpoint 91d0a5e2c4b8…\n  ✓ relay-config: 1 canonical HTTPS relay(s) from paired reach\n  ✗ iroh-probe: Iroh probe failed: probe exceeded 15000ms overall deadline\n  ✓ retired-transport: retired native dependencies and environment are absent\n\nWhich part is broken, and what should I check next?",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["remoteLayer"]);
      if (!natlang.passed) return natlang;
      return /hub|control|probe|relay/iu.test(findLastAgentMessage(result))
        ? { passed: true }
        : { passed: false, reason: "The final response did not locate the failure at the hub control path" };
    },
  },
];
