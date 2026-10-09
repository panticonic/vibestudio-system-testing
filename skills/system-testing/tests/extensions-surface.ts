import { NativeExtensionInvocationObservationSchema } from "@vibestudio/service-schemas/extensions";
import type { TestCase, TestExecutionResult } from "../types.js";
import {
  completedScenarioEvidence,
  completedEvalOperationEntries,
  requireCodeOperations,
  walkArrays,
  walkRecords,
} from "./_scenario-evidence.js";

function extensionEvidence(
  result: TestExecutionResult,
  alternatives: readonly (readonly string[])[]
) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const exercised = requireCodeOperations(base.evidence.evalCode, alternatives);
  return exercised.passed ? { passed: true as const, evidence: base.evidence } : exercised;
}

function hasDiagnostics(values: readonly unknown[]): boolean {
  return walkRecords(values).some(
    (record) =>
      Array.isArray(record["diagnostics"]) ||
      (record["result"] !== null &&
        typeof record["result"] === "object" &&
        Array.isArray((record["result"] as Record<string, unknown>)["diagnostics"]))
  );
}

export const extensionSurfaceTests: TestCase[] = [
  {
    name: "extension-list",
    description: "List the extensions available in this workspace",
    category: "extensions",
    prompt: "Which extensions are currently registered and ready to use in this workspace?",
    validate: (result) => {
      const base = extensionEvidence(result, [["build.listUnits"]]);
      if (!base.passed) return base;
      return walkArrays(base.evidence.evalValues).some((entries) => entries.some((entry) =>
        entry !== null && typeof entry === "object" &&
        typeof (entry as Record<string, unknown>)["name"] === "string" &&
        ((entry as Record<string, unknown>)["name"] as string).startsWith("@workspace-extensions/") &&
        (entry as Record<string, unknown>)["status"] === "ready"
      ))
        ? { passed: true, reason: undefined }
        : { passed: false, reason: "The completed extension registry call returned no entries" };
    },
  },
  {
    name: "extension-typecheck-unit",
    description: "Typecheck a workspace unit through the typecheck extension",
    category: "extensions",
    prompt:
      "Use the installed typecheck extension to request diagnostics for a small existing workspace unit, and summarize what it reports.",
    validate: (result) => {
      const base = extensionEvidence(result, [
        ["extensions.invoke", "typecheck", "check"],
        ["extensions.use", "typecheck", "check"],
      ]);
      if (!base.passed) return base;
      return hasDiagnostics(base.evidence.evalValues)
        ? { passed: true, reason: undefined }
        : {
            passed: false,
            reason: "The completed typecheck invocation returned no diagnostics collection",
          };
    },
  },
  {
    name: "extension-invoke-roundtrip",
    description: "Invoke a harmless extension method and report the structured result",
    category: "extensions",
    prompt:
      "Use an available extension for a harmless read-only task and tell me what it returned.",
    validate: (result) => {
      const base = completedScenarioEvidence(result);
      if (!base.passed) return base;
      const invoked = completedEvalOperationEntries(result).some(
        (entry) =>
          entry["type"] === "extension.invocation" &&
          NativeExtensionInvocationObservationSchema.safeParse(entry["receipt"])
            .success,
      );
      return invoked
        ? { passed: true, reason: undefined }
        : {
            passed: false,
            reason:
              "No completed extension invocation was observed through its native transport",
          };
    },
  },
];
