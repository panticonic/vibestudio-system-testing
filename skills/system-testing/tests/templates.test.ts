import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { readFileSync } from "node:fs";
import { AUTHORED_PART, templateTests } from "./templates.js";

function execution(
  returnValue: unknown,
  final: string,
  options: { code?: string; console?: string } = {},
): TestExecutionResult {
  return {
    duration: 0,
    messages: [
      { kind: "message", senderId: "user", complete: true, content: "prompt" },
      {
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        contentType: "invocation",
        invocation: {
          id: "template-overview",
          name: "eval",
          arguments: {
            code:
              options.code ??
              'return extensions.invoke("@workspace-extensions/templates", "authoringParts", []);',
          },
          execution: {
            status: "complete",
            isError: false,
            result: { details: { returnValue, console: options.console } },
          },
        },
      },
      {
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        content: final,
      },
    ],
  } as TestExecutionResult;
}

describe("template agentic validator", () => {
  it("names a workspace part that actually exists", () => {
    // The prompt asks the agent to snapshot this part and the validator checks
    // the plan selected it. When the part is deleted from the workspace, the
    // scenario fails as "the plan did not select it" — which reads like agent
    // behaviour and says nothing about the part being gone. That is how the
    // retired template registry left this test failing for days.
    const manifest = JSON.parse(
      readFileSync(new URL(`../../../${AUTHORED_PART}/package.json`, import.meta.url), "utf8"),
    ) as { name?: string };
    expect(manifest.name).toBeTruthy();
  });

  it("keeps only the flows the product still has", () => {
    // Catalog discovery was removed from the templates extension, so a test
    // orchestrating a call to it asserted a capability that no longer exists.
    expect(templateTests.map((test) => test.name)).toEqual(["templates-authoring-prepare"]);
  });

  it("accepts an exact preparation-only authoring plan", () => {
    const test = templateTests.find(
      ({ name }) => name === "templates-authoring-prepare",
    )!;
    const fingerprint = `v1-sha256:${"a".repeat(64)}`;
    expect(
      test.validate(
        execution(
          {
            available: [{ repoPath: AUTHORED_PART }],
            plan: {
              mainEventId: "event:main",
              fingerprint,
              requestedParts: [AUTHORED_PART],
              includedParts: [AUTHORED_PART, "packages/shared"],
              requiredParts: ["packages/shared"],
              manifest: "systemEpoch: 0\n",
            },
          },
          `Prepared the template plan with fingerprint ${fingerprint}. Nothing was published.`,
          {
            code: [
              "const available = await extensions.invoke('@workspace-extensions/templates', 'authoringParts', []);",
              `const plan = await extensions.invoke('@workspace-extensions/templates', 'inspectAuthoring', [{ name: 'Registry', description: 'Template registry', parts: ['${AUTHORED_PART}'] }]);`,
              "return { available, plan };",
            ].join("\n"),
          },
        ),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("accepts a structured console receipt when the templates is held in a variable", () => {
    const test = templateTests.find(
      ({ name }) => name === "templates-authoring-prepare",
    )!;
    const fingerprint = `v1-sha256:${"b".repeat(64)}`;
    const plan = {
      fingerprint,
      selectedParts: [AUTHORED_PART],
      includedParts: [AUTHORED_PART],
      requiredParts: [],
      manifest: "systemEpoch: 0\n",
    };
    expect(
      test.validate(
        execution(
          undefined,
          `The exact fingerprint is ${fingerprint}. Nothing was published.`,
          {
            code: [
              "const templates = '@workspace-extensions/templates';",
              "const available = await rpc.call('main', 'extensions.invoke', [templates, 'authoringParts', []]);",
              `const plan = await rpc.call('main', 'extensions.invoke', [templates, 'inspectAuthoring', [{ name: 'Registry', description: 'Template registry', parts: ['${AUTHORED_PART}'] }]]);`,
              "console.log(JSON.stringify(plan));",
            ].join("\n"),
            console: JSON.stringify(plan),
          },
        ),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("rejects an authoring trajectory that published in the preparation-only scenario", () => {
    const test = templateTests.find(
      ({ name }) => name === "templates-authoring-prepare",
    )!;
    expect(
      test.validate(
        execution(
          {
            mainEventId: "event:main",
            fingerprint: `v1-sha256:${"a".repeat(64)}`,
            requestedParts: [AUTHORED_PART],
            includedParts: [AUTHORED_PART],
            manifest: "systemEpoch: 0\n",
          },
          "Published.",
          {
            code: [
              "await extensions.invoke('@workspace-extensions/templates', 'authoringParts', []);",
              `const plan = await extensions.invoke('@workspace-extensions/templates', 'inspectAuthoring', [{ name: 'Registry', description: 'Template registry', parts: ['${AUTHORED_PART}'] }]);`,
              "await extensions.invoke('@workspace-extensions/templates', 'publishAuthoring', [{ plan }]);",
              "return plan;",
            ].join("\n"),
          },
        ),
      ),
    ).toMatchObject({ passed: false });
  });

  it("accepts the reported exact receipt after an earlier draft inspection", () => {
    const test = templateTests.find(
      ({ name }) => name === "templates-authoring-prepare",
    )!;
    const firstFingerprint = `v1-sha256:${"c".repeat(64)}`;
    const finalFingerprint = `v1-sha256:${"d".repeat(64)}`;
    const exactPlan = (fingerprint: string) => ({
      mainEventId: "event:main",
      fingerprint,
      requestedParts: [AUTHORED_PART],
      includedParts: [AUTHORED_PART],
      requiredParts: [],
      manifest: "systemEpoch: 0\n",
    });
    expect(
      test.validate(
        execution(
          {
            drafts: [exactPlan(firstFingerprint), exactPlan(finalFingerprint)],
          },
          `Prepared the final template plan with fingerprint ${finalFingerprint}. Nothing was published.`,
          {
            code: [
              "const templates = '@workspace-extensions/templates';",
              "await extensions.invoke(templates, 'authoringParts', []);",
              `await extensions.invoke(templates, 'inspectAuthoring', [{ name: 'Draft', description: 'First draft', parts: ['${AUTHORED_PART}'] }]);`,
              `return await extensions.invoke(templates, 'inspectAuthoring', [{ name: 'Final', description: 'Final draft', parts: ['${AUTHORED_PART}'] }]);`,
            ].join("\n"),
          },
        ),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("reconstructs one receipt when shared plan values are serialized separately", () => {
    const test = templateTests.find(
      ({ name }) => name === "templates-authoring-prepare",
    )!;
    const fingerprint = `v1-sha256:${"e".repeat(64)}`;
    expect(
      test.validate(
        execution(
          {
            summary: {
              fingerprint,
              requestedParts: [AUTHORED_PART],
              includedParts: [AUTHORED_PART],
            },
            plan: {
              fingerprint,
              mainEventId: "event:main",
              requestedParts: "[Circular]",
              includedParts: "[Circular]",
              manifest: "systemEpoch: 0\n",
            },
          },
          `Prepared the template plan with fingerprint ${fingerprint}. Nothing was published.`,
          {
            code: [
              "const templates = '@workspace-extensions/templates';",
              "await extensions.invoke(templates, 'authoringParts', []);",
              `return await extensions.invoke(templates, 'inspectAuthoring', [{ name: 'Registry', description: 'Template registry', parts: ['${AUTHORED_PART}'] }]);`,
            ].join("\n"),
          },
        ),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });
});
