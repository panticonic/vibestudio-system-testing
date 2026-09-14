import {
  CONTENT_WORKSPACE_REPO_FIXTURE,
  type TestCase,
  type TestExecutionResult,
} from "../types.js";
import {
  findLastAgentMessage,
  getToolCalls,
  noIncompleteInvocations,
} from "./_helpers.js";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function png(result: Record<string, unknown> | null): string | null {
  const blocks = result?.["protocolContent"];
  if (!Array.isArray(blocks)) return null;
  for (const raw of blocks) {
    const block = record(raw);
    if (
      block?.["type"] === "image" &&
      block["mimeType"] === "image/png" &&
      typeof block["data"] === "string" &&
      block["data"].startsWith("iVBORw0KGgo")
    ) {
      return block["data"];
    }
  }
  return null;
}

function workspacePath(value: unknown): string | null {
  return typeof value === "string" ? value.replace(/^\/+/, "") : null;
}

function validateSavedImage(execution: TestExecutionResult) {
  if (execution.error) return { passed: false, reason: execution.error };
  const pending = noIncompleteInvocations(execution);
  if (!pending.passed) return pending;
  const calls = getToolCalls(execution);
  const successful = calls.filter(
    (call) =>
      call.execution?.status === "complete" && call.execution.isError !== true,
  );
  let savedImage = false;
  for (const generated of successful.filter(
    (call) => call.name === "imagegen",
  )) {
    const result = record(generated.execution?.result);
    const details = record(result?.["details"]);
    const mutation = record(details?.["mutation"]);
    const path = workspacePath(details?.["outputPath"]);
    const original = png(result);
    if (
      !path?.startsWith("projects/") ||
      !original ||
      mutation?.["status"] !== "applied" ||
      mutation["storage"] !== "vcs"
    )
      continue;
    savedImage = true;

    // The native read tool returns original bytes for images within its visual
    // bounds. Compare those bytes to the generator result, not the agent's claim
    // or an image attachment echoed directly from generation.
    const reread = successful.find((call) => {
      if (call.name !== "read") return false;
      const readResult = record(call.execution?.result);
      const readDetails = record(readResult?.["details"]);
      return (
        workspacePath(readDetails?.["path"]) === path &&
        readDetails?.["wasResized"] === false &&
        png(readResult) === original
      );
    });
    if (reread && findLastAgentMessage(execution).trim()) {
      const byteLength =
        (original.length / 4) * 3 -
        (original.endsWith("==") ? 2 : original.endsWith("=") ? 1 : 0);
      return {
        passed: true,
        details: { path, byteLength, exactReadback: true },
      };
    }
  }
  return {
    passed: false,
    reason: savedImage
      ? "Native generation saved an image, but reading the saved file did not return the same original PNG bytes"
      : "No successful native image generation with an applied managed-file save and original PNG output",
  };
}

export const imageGenerationTests: TestCase[] = [
  {
    name: "native-imagegen-save-read",
    description:
      "Generate a real illustration, save its original PNG through managed source, and reopen it losslessly",
    category: "image-generation",
    timeoutMs: 420_000,
    workspaceRepoFixture: CONTENT_WORKSPACE_REPO_FIXTURE,
    validation: "agent-evidence",
    prompt:
      "Create a richly detailed painted adventure-game landscape: a moonlit ferry landing, a weathered customs house, wet cobblestones, and warm brass lanterns, in a unified gouache storybook style. Make a landscape PNG at 1536 by 1024 pixels. Save the original illustration in the provided project, reopen the saved image to inspect it, and tell me where you saved it.",
    validate: validateSavedImage,
  },
];
