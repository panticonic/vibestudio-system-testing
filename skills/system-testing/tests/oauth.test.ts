import { describe, expect, it } from "vitest";

import type { TestExecutionResult } from "../types.js";
import { oauthTests } from "./oauth.js";
import { sha256HexSyncText } from "@vibestudio/content-addressing";

const URL = "https://system-test-missing.invalid/resource";

function credentialMissExecution(
  code: string,
  result: unknown = { missing: true },
  native: { found: boolean; requestDigest: string } | null = {
    found: false,
    requestDigest: sha256HexSyncText(JSON.stringify([{ url: URL }])),
  }
): TestExecutionResult {
  return {
    duration: 0,
    messages: [
      {
        id: "prompt",
        kind: "message",
        senderId: "user",
        complete: true,
        content: "prompt",
      },
      {
        id: "eval",
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        contentType: "invocation",
        content: "",
        invocation: {
          id: "eval-call",
          name: "eval",
          status: "complete",
          terminalOutcome: "success",
          isError: false,
          arguments: { code },
          result: { details: { success: true, returnValue: result,
            operationJournal: { protocol: "workspace-operations.v1", truncated: false, entries: native ? [{
              type: "credentials.resolution", receipt: {
                protocol: "credential-resolution-observation.v1", method: "credentials.resolveCredential", ...native,
              },
            }] : [] },
          } },
        },
      } as unknown as TestExecutionResult["messages"][number],
      {
        id: "final",
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        content:
          "No stored credential is bound to that API audience. I checked quietly without opening an authorization prompt or exposing any secret.",
      },
    ],
  } as TestExecutionResult;
}

function test() {
  const found = oauthTests.find((candidate) => candidate.name === "resolve-credential-miss");
  if (!found) throw new Error("Missing resolve-credential-miss test");
  return found;
}

describe("OAuth system test validators", () => {
  it("accepts any safe guest summary while requiring native evidence of the exact miss", () => {
    const code = `return await credentials.resolveCredential({ url: "${URL}" });`;
    const native = { found: false, requestDigest: sha256HexSyncText(JSON.stringify([{ url: URL }])) };
    expect(test().validate(credentialMissExecution(code, { found: false }, native)).passed).toBe(true);
    expect(test().validate(credentialMissExecution(code, { missing: true }, null)).passed).toBe(false);
    expect(test().validate(credentialMissExecution(code, { missing: true }, { ...native, requestDigest: "a".repeat(64) })).passed).toBe(false);
    expect(test().validate(credentialMissExecution(code, { missing: true }, { ...native, found: true })).passed).toBe(false);
  });
  it("accepts a read-only miss report with ordinary typographic punctuation", () => {
    const result = credentialMissExecution(`return await credentials.resolveCredential({ url: "${URL}" });`);
    result.messages[result.messages.length - 1]!.content =
      "No credential is stored for that URL. This was a read-only lookup; I didn’t connect an account or expose any secrets.";
    expect(test().validate(result)).toEqual({ passed: true });
  });

  it("proves the null credential-resolution contract without interactive authorization", () => {
    const result = credentialMissExecution(
      `const value = await credentials.resolveCredential({ url: "${URL}" }); return { missing: value === null };`
    );

    expect(test().validate(result)).toEqual({ passed: true });
  });

  it("rejects prose-only claims of a credential miss", () => {
    const result = credentialMissExecution("return { missing: true };");

    expect(test().validate(result)).toMatchObject({
      passed: false,
      reason: "Successful eval did not resolve the reserved missing credential audience",
    });
  });

  it("rejects credential or authorization UI attempts", () => {
    const result = credentialMissExecution(
      `const value = await credentials.resolveCredential({ url: "${URL}" }); await credentials.connect({}); return { missing: value === null };`
    );

    expect(test().validate(result)).toMatchObject({
      passed: false,
      reason: "Credential miss probe attempted interactive credential or authorization UI",
    });
  });

  it("rejects an eval that did not return a true miss observation", () => {
    const result = credentialMissExecution(
      `const value = await credentials.resolveCredential({ url: "${URL}" }); return { missing: value === null };`,
      { missing: false },
      { found: true, requestDigest: sha256HexSyncText(JSON.stringify([{ url: URL }])) }
    );

    expect(test().validate(result)).toMatchObject({
      passed: false,
      reason: "Credential miss eval returned no secret-safe structured miss observation",
    });
  });

  it("accepts equivalent structured null-miss evidence and natural reporting", () => {
    const result = credentialMissExecution(
      `const value = await credentials.resolveCredential({ url: "${URL}" }); return { exists: Boolean(value), summary: value ? { id: value.id } : null };`,
      { exists: false, summary: null }
    );
    result.messages[result.messages.length - 1]!.content =
      "No existing credential was found or placed on file, and no authorization UI or secret was exposed.";

    expect(test().validate(result)).toEqual({ passed: true });
  });

  it("accepts a direct boolean credential-presence observation", () => {
    const result = credentialMissExecution(
      `const value = await credentials.resolveCredential({ url: "${URL}" }); return { hasCredential: value !== null };`,
      { hasCredential: false }
    );
    result.messages[result.messages.length - 1]!.content =
      "No stored credential matches this URL, and no authorization UI or secret was exposed.";

    expect(test().validate(result)).toEqual({ passed: true });
  });

  it("accepts the ergonomic audience handle as an equivalent quiet miss probe", () => {
    const result = credentialMissExecution(
      `try {
        await credentials.forAudience({
          audiences: [{ url: "${URL}", match: "origin" }],
          label: "workspace-check",
        });
        return { hasCredential: true };
      } catch (error) {
        if (/No URL-bound credential found/i.test(String(error))) {
          return { hasCredential: false };
        }
        throw error;
      }`,
      { hasCredential: false }
    );
    result.messages[result.messages.length - 1]!.content =
      "No credential is stored for that URL. The quiet lookup did not expose a credential.";

    expect(test().validate(result)).toEqual({ passed: true });
  });

  it("rejects exposed credential metadata in a claimed miss result", () => {
    const result = credentialMissExecution(
      `const value = await credentials.resolveCredential({ url: "${URL}" }); return { missing: value === null, credentialId: value?.id };`,
      { missing: true, credentialId: "credential-secret-id" }
    );

    expect(test().validate(result)).toMatchObject({
      passed: false,
      reason: "Credential miss eval returned no secret-safe structured miss observation",
    });
  });
});
