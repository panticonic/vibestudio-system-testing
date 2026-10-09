import {
  preparation,
  publicationMessages,
} from "./_project-evidence-fixtures.js";
import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { scaffoldMatrixTests } from "./scaffold-matrix.js";
import { missingUnitsFor } from "../cli.js";

function invocation(
  id: string,
  name: string,
  args: Record<string, unknown>,
  details: Record<string, unknown>,
) {
  return {
    kind: "message" as const,
    senderId: "agent",
    senderMetadata: { type: "agent" },
    complete: true,
    contentType: "invocation" as const,
    invocation: {
      id,
      name,
      arguments: args,
      execution: {
        status: "complete",
        isError: false,
        result: { protocolContent: [], details },
      },
    },
  };
}

function execution(
  calls: ReturnType<typeof invocation>[],
): TestExecutionResult {
  return {
    duration: 0,
    messages: [
      { kind: "message", senderId: "user", complete: true, content: "prompt" },
      ...calls,
      ...publicationMessages(calls),
      {
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        content:
          "The requested scaffold was published and its exact validation is clean.",
      },
    ],
  } as TestExecutionResult;
}

function created(projectType: string, target: string) {
  return {
    returnValue: {
      created: target,
      files: ["package.json", "index.ts"],
      preflight: {
        ok: true,
        scope: "planned-repository",
        semanticBuildGate: "pending-publication",
        projectType,
        authorityRequestCount: 0,
        importedPackages: [] as string[],
        checked: ["canonical project type", "non-empty repository"],
      },
      preparation: preparation(),
    },
  };
}

function createdAgenticWorker(target: string) {
  const result = created("worker", target);
  result.returnValue.files = [
    "package.json",
    "index.ts",
    `${target.split("/").at(-1)}-worker.ts`,
    `${target.split("/").at(-1)}-worker.test.ts`,
  ];
  result.returnValue.preflight.importedPackages = [
    "@workspace/agentic-do",
    "@workspace/harness",
    "vitest",
  ];
  return result;
}

function buildReceipt(target: string) {
  const contextId = "context:scaffold";
  return {
    operation: "build",
    target,
    status: "ok",
    receipt: {
      protocol: "unit-verification-receipt.v1",
      operation: "build",
      stateHash: `state:${"a".repeat(64)}`,
      target,
      contextId,
      ref: `ctx:${contextId}`,
      reportDigest: "a".repeat(64),
      unit: { repoPath: target, kind: target.split("/")[0]!.slice(0, -1) },
      status: "ok",
      builds: [{ target: "runtime", buildKey: "b".repeat(64) }],
      diagnostics: { total: 0, retained: 0, truncated: 0 },
    },
  };
}

