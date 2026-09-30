import { describe, expect, it } from "vitest";
import {
  isUnexpectedToolFailure,
  isGuestCodeFailure,
  isPreExecutionArgumentRejection,
  isCorrectableToolInputRejection,
  isSafeEvalDomainRejection,
  isSafeProvenanceDomainRejection,
  isSafeSubagentDomainRejection,
  isSafeVcsDomainRejection,
} from "./tool-failure-classification.js";

describe("tool failure classification", () => {
  it.each(["argument-rejection", "domain-rejection", "guest-code-failure"] as const)(
    "does not forgive an undeclared %s after recovery",
    (classification) => {
      expect(isUnexpectedToolFailure({ classification })).toBe(true);
      expect(isUnexpectedToolFailure({ classification, expected: true })).toBe(false);
    },
  );
  it("recognizes only pre-dispatch argument validation failures", () => {
    expect(
      isPreExecutionArgumentRejection(
        "Invalid arguments for tool vcs: bad operation",
      ),
    ).toBe(true);
    expect(
      isPreExecutionArgumentRejection(
        "[tool.vcs:execute] unknown_tool_failure: Invalid arguments for tool vcs: /path: Expected string",
      ),
    ).toBe(true);
    expect(
      isPreExecutionArgumentRejection(
        '{"details":{"failure":{"message":"[tool.vcs:execute] unknown_tool_failure: Invalid arguments for tool vcs: bad root"}}}',
      ),
    ).toBe(true);
    expect(
      isPreExecutionArgumentRejection(
        "The user wrote: Invalid arguments for tool vcs",
      ),
    ).toBe(false);
    expect(
      isPreExecutionArgumentRejection("[vcs.push] publication failed"),
    ).toBe(false);
  });

  it("recognizes exact typed no-effect input rejection without hiding execution failures", () => {
    const failure = {
      details: {
        failure: {
          protocol: "agent-tool-failure.v1",
          operation: "tool.read",
          kind: "invalid-input",
          retry: { policy: "correct-input" },
        },
      },
    };
    expect(isCorrectableToolInputRejection("read", failure)).toBe(true);
    const editFailure = structuredClone(failure);
    editFailure.details.failure.operation = "tool.edit";
    expect(isCorrectableToolInputRejection("edit", editFailure)).toBe(true);
    expect(
      isCorrectableToolInputRejection("edit", JSON.stringify(editFailure)),
    ).toBe(true);
    expect(isCorrectableToolInputRejection("verify", failure)).toBe(false);
    expect(
      isCorrectableToolInputRejection(
        "read",
        `User wrote ${JSON.stringify(failure)}`,
      ),
    ).toBe(false);
    expect(
      isCorrectableToolInputRejection("verify", {
        details: {
          failure: {
            protocol: "agent-tool-failure.v1",
            kind: "infrastructure",
            retry: { policy: "none" },
          },
        },
      }),
    ).toBe(false);
    expect(isCorrectableToolInputRejection("verify", "no_test_files")).toBe(
      false,
    );
    expect(isCorrectableToolInputRejection("write", failure)).toBe(false);
    expect(
      isCorrectableToolInputRejection("read", undefined, Symbol("missing")),
    ).toBe(false);
  });

  it("keeps an exact-root provenance miss classified separately", () => {
    expect(isSafeProvenanceDomainRejection("provenance", "InvalidReference")).toBe(true);
    expect(isSafeProvenanceDomainRejection("provenance", "Unauthorized")).toBe(false);
    expect(isSafeProvenanceDomainRejection("vcs", "InvalidReference")).toBe(false);
  });

  it("keeps safe typed VCS refusals classified separately", () => {
    expect(isSafeVcsDomainRejection("vcs", "WorkingChangesPresent")).toBe(true);
    expect(isSafeVcsDomainRejection("vcs", "RevisionChanged")).toBe(true);
    expect(isSafeVcsDomainRejection("vcs", "BuildGateFailed")).toBe(true);
    expect(isSafeVcsDomainRejection("commit", "RevisionChanged")).toBe(false);
    expect(isSafeVcsDomainRejection("vcs", "InvalidReference")).toBe(true);
  });

  it("does not hide authorization, integrity, or untyped failures", () => {
    expect(isSafeVcsDomainRejection("vcs", "Unauthorized")).toBe(false);
    expect(isSafeVcsDomainRejection("vcs", "IntegrityFailure")).toBe(false);
    expect(isSafeVcsDomainRejection("eval", "WorkingChangesPresent")).toBe(
      false,
    );
    expect(isSafeVcsDomainRejection("vcs", undefined)).toBe(false);
  });

  it("keeps typed pre-execution eval module rejection classified separately", () => {
    expect(isSafeEvalDomainRejection("eval", "module_not_available")).toBe(true);
    expect(isSafeEvalDomainRejection("eval", "guest_execution_failed")).toBe(false);
    expect(isSafeEvalDomainRejection("read", "module_not_available")).toBe(false);
  });

  it("separates typed guest program and build failures from infrastructure failures", () => {
    expect(
      isGuestCodeFailure("eval", "guest_execution_failed", "user-code"),
    ).toBe(true);
    expect(
      isGuestCodeFailure("eval", "package_export_not_found", "user-code"),
    ).toBe(true);
    expect(
      isGuestCodeFailure("verify", "build_verification_failed", "user-code"),
    ).toBe(true);
    expect(
      isGuestCodeFailure(
        "verify",
        "build_verification_failed",
        "infrastructure",
      ),
    ).toBe(false);
    expect(
      isGuestCodeFailure("eval", "guest_execution_failed", "infrastructure"),
    ).toBe(false);
    expect(
      isGuestCodeFailure("eval", "module_not_available", "user-code"),
    ).toBe(false);
    expect(
      isGuestCodeFailure("read", "guest_execution_failed", "user-code"),
    ).toBe(false);
  });

  it("keeps typed ambiguous subagent inspection classified separately", () => {
    expect(isSafeSubagentDomainRejection("inspect_subagent", "InvalidReference")).toBe(true);
    expect(isSafeSubagentDomainRejection("inspect_subagent", "unknown_tool_failure")).toBe(false);
    expect(isSafeSubagentDomainRejection("read", "InvalidReference")).toBe(false);
  });
});
