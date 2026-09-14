import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { assertSystemTestDeclaration } from "../prompt-contract.js";
import { imageGenerationTests } from "./image-generation.js";

const scenario = imageGenerationTests[0]!;
const image =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
function execution(
  options: {
    saved?: boolean;
    read?: boolean;
    path?: string;
    bytes?: string;
    resized?: boolean;
  } = {},
): TestExecutionResult {
  const call = (
    name: string,
    details: Record<string, unknown>,
    bytes: string,
  ) => ({
    id: name,
    kind: "message",
    senderId: "agent",
    senderMetadata: { type: "agent" },
    complete: true,
    contentType: "invocation",
    content: JSON.stringify({
      id: name,
      name,
      execution: {
        status: "complete",
        isError: false,
        result: {
          protocolContent: [
            { type: "image", mimeType: "image/png", data: bytes },
          ],
          details,
        },
      },
    }),
  });
  const messages = [
    call(
      "imagegen",
      {
        outputPath: "projects/fixture/landing.png",
        mutation: {
          status: options.saved === false ? "failed" : "applied",
          storage: "vcs",
        },
      },
      image,
    ),
  ];
  if (options.read !== false)
    messages.push(
      call(
        "read",
        {
          path: options.path ?? "/projects/fixture/landing.png",
          wasResized: options.resized ?? false,
        },
        options.bytes ?? image,
      ),
    );
  messages.push({
    id: "final",
    kind: "message",
    senderId: "agent",
    senderMetadata: { type: "agent" },
    complete: true,
    contentType: "text",
    content: "Saved and inspected the ferry landing illustration.",
  });
  return { messages: messages as TestExecutionResult["messages"], duration: 1 };
}

describe("native image-generation evidence", () => {
  it("accepts a managed save followed by identical original bytes read from its file", () => {
    expect(() => assertSystemTestDeclaration(scenario)).not.toThrow();
    expect(scenario.validate(execution())).toMatchObject({
      passed: true,
      details: { exactReadback: true },
    });
  });
  it.each([
    { saved: false },
    { read: false },
    { path: "/projects/fixture/other.png" },
    { bytes: image.replace("AAAANS", "AAAANT") },
    { resized: true },
  ])("rejects missing or mismatched persistence evidence: %j", (options) => {
    expect(scenario.validate(execution(options)).passed).toBe(false);
  });
  it("preserves transport failure even when tool evidence looks complete", () => {
    expect(
      scenario.validate({ ...execution(), error: "connection lost" }),
    ).toEqual({ passed: false, reason: "connection lost" });
  });
});