describe("scaffold build matrix", () => {
  it("schedules the Svelte scaffold only where its framework and template are installed", () => {
    const test = scaffoldMatrixTests.find(
      (test) => test.name === "scaffold-svelte-panel-build",
    )!;
    expect(missingUnitsFor(test, ["packages/runtime"])).toEqual([
      "packages/svelte",
      "templates/svelte",
    ]);
    expect(
      missingUnitsFor(test, [
        "packages/runtime",
        "packages/svelte",
        "templates/svelte",
      ]),
    ).toEqual([]);
    expect(missingUnitsFor(test, ["packages/svelte"])).toEqual([
      "templates/svelte",
    ]);
    const react = scaffoldMatrixTests.find(
      (test) => test.name === "scaffold-react-panel-build",
    )!;
    expect(missingUnitsFor(react, ["packages/runtime"])).toEqual([]);
  });

  it("limits native test-runner preauthorization to the agentic worker suite", () => {
    const agentic = scaffoldMatrixTests.find(
      (test) => test.name === "scaffold-agentic-worker-build",
    )!;
    const stateless = scaffoldMatrixTests.find(
      (test) => test.name === "scaffold-stateless-worker-build",
    )!;
    const agenticPolicy =
      typeof agentic.authorityPolicy === "object"
        ? agentic.authorityPolicy
        : undefined;
    expect(agenticPolicy?.authority).toEqual([
      {
        ruleId: "agentic-worker-native-suite-verification",
        capability: {
          kind: "prefix",
          prefix: "userland:extensions/test-runner/native.code.execute-tests#",
        },
        resource: {
          kind: "exact",
          key: "native.code.tests:extension:@workspace-extensions/test-runner",
        },
        tier: "gated",
        decision: "once",
      },
    ]);
    expect(stateless.authorityPolicy).toBeUndefined();
  });

  it("covers every canonical scaffold variant through a real repository fixture", () => {
    expect(
      scaffoldMatrixTests.map((test) => [
        test.name,
        test.workspaceRepoFixture?.section,
      ]),
    ).toEqual([
      ["scaffold-react-panel-build", "panels"],
      ["scaffold-svelte-panel-build", "panels"],
      ["scaffold-stateless-worker-build", "workers"],
      ["scaffold-agentic-worker-build", "workers"],
      ["scaffold-package-build", "packages"],
      ["scaffold-skill-build", "skills"],
      ["scaffold-content-project-preflight", "projects"],
    ]);
    for (const test of scaffoldMatrixTests) {
      expect(test.validation).toBeUndefined();
      expect(test.prompt).not.toMatch(
        /prepareProjects|build-verification-receipt|ctx:/u,
      );
    }
  });

  for (const [name, projectType, target] of [
    ["scaffold-react-panel-build", "panel", "panels/react-board"],
    ["scaffold-svelte-panel-build", "panel", "panels/svelte-board"],
    ["scaffold-stateless-worker-build", "worker", "workers/stateless-worker"],
    ["scaffold-agentic-worker-build", "worker", "workers/agent-worker"],
    ["scaffold-package-build", "package", "packages/library"],
    ["scaffold-skill-build", "skill", "skills/helper"],
  ] as const) {
    it(`accepts ${name} only with a later exact build receipt`, () => {
      const test = scaffoldMatrixTests.find(
        (candidate) => candidate.name === name,
      )!;
      const create = invocation(
        `create:${name}`,
        "eval",
        { code: "return await prepareProjects(request);" },
        name === "scaffold-agentic-worker-build"
          ? createdAgenticWorker(target)
          : created(projectType, target),
      );
      const verify = invocation(
        `verify:${name}`,
        "verify",
        { operation: "build", target },
        buildReceipt(target),
      );

      expect(test.validate(execution([create, verify]))).toEqual({
        passed: true,
        reason: undefined,
      });
      expect(test.validate(execution([verify, create]))).toEqual({
        passed: false,
        reason:
          "The published scaffold was not followed by a clean exact build receipt",
      });
    });
  }

  it("rejects a stateless worker as evidence for the agentic worker scaffold", () => {
    const test = scaffoldMatrixTests.find(
      (candidate) => candidate.name === "scaffold-agentic-worker-build",
    )!;
    const target = "workers/stateless-worker";
    const create = invocation(
      "create:agentic-from-stateless",
      "eval",
      { code: "return await prepareProjects(request);" },
      created("worker", target),
    );
    const verify = invocation(
      "verify:stateless",
      "verify",
      { operation: "build", target },
      buildReceipt(target),
    );

    expect(test.validate(execution([create, verify]))).toEqual({
      passed: false,
      reason:
        "No published agentic worker scaffold with its canonical dependencies and native suite was returned",
    });
  });

  it("accepts the content-only scaffold without inventing a build target", () => {
    const test = scaffoldMatrixTests.find(
      (candidate) => candidate.name === "scaffold-content-project-preflight",
    )!;
    const create = invocation(
      "create:content",
      "eval",
      { code: "return await prepareProjects(request);" },
      created("project", "projects/notes"),
    );

    expect(test.validate(execution([create]))).toEqual({
      passed: true,
      reason: undefined,
    });
  });
});
