import type { TestCase } from "../types.js";
import { NativeCredentialResolutionObservationSchema } from "@vibestudio/service-schemas/credentials";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import {
  getToolCalls,
  noIncompleteInvocations,
  successfulEvalCode,
  successfulEvalReturnValues,
} from "./_helpers.js";

const MISSING_CREDENTIAL_AUDIENCE = "https://system-test-missing.invalid/resource";

function credentialMissChecked(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const evalCalls = getToolCalls(result).filter((call) => call.name === "eval");
  const code = successfulEvalCode(result);
  if (
    evalCalls.length !== 1 ||
    !/credentials\.(?:resolveCredential|forAudience)\s*\(/u.test(code) ||
    !code.includes(MISSING_CREDENTIAL_AUDIENCE)
  ) {
    return {
      passed: false,
      reason: "Successful eval did not resolve the reserved missing credential audience",
    };
  }
  const allEvalCode = getToolCalls(result)
    .filter((call) => call.name === "eval")
    .map((call) => (typeof call.arguments?.["code"] === "string" ? call.arguments["code"] : ""))
    .join("\n");
  if (
    /credentials\.(?:connect|configureClient|requestCredentialInput)|openExternal/u.test(
      allEvalCode
    )
  ) {
    return {
      passed: false,
      reason: "Credential miss probe attempted interactive credential or authorization UI",
    };
  }

  const values = successfulEvalReturnValues(result);
  const value =
    values.length === 1 && values[0] && typeof values[0] === "object" && !Array.isArray(values[0])
      ? (values[0] as Record<string, unknown>)
      : null;
  const expectedRequest = sha256HexSyncText(JSON.stringify([{ url: MISSING_CREDENTIAL_AUDIENCE }]));
  const observedMiss = evalCalls.some((call) => {
    const envelope = call.execution?.result as { details?: { operationJournal?: {
      protocol?: unknown; truncated?: unknown; entries?: unknown[];
    } } } | undefined;
    const journal = envelope?.details?.operationJournal;
    if (journal?.protocol !== "workspace-operations.v1" || journal.truncated !== false || !Array.isArray(journal.entries)) return false;
    return journal.entries.some((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const native = entry as Record<string, unknown>;
      if (native["type"] !== "credentials.resolution") return false;
      const parsed = NativeCredentialResolutionObservationSchema.safeParse(native["receipt"]);
      return parsed.success && !parsed.data.found && parsed.data.requestDigest === expectedRequest;
    });
  });
  const exposedCredentialData =
    value !== null &&
    Object.entries(value).some(
      ([key, field]) =>
        /(token|secret|password|credentialId|accessKey)/iu.test(key) && field != null
    );
  if (!observedMiss || exposedCredentialData) {
    return {
      passed: false,
      reason: "Credential miss eval returned no secret-safe structured miss observation",
    };
  }
  return noIncompleteInvocations(result);
}

export const oauthTests: TestCase[] = [
  {
    name: "resolve-credential-miss",
    description: "Resolve an unbound URL audience as a non-interactive null miss",
    category: "oauth",
    prompt: `Check whether this workspace already has a credential for ${MISSING_CREDENTIAL_AUDIENCE}. It should be a quiet lookup only: do not connect an account, open authorization UI, request input, or expose secrets.`,
    validate: credentialMissChecked,
    reportClaims: [
      { id: "credential", claim: "The answer is about a credential or authorization for the URL.", match: /(credential|authorization|oauth)/iu },
      {
        id: "missing",
        claim: "No credential is available for the URL.",
        match: /(not (?:found|available|configured|bound)|no [^.\n]*(?:credential|binding)|missing|unavailable)/iu,
      },
      {
        id: "quiet",
        claim: "The check did not prompt the user, open an authorization window, or reveal a secret.",
        match: /(quiet|read.?only|non.?interactive|(without|did not|didn['’]t|no)\b[^.\n]*(prompt|window|browser|secret|authoriz))/iu,
      },
    ],
  },
];
