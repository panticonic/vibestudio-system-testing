import type { TestCase, TestExecutionResult, TestResult } from "../types.js";
import { panelControlAuthorityPolicy, PANEL_AUTOMATION_RESOURCE } from "../panel-authority.js";
import {
  findLastAgentMessage,
  noIncompleteInvocations,
  successfulEvalCode,
  successfulEvalReturnValues,
} from "./_helpers.js";
import { walkRecords } from "./_scenario-evidence.js";

/**
 * Tendrils loop (docs/tendrils-plan.md 7, milestone 1): the agent writes a live
 * page, presents it on a device, changes it while it runs, reaches into it,
 * and sees a deliberately broken update go back to the working version.
 */
const TENDRIL_LOOP_PROMPT =
  "Make me a tiny live kitchen-timer page that I can keep open on one of my devices, " +
  "following the tendrils skill. Show it on whichever of my devices is available. " +
  "Then: set its shared state so it shows 5 minutes, confirm from inside the page " +
  "that it displays that, and call one function the page exposes. Next, make a " +
  "deliberately broken update to the page (code that throws before it renders), " +
  "update it, and tell me what happened to the page. Finally go back to a working " +
  "version if it is not already there, and report the device you used.";

function anyRecord(values: unknown[], test: (item: Record<string, unknown>) => boolean): boolean {
  return values.some((value) => walkRecords([value]).some(test));
}

export function validateTendrilLoop(result: TestExecutionResult): TestResult {
  if (result.error) return { passed: false, reason: `Agent-goal execution failed: ${result.error}` };
  const code = successfulEvalCode(result);
  const required: [RegExp, string][] = [
    [/@workspace\/tendril\/agent/u, "import the tendril agent kit"],
    [/createTendril\s*\(/u, "create a tendril"],
    [/listDevices\s*\(/u, "list the user's devices"],
    [/\.present\s*\(/u, "present the tendril on a device"],
    [/\.state\.apply\s*\(/u, "write shared state"],
    [/\.eval\s*\(/u, "run code inside the page"],
    [/\.call\s*\(/u, "call a function the page exposed"],
    [/\.update\s*\(/u, "update the presentations"],
  ];
  const missing = required.filter(([pattern]) => !pattern.test(code)).map(([, what]) => what);
  if (missing.length)
    return { passed: false, reason: `The agent did not ${missing.join(", ")} through eval` };

  const values = successfulEvalReturnValues(result);
  const presented = anyRecord(
    values,
    (item) =>
      typeof item["slotId"] === "string" &&
      (item["state"] === "presented" || item["state"] === "pushed" || item["state"] === "pending-device"),
  );
  if (!presented)
    return { passed: false, reason: "No eval result showed a presentation result with its slot" };
  const failedUpdate = anyRecord(
    values,
    (item) =>
      typeof item["slotId"] === "string" &&
      item["outcome"] !== null &&
      typeof item["outcome"] === "object" &&
      "failed" in (item["outcome"] as Record<string, unknown>),
  );
  if (!failedUpdate)
    return { passed: false, reason: "No update result reported the deliberately broken build as failed" };

  const final = findLastAgentMessage(result);
  if (!/(went back|reverted|rolled back|previous|working version)/iu.test(final))
    return {
      passed: false,
      reason: "The final report did not say the page returned to its working version",
    };
  return noIncompleteInvocations(result);
}

export const tendrilTests: TestCase[] = [
  {
    name: "tendril-loop",
    description:
      "Present a live page on a device, drive it through state, eval and an exposed function, and survive a broken update",
    category: "tendrils",
    authorityPolicy: panelControlAuthorityPolicy("inspect-tendril-page"),
    resources: [PANEL_AUTOMATION_RESOURCE],
    prompt: TENDRIL_LOOP_PROMPT,
    validate: validateTendrilLoop,
  },
];
