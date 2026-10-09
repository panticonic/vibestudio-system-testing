import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { buildTests } from "./build.js";
import { messagingTests } from "./messaging.js";
import { evalLifecycleTests } from "./eval-lifecycle.js";
import { extensionSurfaceTests } from "./extensions-surface.js";
import { filesystemTests } from "./filesystem.js";
import { multiUserTests } from "./multi-user.js";
import { mobileTests } from "./mobile.js";
import { workerTests } from "./workers.js";
import { workspaceTests } from "./workspace.js";
import { completedScenarioEvidence, requireCodeOperations } from "./_scenario-evidence.js";
import { getToolCalls } from "./_helpers.js";

interface EvalStep {
  code: string;
  imports?: Record<string, string>;
  returnValue?: unknown;
  operationJournal?: { protocol: string; entries: unknown[]; truncated: boolean };
  kernelIncarnationId?: string;
  reset?: boolean;
  status?: "complete" | "error" | "cancelled";
  result?: unknown;
  authority?: Record<string, unknown>;
}

interface ToolStep {
  name: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
}

function extensionJournal(
  transport: "invoke" | "invokeProvider",
  result: Record<string, unknown>,
) {
  return {
    protocol: "workspace-operations.v1",
    truncated: false,
    entries: [
      {
        type: "extension.invocation",
        receipt: {
          protocol: "extension-invocation-observation.v1",
          transport,
          ...(transport === "invoke"
            ? { extensionKey: "@workspace-extensions/probe" }
            : { providerKey: "gitInterop" }),
          method: transport === "invoke" ? "status" : "upstreamStatus",
          result,
        },
      },
    ],
  };
}

function typecheckJournal(
  extensionKey = "@workspace-extensions/typecheck-service",
  method = "checkPanel",
) {
  return {
    protocol: "workspace-operations.v1",
    truncated: false,
    entries: [
      {
        type: "extension.invocation",
        receipt: {
          protocol: "extension-invocation-observation.v1",
          transport: "invoke",
          extensionKey,
          method,
          result: { kind: "object", keyCount: 3 },
        },
      },
    ],
  };
}

function execution(finalMessage: string, steps: EvalStep[]): TestExecutionResult {
  const messages: TestExecutionResult["messages"] = [
    {
      id: "prompt",
      kind: "message",
      senderId: "user",
      complete: true,
      content: "prompt",
    },
  ] as TestExecutionResult["messages"];
  steps.forEach((step, index) => {
    const status = step.status ?? "complete";
    messages.push({
      id: `eval-message-${index}`,
      kind: "message",
      senderId: "agent",
      senderMetadata: { type: "agent" },
      complete: true,
      contentType: "invocation",
      content: "",
      invocation: {
        id: `eval-${index}`,
        name: "eval",
        status,
        terminalOutcome:
          status === "complete" ? "success" : status === "cancelled" ? "cancelled" : "tool_error",
        isError: status !== "complete",
        arguments: {
          code: step.code,
          ...(step.imports === undefined ? {} : { imports: step.imports }),
          ...(step.reset === undefined ? {} : { reset: step.reset }),
          ...(step.authority === undefined ? {} : { authority: step.authority }),
        },
        result:
          step.result ??
          (step.returnValue === undefined && step.operationJournal === undefined
            ? undefined
            : {
                details: {
                  ...(step.returnValue === undefined ? {} : { returnValue: step.returnValue }),
                  ...(step.operationJournal === undefined ? {} : { operationJournal: step.operationJournal }),
                  ...(step.kernelIncarnationId
                    ? { kernel: { incarnationId: step.kernelIncarnationId } }
                    : {}),
                },
              }),
      },
    } as unknown as TestExecutionResult["messages"][number]);
  });
  messages.push({
    id: "final",
    kind: "message",
    senderId: "agent",
    senderMetadata: { type: "agent" },
    complete: true,
    content: finalMessage,
  } as TestExecutionResult["messages"][number]);
  return { duration: 0, messages };
}

function directExecution(finalMessage: string, steps: ToolStep[]): TestExecutionResult {
  const result = execution(finalMessage, []);
  result.messages.splice(
    1,
    0,
    ...steps.map(
      (step, index) =>
        ({
          id: `tool-${index}`,
          kind: "message",
          senderId: "agent",
          senderMetadata: { type: "agent" },
          complete: true,
          contentType: "invocation",
          content: "",
          invocation: {
            id: `tool-${index}`,
            name: step.name,
            status: "complete",
            terminalOutcome: "success",
            isError: false,
            arguments: step.arguments ?? {},
            result: step.result,
          },
        }) as unknown as TestExecutionResult["messages"][number]
    )
  );
  return result;
}

function scenario(tests: { name: string }[], name: string) {
  const found = tests.find((candidate) => candidate.name === name);
  if (!found || !("validate" in found)) throw new Error(`Missing scenario ${name}`);
  return found as (typeof filesystemTests)[number];
}

describe("scenario tool protocol semantics", () => {
  it("recognizes asserted receivers while retaining the exact receiver and method", () => {
    expect(
      requireCodeOperations(
        "await (fs as any).symlink(target, link); await (workers as WorkerClient).list();",
        [["fs.symlink", "workers.list"]]
      ).passed
    ).toBe(true);
    expect(
      requireCodeOperations("await (other as any).symlink(target, link);", [["fs.symlink"]]).passed
    ).toBe(false);
    expect(
      requireCodeOperations("await (fs as any).readlink(link);", [["fs.symlink"]]).passed
    ).toBe(false);
  });
  it("recognizes quoted operation names independent of JavaScript quote style", () => {
    expect(
      requireCodeOperations("await rpc.call(target, 'providers', [])", [
        ["rpc.call", '"providers"'],
      ])
    ).toEqual({ passed: true, reason: undefined });
  });

  it("keeps pre-execution argument rejections diagnostic without calling them failed effects", () => {
    const result = execution("I corrected the call and completed the task.", []);
    result.messages.splice(1, 0, {
      id: "rejected",
      kind: "message",
      senderId: "agent",
      senderMetadata: { type: "agent" },
      complete: true,
      contentType: "invocation",
      content: "tool failed",
      invocation: {
        id: "rejected-edit",
        name: "edit",
        status: "error",
        terminalOutcome: "tool_error",
        isError: true,
        error: "Invalid arguments for tool edit: /newText: Expected required property",
      },
    } as unknown as TestExecutionResult["messages"][number]);

    expect(completedScenarioEvidence(result, [])).toMatchObject({
      passed: true,
    });
  });
});

describe("mobile onboarding validator", () => {
  it("requires a canonical provisioning receipt and validates facts independently of prose", () => {
    const validator = scenario(mobileTests, "onboarding-desktop-mobile-install-android");
    const fullWorkflow = [
      'const service = await workers.resolveService("vibestudio.phone-provisioning.v1");',
      'const providers = await rpc.call(service.targetId, "providers", []);',
      'const devices = await rpc.call(service.targetId, "devices", []);',
      'const provisioned = await rpc.call(service.targetId, "provision", []);',
      'const workspace = await rpc.call(service.targetId, "readiness", [{ deviceId: provisioned.pairedDevice.deviceId }]);',
      "return { provisioned, workspace };",
    ].join("\n");

    const provisioned = {
      providerId: "desktop-1",
      platform: "android",
      workspace: "system",
      attachedDeviceId: "emulator-5588",
      installStatus: "installed",
      compatibleAppInstalled: true,
      pairingStatus: "paired",
      workspaceStatus: "opening",
      pairedDevice: { deviceId: "mobile-1", label: "Phone", createdAt: 1 },
    };
    const workspace = {
      status: "ready",
      message: "Mobile workspace connected",
    };
    const check = (receipt: unknown, publicStatus = workspace) =>
      validator.validate(
        execution("The phone is set up and ready to use.", [
          {
            code: fullWorkflow,
            returnValue: {
              provisioned: receipt,
              workspace: publicStatus,
            },
          },
        ])
      );

    expect(check(provisioned)).toMatchObject({ passed: true });
    expect(check({ ...provisioned, compatibleAppInstalled: false })).toMatchObject({
      passed: false,
    });
    expect(check({ ...provisioned, pairedDevice: "[Circular]" })).toMatchObject({ passed: false });
    expect(check({ ...provisioned, platform: "ios" })).toMatchObject({
      passed: false,
    });
    expect(check(provisioned, { ...workspace, status: "failed" })).toMatchObject({
      passed: false,
    });
    expect(check(provisioned, { ...workspace, status: "opening" })).toMatchObject({
      passed: false,
    });
  });

  it("rejects a provider-less run even when failed attempts contain the full workflow", () => {
    const validator = scenario(mobileTests, "onboarding-desktop-mobile-install-android");
    const fullWorkflow = [
      'const service = await workers.resolveService("vibestudio.phone-provisioning.v1");',
      'const providers = await rpc.call(service.targetId, "providers", []);',
      'const devices = await rpc.call(service.targetId, "devices", []);',
      'const provisioned = await rpc.call(service.targetId, "provision", []);',
      'const ready = await extensions.invoke("mobile-debug", "verifyWorkspaceReady", []);',
      "return { devices, provisioned, ready };",
    ].join("\n");

    expect(
      validator.validate(
        execution("❌ Could not start provisioning because no desktop provider was available.", [
          {
            code: fullWorkflow,
            status: "error",
            result: { details: { message: "No desktop provider available" } },
          },
          {
            code: [
              'const service = await workers.resolveService("vibestudio.phone-provisioning.v1");',
              'const providers = await rpc.call(service.targetId, "providers", []);',
              "return { providersCount: providers.length, providers };",
            ].join("\n"),
            returnValue: { providersCount: 0, providers: [] },
          },
        ])
      )
    ).toMatchObject({ passed: false });
  });
});

describe("eval authority lifecycle validators", () => {
  const permissionsRead = {
    capability: "permissions.read",
    resource: { kind: "exact", key: "permissions.read" },
  };

  it("selects the actual restricted read after discovery and rejects any wider protected read", () => {
    const validator = scenario(evalLifecycleTests, "eval-exact-authority");
    const discovery: EvalStep = {
      code: "return await services.authority.preflight({service:'permissions',method:'list',args:[]});",
      authority: { effects: "read-only" },
      returnValue: { leaves: [permissionsRead] },
    };
    const read: EvalStep = {
      code: "return await services.permissions.list();",
      authority: { effects: "read-only", requests: [permissionsRead] },
      returnValue: [],
    };
    expect(validator.validate(execution("Read permissions only.", [discovery, read])).passed).toBe(
      true
    );
    const widerRead: EvalStep = {
      ...read,
      authority: {
        effects: "read-only",
        requests: [
          {
            capability: "permissions.read",
            resource: { kind: "prefix", prefix: "" },
          },
        ],
      },
    };
    expect(
      validator.validate(execution("Read permissions only.", [discovery, read, widerRead])).passed
    ).toBe(false);
    const unrestrictedRead: EvalStep = {
      ...read,
      authority: { effects: "read-only" },
    };
    expect(
      validator.validate(execution("Read permissions only.", [discovery, read, unrestrictedRead]))
        .passed
    ).toBe(false);
  });

  it("requires the exact request allowlist and structured result", () => {
    const validator = scenario(evalLifecycleTests, "eval-exact-authority");
    expect(
      validator.validate(
        execution("Read permissions.", [
          {
            code: "return await services.permissions.list();",
            authority: {
              effects: "read-only",
              approvals: "pregranted-only",
              requests: [permissionsRead],
            },
            returnValue: [],
          },
        ])
      ).passed
    ).toBe(true);
    expect(
      validator.validate(
        execution("Read permissions.", [
          {
            code: "return await services.permissions.list();",
            authority: { effects: "read-only", approvals: "pregranted-only" },
            returnValue: [],
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("requires an empty pregranted-only manifest and a structured denial", () => {
    const validator = scenario(evalLifecycleTests, "eval-pregranted-only");
    expect(
      validator.validate(
        execution("The operation was denied without requesting approval.", [
          {
            code: "try { await services.permissions.list(); } catch (error) { return { denied: true, message: String(error) }; }",
            authority: {
              effects: "read-only",
              requests: [],
              approvals: "pregranted-only",
            },
            returnValue: {
              denied: true,
              authorityFailure: {
                reasonCode: "run-manifest-denied",
                capability: "permissions.read",
                resourceKey: "permissions.read",
              },
            },
          },
        ])
      ).passed
    ).toBe(true);
    expect(
      validator.validate(
        execution("The operation was denied.", [
          {
            code: "return { denied: true, message: 'authority denied' };",
            authority: {
              approvals: "pregranted-only",
              requests: [permissionsRead],
            },
            returnValue: { denied: true, message: "authority denied" },
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("accepts the exact typed tool denial and rejects unrelated or widened failures", () => {
    const validator = scenario(evalLifecycleTests, "eval-pregranted-only");
    const denied: EvalStep = {
      code: "return await services.permissions.list();",
      status: "error",
      authority: {
        effects: "read-only",
        requests: [],
        approvals: "pregranted-only",
      },
      result: {
        details: {
          success: false,
          failureCode: "ERUNMANIFEST",
          errorData: {
            denied: true,
            authorityFailure: {
              reasonCode: "run-manifest-denied",
              capability: "permissions.read",
              resourceKey: "permissions.read",
            },
          },
        },
      },
    };
    expect(validator.validate(execution("Access was denied.", [denied])).passed).toBe(true);
    expect(
      validator.validate(
        execution("Access was denied.", [
          {
            ...denied,
            authority: { ...denied.authority, requests: [permissionsRead] },
          },
        ])
      ).passed
    ).toBe(false);
    expect(
      validator.validate(
        execution("Access was denied.", [
          denied,
          { code: "throw new Error('unrelated failure')", status: "error" },
        ])
      ).passed
    ).toBe(false);
    expect(
      validator.validate(
        execution("Access was denied.", [
          {
            ...denied,
            result: {
              details: {
                failureCode: "ERUNMANIFEST",
                errorData: {
                  denied: true,
                  authorityFailure: {
                    reasonCode: "run-manifest-denied",
                    capability: "fs.read",
                    resourceKey: "permissions.read",
                  },
                },
              },
            },
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("accepts authorization-only preparation followed by the actual read, and rejects a read before preparation", () => {
    const validator = scenario(evalLifecycleTests, "eval-preauthorization");
    const prepare: EvalStep = {
      code: 'return "Prepared without execution";',
      authority: {
        effects: "read-only",
        approvals: "prompt",
        preauthorize: [{ service: "permissions", method: "list", args: [] }],
      },
      returnValue: "Prepared without execution",
    };
    const read: EvalStep = {
      code: "return await services.permissions.list();",
      returnValue: [],
    };
    expect(validator.validate(execution("Read permissions.", [prepare, read])).passed).toBe(true);
    expect(validator.validate(execution("Read permissions.", [read, prepare])).passed).toBe(false);
    expect(validator.validate(execution("Prepared permissions.", [prepare])).passed).toBe(false);
  });

  it("joins same-cell preauthorization by stable invocation identity with a canonical snapshot and bounded inventory", () => {
    const validator = scenario(evalLifecycleTests, "eval-preauthorization");
    const result = execution("Read the actual inventory.", [
      {
        code: 'return await rpc.call("main", "permissions.list", []);',
        authority: {
          preauthorize: [{ service: "permissions", method: "list", args: [] }],
        },
        returnValue: {
          truncated: true,
          scopeKey: "$lastLargeReturn",
          scopeValueType: "string",
          originalChars: 445718,
          limitChars: 12000,
          preview: '[{"kind":"capability"}]',
        },
      },
      { code: "return {count:356};", returnValue: { count: 356 } },
    ]);
    result.snapshot = {
      invocations: getToolCalls(result).map((call) => ({
        id: call.id,
        name: call.name,
        status: call.execution?.status,
        args: call.arguments,
        result: call.execution?.result,
      })),
    } as TestExecutionResult["snapshot"];
    expect(validator.validate(result).passed).toBe(true);
    const calls = result.snapshot!.invocations;
    calls[0]!.args = {
      code: "return 1;",
      authority: {
        preauthorize: [{ service: "permissions", method: "list", args: [] }],
      },
    };
    expect(validator.validate(result).passed).toBe(false);
  });

  it("accepts a real bounded permissions inventory instead of requiring an unbounded return", () => {
    const validator = scenario(evalLifecycleTests, "eval-exact-authority");
    const read: EvalStep = {
      code: "return await services.permissions.list();",
      authority: { effects: "read-only", requests: [permissionsRead] },
      returnValue: {
        truncated: true,
        scopeKey: "$lastLargeReturn",
        scopeValueType: "string",
        originalChars: 400000,
        limitChars: 12000,
        preview: '[{"kind":"capability"}]',
      },
    };
    expect(validator.validate(execution("Read permissions.", [read])).passed).toBe(true);
    expect(
      validator.validate(
        execution("Read permissions.", [
          {
            ...read,
            returnValue: {
              truncated: true,
              scopeKey: "$lastLargeReturn",
              scopeValueType: "string",
              originalChars: 400000,
              limitChars: 12000,
              preview: "invented prose",
            },
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("binds preauthorization to the exact invocation arguments", () => {
    const validator = scenario(evalLifecycleTests, "eval-preauthorization");
    expect(
      validator.validate(
        execution("Read permissions.", [
          {
            code: "return await services.permissions.list();",
            authority: {
              effects: "read-only",
              approvals: "prompt",
              preauthorize: [{ service: "permissions", method: "list", args: [] }],
            },
            returnValue: [],
          },
        ])
      ).passed
    ).toBe(true);
    expect(
      validator.validate(
        execution("Read permissions.", [
          {
            code: "return await services.permissions.list();",
            authority: {
              effects: "read-only",
              approvals: "prompt",
              preauthorize: [
                {
                  service: "permissions",
                  method: "list",
                  args: [{ widened: true }],
                },
              ],
            },
            returnValue: [],
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("requires stable ordered cursor pages instead of a prose event claim", () => {
    const validator = scenario(evalLifecycleTests, "eval-events");
    const page = {
      events: [{ sequence: 1, kind: "state" }],
      next: 1,
      hasMore: true,
    };
    const finalPage = {
      events: [{ sequence: 2, kind: "console" }],
      next: 2,
      hasMore: false,
    };
    expect(
      validator.validate({
        messages: [],
        duration: 0,
        diagnostics: {
          evalEventPages: {
            terminal: { status: "done", result: { success: true } },
            firstPage: page,
            repeatedFirstPage: page,
            pages: [page, finalPage],
          },
        },
      }).passed
    ).toBe(true);
    expect(
      validator.validate({
        messages: [],
        duration: 0,
        diagnostics: {
          evalEventPages: {
            terminal: { status: "done", result: { success: true } },
            firstPage: page,
            repeatedFirstPage: { ...page, next: 2 },
            pages: [page, finalPage],
          },
        },
      }).passed
    ).toBe(false);
  });
});

describe("filesystem semantic validators", () => {
  const cases = [
    ["read-write-text", "fs.writeFile(); fs.readFile();", { written: "alpha", read: "alpha" }],
    [
      "append-file",
      "fs.writeFile(); fs.appendFile(); fs.readFile();",
      "First observation.Second observation.",
    ],
    ["directory-ops", "fs.writeFile(); fs.readdir();", ["one.txt", "two.txt"]],
    ["file-stats", "fs.writeFile(); fs.stat();", { size: 5, mtimeMs: 123 }],
    ["rename-copy", "fs.copyFile(); fs.readFile();", { source: "same", destination: "same" }],
    ["remove", "fs.mkdir(); fs.rm();", { exists: false }],
    ["symlinks", "fs.symlink(); fs.readlink();", { supported: true }],
    [
      "file-handles",
      "const handle = fs.open(); await handle.close();",
      { written: "through-handle", read: "through-handle" },
    ],
  ] as const;

  for (const [name, code, returnValue] of cases) {
    it(`accepts canonical ${name} evidence with ordinary prose`, () => {
      const validator = scenario(filesystemTests, name);
      expect(
        validator.validate(
          execution("I verified the temporary filesystem operation and cleaned up.", [
            { code, returnValue },
          ])
        ).passed
      ).toBe(true);
      expect(validator.validate(execution("Everything worked perfectly.", [])).passed).toBe(false);
    });
  }

  it("accepts recursive Dirent output without counting its directory as a third file", () => {
    const validator = scenario(filesystemTests, "directory-ops");
    const code = "fs.writeFile(); fs.readdir();";
    const entries = [
      { name: "one.txt", isFile: "[Function: isFile]" },
      { name: "nested", isDirectory: "[Function: isDirectory]" },
      { name: "nested/two.txt", isFile: "[Function: isFile]" },
    ];
    expect(
      validator.validate(
        execution("Both requested files are present.", [{ code, returnValue: { entries } }])
      ).passed
    ).toBe(true);
    expect(
      validator.validate(
        execution("The directory exists.", [
          { code, returnValue: { entries: entries.slice(0, 2) } },
        ])
      ).passed
    ).toBe(false);
  });

  it("accepts handle-based append and rejects incomplete or reversed content", () => {
    const validator = scenario(filesystemTests, "append-file");
    const code = `const handle = await fs.open(path, 'a'); await handle.write('Second observation.'); await handle.close(); return fs.readFile(path, 'utf8');`;
    for (const content of [
      "First observation.Second observation.",
      "First observation.\nSecond observation.",
    ])
      expect(
        validator.validate(execution("Both entries remain.", [{ code, returnValue: { content } }]))
          .passed
      ).toBe(true);
    for (const content of ["Second observation.", "Second observation.First observation."])
      expect(
        validator.validate(execution("Both entries remain.", [{ code, returnValue: { content } }]))
          .passed
      ).toBe(false);
  });

  it("does not accept discovery output as the outcome of a filesystem call", () => {
    const validator = scenario(filesystemTests, "append-file");
    expect(
      validator.validate(
        execution("It worked.", [
          { code: "await help('fs');", returnValue: "First observation.Second observation." },
          { code: "fs.appendFile(); fs.readFile();", returnValue: { ok: true } },
        ])
      ).passed
    ).toBe(false);
  });

  it("requires byte-accurate metadata and accepts a valid mapped stat result", () => {
    const validator = scenario(filesystemTests, "file-stats");
    const code = "fs.writeFile(); fs.stat();";
    for (const returnValue of [
      { size: 5, mtimeMs: 123 },
      { metadataSize: 5, modifiedAt: "2026-10-03T08:00:00Z" },
    ])
      expect(
        validator.validate(execution("The five bytes match the file.", [{ code, returnValue }]))
          .passed
      ).toBe(true);
    for (const returnValue of [
      { size: 33, mtimeMs: 123 },
      { size: 5 },
      { size: 5, mtime: "unknown" },
    ])
      expect(
        validator.validate(execution("The metadata matches.", [{ code, returnValue }])).passed
      ).toBe(false);
  });

  it("accepts a focused scratch write/read around an actual append evaluation", () => {
    const validator = scenario(filesystemTests, "append-file");
    const result = directExecution("Both log entries survived.", [
      {
        name: "write",
        arguments: { path: ".tmp/log.txt", content: "First observation." },
        result: { details: { storage: "scratch", bytesWritten: 18 } },
      },
      {
        name: "read",
        arguments: { path: ".tmp/log.txt" },
        result: {
          content: [{ type: "text", text: "First observation.Second observation." }],
          details: { path: ".tmp/log.txt" },
        },
      },
    ]);
    const append = execution("", [
      {
        code: `const handle = await fs.open('.tmp/log.txt', 'a'); await handle.write('Second observation.'); await handle.close();`,
        returnValue: { bytesWritten: 19 },
      },
    ]).messages.find((message) => message.invocation)!;
    result.messages.splice(2, 0, append);
    expect(validator.validate(result)).toMatchObject({ passed: true });
  });

  it("proves a focused append from applied mutations and a later read of the same file", () => {
    const validator = scenario(filesystemTests, "append-file");
    const first = "First observation.\n";
    const both = first + "Second observation.\n";
    const applied = {
      details: { protocol: "file-mutation.v1", storage: "scratch", status: "applied" },
    };
    const steps: ToolStep[] = [
      { name: "write", arguments: { path: ".tmp/log.txt", content: first }, result: applied },
      {
        name: "edit",
        arguments: { path: ".tmp/log.txt", oldText: first, newText: both },
        result: applied,
      },
      {
        name: "read",
        arguments: { path: ".tmp/log.txt" },
        result: { protocolContent: [{ type: "text", text: both }] },
      },
    ];
    expect(validator.validate(directExecution("Verified both entries.", steps)).passed).toBe(true);
    for (const invalid of [
      [
        steps[0]!,
        { ...steps[1]!, arguments: { ...steps[1]!.arguments, newText: "Second observation." } },
        steps[2]!,
      ],
      [steps[0]!, steps[1]!, { ...steps[2]!, arguments: { path: ".tmp/other.txt" } }],
      [
        steps[0]!,
        { ...steps[1]!, result: { details: { ...applied.details, status: "conflict" } } },
        steps[2]!,
      ],
      [steps[0]!, steps[1]!],
      [steps[1]!, steps[2]!],
    ])
      expect(validator.validate(directExecution("Verified both entries.", invalid)).passed).toBe(
        false
      );
  });

  it("accepts equivalent named imports from the scoped Node filesystem facade", () => {
    const validator = scenario(filesystemTests, "directory-ops");
    expect(
      validator.validate(
        execution("I created, listed, and removed the temporary directory.", [
          {
            code: `
              import { mkdir, writeFile, readdir as list, rm } from "fs/promises";
              await mkdir(".tmp/example");
              await writeFile(".tmp/example/one.txt", "first");
              await writeFile(".tmp/example/nested/two.txt", "second");
              const files = await list(".tmp/example", { recursive: true });
              await rm(".tmp/example", { recursive: true });
              return files;
            `,
            returnValue: ["one.txt", "two.txt"],
          },
        ])
      ).passed
    ).toBe(true);
  });

  it("accepts focused write/read tools as first-class scratch filesystem evidence", () => {
    const validator = scenario(filesystemTests, "read-write-text");
    expect(
      validator.validate(
        directExecution("The text round trip matched exactly.", [
          {
            name: "write",
            arguments: { path: ".tmp/example.txt", content: "same text" },
            result: { details: { bytesWritten: 9, storage: "scratch" } },
          },
          {
            name: "read",
            arguments: { path: ".tmp/example.txt" },
            result: { protocolContent: [{ type: "text", text: "same text" }] },
          },
        ])
      ).passed
    ).toBe(true);
  });

  it("accepts an atomic binary write joined to an exact bounded base64 read", () => {
    const validator = scenario(filesystemTests, "read-write-binary");
    const path = "projects/system-test-binary/asset.bin";
    expect(
      validator.validate(
        directExecution("The exact bytes 00 ff 01 fe survived.", [
          {
            name: "apply_patch",
            arguments: {
              operations: [{ kind: "write_binary", path, base64: "AP8B/g==" }],
            },
            result: { details: { status: "applied", paths: [path] } },
          },
          {
            name: "read_binary",
            arguments: { path, offset: 0, limit: 4 },
            result: {
              protocolContent: [
                {
                  type: "text",
                  text: JSON.stringify({
                    path,
                    encoding: "base64",
                    range: { start: 0, end: 4, totalBytes: 4 },
                    base64: "AP8B/g==",
                  }),
                },
              ],
              details: {
                encoding: "base64",
                byteRange: { start: 0, end: 4, totalBytes: 4 },
              },
            },
          },
        ])
      ).passed
    ).toBe(true);
    expect(validator.validation).toBe("harness");
    expect(validator.workspaceRepoFixture).toEqual({
      kind: "content",
      section: "projects",
    });
  });

  it("accepts focused nested writes and a structured listing as directory evidence", () => {
    const validator = scenario(filesystemTests, "directory-ops");
    expect(
      validator.validate(
        directExecution("The nested directory contains exactly the two files I wrote.", [
          {
            name: "write",
            arguments: { path: ".tmp/example/one.txt", content: "one" },
            result: { details: { bytesWritten: 3, storage: "scratch" } },
          },
          {
            name: "write",
            arguments: { path: ".tmp/example/nested/two.txt", content: "two" },
            result: { details: { bytesWritten: 3, storage: "scratch" } },
          },
          {
            name: "ls",
            arguments: { path: ".tmp/example" },
            result: {
              protocolContent: [{ type: "text", text: "one.txt\ntwo.txt" }],
              details: {
                path: ".tmp/example",
                entries: ["one.txt", "nested", "nested/two.txt"],
              },
            },
          },
        ])
      ).passed
    ).toBe(true);
  });

  it("accepts focused scratch copy/read evidence without pretending it exercised eval", () => {
    const validator = scenario(filesystemTests, "rename-copy");
    expect(
      validator.validate(
        directExecution("The copied content matched.", [
          {
            name: "write",
            arguments: { path: ".tmp/source.txt", content: "same text" },
            result: { details: { bytesWritten: 9, storage: "scratch" } },
          },
          {
            name: "copy_file",
            arguments: {
              source: ".tmp/source.txt",
              destination: ".tmp/destination.txt",
            },
            result: { details: { operation: "copied", storage: "scratch" } },
          },
          {
            name: "read",
            arguments: { path: ".tmp/destination.txt" },
            result: { protocolContent: [{ type: "text", text: "same text" }] },
          },
        ])
      ).passed
    ).toBe(true);
  });

  it("does not accept text-only focused tools as binary filesystem evidence", () => {
    const validator = scenario(filesystemTests, "read-write-binary");
    expect(
      validator.validate(
        directExecution("The text matched.", [
          {
            name: "write",
            arguments: { path: ".tmp/example.txt", content: "same text" },
          },
          {
            name: "read",
            arguments: { path: ".tmp/example.txt" },
            result: { protocolContent: [{ type: "text", text: "same text" }] },
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("does not misclassify a managed VCS write as scratch filesystem evidence", () => {
    const validator = scenario(filesystemTests, "read-write-text");
    expect(
      validator.validate(
        directExecution("The managed file content matched.", [
          {
            name: "write",
            arguments: {
              path: "projects/example/file.txt",
              content: "same text",
            },
            result: { details: { bytesWritten: 9, storage: "vcs" } },
          },
          {
            name: "read",
            arguments: { path: "projects/example/file.txt" },
            result: { protocolContent: [{ type: "text", text: "same text" }] },
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("accepts post-removal proof preserved in structured tool result content", () => {
    const validator = scenario(filesystemTests, "remove");
    expect(
      validator.validate(
        execution("I verified the directory no longer exists.", [
          {
            code: "await fs.mkdir(path); await fs.rm(path); return { baseExistsAfter: false };",
            result: {
              protocolContent: [
                {
                  type: "text",
                  text: '{"baseExistsAfter": false, "treeExistsAfter": false}',
                },
              ],
            },
          },
        ])
      ).passed
    ).toBe(true);
  });

  it("accepts a concrete symbolic-link observation without a synthetic supported field", () => {
    const validator = scenario(filesystemTests, "symlinks");
    expect(
      validator.validate(
        execution("The link identified itself as symbolic.", [
          {
            code: "await fs.symlink(target, link); return { isSym: (await fs.lstat(link)).isSymbolicLink() };",
            result: {
              protocolContent: [{ type: "text", text: '{"isSym": true}' }],
            },
          },
        ])
      ).passed
    ).toBe(true);
  });
  it("accepts a returned symlink mode and rejects regular-file metadata", () => {
    const validator = scenario(filesystemTests, "symlinks");
    const probe: EvalStep = {
      code: "await fs.symlink(target, link); return await fs.lstat(link);",
      returnValue: { mode: 0o120777 },
    };
    expect(validator.validate(execution("The link is symbolic.", [probe])).passed).toBe(true);
    expect(
      validator.validate(
        execution("The link is symbolic.", [{ ...probe, returnValue: { mode: 0o100600 } }])
      ).passed
    ).toBe(false);
  });

  it("accepts the observed asserted-receiver symlink probe without a prescribed report field", () => {
    const validator = scenario(filesystemTests, "symlinks");
    const code =
      "await (fs as any).symlink(target, link); return { linkStat: (await fs.lstat(link)).isSymbolicLink(), readlink: await (fs as any).readlink(link) };";
    expect(
      validator.validate(
        execution("Links work.", [
          { code, returnValue: { linkStat: true, readlink: "target.txt" } },
        ])
      ).passed
    ).toBe(true);
    expect(
      validator.validate(
        execution("Links work.", [
          { code, returnValue: { linkStat: false, readlink: "target.txt" } },
        ])
      ).passed
    ).toBe(false);
  });

  it("accepts concrete readlink and realpath observations nested in a probe report", () => {
    const validator = scenario(filesystemTests, "symlinks");
    expect(
      validator.validate(
        execution("Scratch symbolic links are supported and resolve inside the context.", [
          {
            code: "await fs.symlink(target, link); await fs.readlink(link); return report;",
            returnValue: {
              steps: [
                {
                  result: {
                    linkPath: "/.tmp/example/link.txt",
                    readlink: "target.txt",
                    realpath: "/.tmp/example/target.txt",
                  },
                },
              ],
            },
          },
        ])
      ).passed
    ).toBe(true);
  });

  it("does not treat the final prose claim as filesystem effect evidence", () => {
    const validator = scenario(filesystemTests, "remove");
    expect(
      validator.validate(
        execution("Verified existsAfterDir: false.", [
          { code: "await fs.mkdir(path); await fs.rm(path);" },
        ])
      ).passed
    ).toBe(false);
  });

  it("accepts a natural gone result from a completed removal probe", () => {
    const validator = scenario(filesystemTests, "remove");
    const code = "await fs.mkdir(path); await fs.rm(path); return { gone: !(await fs.exists(path)) };";
    expect(
      validator.validate(
        execution("The temporary directory is gone.", [
          { code, returnValue: { gone: true } },
        ])
      ).passed
    ).toBe(true);
    expect(
      validator.validate(
        execution("The temporary directory is gone.", [
          { code, returnValue: { gone: false } },
        ])
      ).passed
    ).toBe(false);
    expect(
      validator.validate(
        execution("The temporary directory is gone.", [
          { code: "return await help();", returnValue: { gone: true } },
          { code },
        ])
      ).passed
    ).toBe(false);
    expect(
      validator.validate(
        execution("The temporary directory is gone.", [
          { code, status: "error", returnValue: { gone: true } },
        ])
      ).passed
    ).toBe(false);
  });

  it("accepts explicit post-removal existence evidence", () => {
    const validator = scenario(filesystemTests, "remove");
    expect(
      validator.validate(
        execution("I verified the directory no longer exists.", [
          {
            code: "await fs.mkdir(path); await fs.rm(path); return { existsAfterDir: false };",
            returnValue: { existsAfterDir: false },
          },
        ])
      ).passed
    ).toBe(true);
  });
});

describe("build semantic validators", () => {
  it("requires a canonical exact-context first-class package build", () => {
    const result = directExecution("The selected package built successfully.", [
      {
        name: "verify",
        arguments: { operation: "build", target: "packages/example" },
        result: {
          details: {
            operation: "build",
            target: "packages/example",
            status: "ok",
            report: {
              repoPath: "packages/example",
              kind: "package",
              status: "ok",
              diagnostics: [],
              builds: [],
            },
            receipt: {
              protocol: "unit-verification-receipt.v1",
              operation: "build",
              stateHash: `state:${"a".repeat(64)}`,
              target: "packages/example",
              contextId: "context-build",
              ref: "ctx:context-build",
              status: "ok",
              unit: { repoPath: "packages/example", kind: "package" },
            },
          },
        },
      },
    ]);
    result.provenance = {
      channelId: null,
      branchId: null,
      agentEntityId: null,
      agentTargetId: null,
      contextId: "context-build",
    };
    expect(scenario(buildTests, "build-workspace-package").validate(result).passed).toBe(true);

    expect(
      scenario(buildTests, "build-workspace-package").validate(
        execution("The build report completed successfully.", [
          {
            code: "return services.build.getBuildReport('packages/example');",
            returnValue: { repoPath: "packages/example", status: "ok" },
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("ties workspace import evidence to the invocation that returned exports", () => {
    const result = execution("The package exports a ready function and its version.", [
      {
        code: "import * as unit from '@workspace/example'; return Object.keys(unit);",
        imports: { "@workspace/example": "workspace:*" },
        returnValue: ["ready", "version"],
      },
    ]);
    expect(scenario(buildTests, "import-built-package").validate(result).passed).toBe(true);
    expect(
      scenario(buildTests, "import-built-package").validate(
        execution("The package exports a ready function and its version.", [
          {
            code: "import * as unit from '@workspace-skills/workspace-dev'; return Object.keys(unit);",
            returnValue: ["ready", "version"],
          },
        ])
      ).passed
    ).toBe(true);
    expect(
      scenario(buildTests, "import-built-package").validate(
        execution("The package exports a ready function and its version.", [
          {
            code: "const unit = await import('@workspace-skills/workspace-dev'); return Object.keys(unit);",
            returnValue: ["ready", "version"],
          },
        ])
      ).passed
    ).toBe(true);
    expect(
      scenario(buildTests, "import-built-package").validate(
        execution("The package had useful exports.", [
          {
            code: "import * as unit from '@workspace/example'; return undefined;",
            imports: { "@workspace/example": "workspace:*" },
          },
          { code: "return ['unrelated'];", returnValue: ["unrelated"] },
        ])
      ).passed
    ).toBe(false);
  });
});

describe("workspace semantic validators", () => {
  it("accepts settings obtained directly from the resolved configuration", () => {
    expect(scenario(workspaceTests, "get-config").validate(execution(
      "The default repository is projects/default and the startup panel is about/new.",
      [{ code: "return workspace.getConfig();", returnValue: { defaultRepo: "projects/default", initPanels: [{ source: "about/new" }] } }]
    )).passed).toBe(true);
  });
  it("rejects arbitrary metadata masquerading as configuration", () => {
    expect(scenario(workspaceTests, "get-config").validate(execution(
      "It uses a local origin and main context.",
      [{ code: "return workspace.getInfo();", returnValue: { origin: "local", context: "main" } }]
    )).passed).toBe(false);
  });

  it("derives catalog, active identity, and configuration facts from completed results", () => {
    expect(
      scenario(workspaceTests, "list-workspace-units").validate(
        execution("The catalog contains the current panel and worker units.", [
          {
            code: "return build.listUnits();",
            returnValue: [{ id: "panel-1" }],
          },
        ])
      ).passed
    ).toBe(true);
    expect(
      scenario(workspaceTests, "get-active").validate(
        execution("The active workspace is the development workspace.", [
          { code: "return workspace.getActive();", returnValue: "development" },
        ])
      ).passed
    ).toBe(true);
    expect(
      scenario(workspaceTests, "get-config").validate(
        execution("The default repository is projects/default and the panel restore policy is focused.", [
          {
            code: "return workspace.getInfo();",
            returnValue: { config: { defaultRepo: "projects/default", panelRestorePolicy: "focused" } },
          },
        ])
      ).passed
    ).toBe(true);
  });

  it("rejects prose and empty structured results", () => {
    expect(
      scenario(workspaceTests, "get-config").validate(
        execution("It has a rich and valid configuration.", [
          { code: "return workspace.getInfo();", returnValue: {} },
        ])
      ).passed
    ).toBe(false);
  });
});

describe("multi-user semantic validators", () => {
  it("reports named online users without counting recently departed users", () => {
    const validator = scenario(multiUserTests, "workspace-presence");
    expect(
      validator.validate(
        execution("Alice, Bob", [
          {
            code: "return await services.workspacePresence.list();",
            returnValue: [
              {
                userId: "u1",
                handle: "alice",
                displayName: "Alice",
                online: true,
                lastSeen: 10,
                endpoints: 1,
              },
              {
                userId: "u2",
                handle: "bob",
                displayName: "Bob",
                online: true,
                lastSeen: 11,
                endpoints: 2,
              },
              { userId: "u3", handle: "carol", displayName: "Carol", online: false, lastSeen: 9 },
            ],
          },
        ])
      ).passed
    ).toBe(true);
  });

  it("accepts natural zero-presence answers for empty and all-offline results", () => {
    const validator = scenario(multiUserTests, "workspace-presence");
    const cases = [
      { rows: [], answer: "Nobody is here." },
      {
        rows: [{ userId: "u1", handle: "alice", displayName: "Alice", online: false, lastSeen: 9 }],
        answer: "No users online.",
      },
      { rows: [], answer: "0 users are currently present." },
      { rows: [], answer: "The presence list is []." },
    ];
    for (const { rows, answer } of cases) {
      expect(
        validator.validate(
          execution(answer, [
            { code: "return await services.workspacePresence.list();", returnValue: rows },
          ])
        ).passed
      ).toBe(true);
    }
  });

  it("rejects a named presence answer that omits an online user", () => {
    const validator = scenario(multiUserTests, "workspace-presence");
    expect(
      validator.validate(
        execution("Alice is here.", [
          {
            code: "return await services.workspacePresence.list();",
            returnValue: [
              { userId: "u1", handle: "alice", displayName: "Alice", online: true, lastSeen: 10 },
              { userId: "u2", handle: "bob", displayName: "Bob", online: true, lastSeen: 11 },
            ],
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("rejects malformed presence entries", () => {
    const validator = scenario(multiUserTests, "workspace-presence");
    expect(
      validator.validate(
        execution("Alice is currently online.", [
          {
            code: "return await services.workspacePresence.list();",
            returnValue: [{ userId: "u1", handle: "alice", displayName: "Alice", lastSeen: 10 }],
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("rejects channel roster evidence as workspace presence", () => {
    const validator = scenario(multiUserTests, "workspace-presence");
    expect(
      validator.validate(
        execution("Alice is currently present.", [
          {
            code: "return await services.gad.inspectChannelRoster();",
            returnValue: [{ participantId: "user-1", type: "user", name: "Alice" }],
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("accepts a live account profile whose durable identity is a handle", () => {
    const validator = scenario(multiUserTests, "account-whoami");
    expect(
      validator.validate(
        execution("This session is acting as root.", [
          {
            code: "return await services.account.getProfile();",
            returnValue: { handle: "root" },
          },
        ])
      ).passed
    ).toBe(true);
  });

  it("accepts the observed channel types without requiring a fictional human", () => {
    const validator = scenario(multiUserTests, "channel-roster-identity");
    expect(
      validator.validate(
        execution("There are 2 participants: one agent and one headless participant.", [
          {
            code: "return await services.gad.inspectChannelRoster();",
            returnValue: [
              { participantId: "agent-1", type: "agent" },
              { participantId: "runner-1", type: "headless" },
            ],
          },
        ])
      ).passed
    ).toBe(true);
  });

  it("rejects a roster summary that omits a returned participant type", () => {
    const validator = scenario(multiUserTests, "channel-roster-identity");
    expect(
      validator.validate(
        execution("There are 2 agent participants.", [
          {
            code: "return await chat.getParticipants();",
            returnValue: [
              { participantId: "agent-1", type: "agent" },
              { participantId: "runner-1", type: "headless" },
            ],
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("rejects treating a headless client as an agent", () => {
    const validator = scenario(multiUserTests, "channel-roster-identity");
    expect(
      validator.validate(
        execution("The agent and headless participants mean all participants are agents.", [
          {
            code: "return await chat.getParticipants();",
            returnValue: [
              {
                id: "agent-1",
                name: "AI Chat",
                type: "agent",
                isAgent: true,
                isPerson: false,
              },
              {
                id: "runner-1",
                name: "Headless Client",
                type: "headless",
                isAgent: false,
                isPerson: false,
              },
            ],
          },
        ])
      ).passed
    ).toBe(false);
  });
});

describe("eval lifecycle semantic validators", () => {
  it("requires invoking the same live scope method without reconstructing it", () => {
    const result = execution("The same live method remained callable after the idle boundary.", [
      {
        code: "scope.__kernelContinuityProbe = { ping: () => 'LIVE_KERNEL_OK' }; return { methodType: typeof scope.__kernelContinuityProbe.ping };",
        returnValue: { methodType: "function" },
        kernelIncarnationId: "kernel-1",
      },
      {
        code: "const probe = scope.__kernelContinuityProbe as any; return { methodType: typeof probe.ping, value: probe.ping() };",
        returnValue: { methodType: "function", value: "LIVE_KERNEL_OK" },
        kernelIncarnationId: "kernel-1",
      },
    ]);
    const validator = scenario(evalLifecycleTests, "eval-live-kernel-continuity");
    expect(validator.validate(result).passed).toBe(true);
    expect(
      validator.validate(
        execution("The unchanged method was invoked through Function.call.", [
          {
            code: "scope.__kernelContinuityProbe = { ping: () => 'LIVE_KERNEL_OK' }; return true;",
            returnValue: true,
            kernelIncarnationId: "kernel-1",
          },
          {
            code: "const probe = scope.__kernelContinuityProbe; const ping = probe.ping; return { methodType: typeof ping, value: ping.call(probe) };",
            returnValue: { methodType: "function", value: "LIVE_KERNEL_OK" },
            kernelIncarnationId: "kernel-1",
          },
        ])
      ).passed
    ).toBe(true);
    expect(
      validator.validate(
        execution("I recreated it.", [
          {
            code: "scope.__kernelContinuityProbe = { ping: () => 'LIVE_KERNEL_OK' }; return true;",
            returnValue: true,
            kernelIncarnationId: "kernel-1",
          },
          {
            code: "scope.__kernelContinuityProbe = { ping: () => 'LIVE_KERNEL_OK' }; return { methodType: 'function', value: scope.__kernelContinuityProbe.ping() };",
            returnValue: { methodType: "function", value: "LIVE_KERNEL_OK" },
            kernelIncarnationId: "kernel-1",
          },
        ])
      ).passed
    ).toBe(false);
    expect(
      validator.validate(
        execution("It was reconstructed.", [
          {
            code: "scope.__kernelContinuityProbe = { ping: () => 'LIVE_KERNEL_OK' }; return true;",
            returnValue: true,
            kernelIncarnationId: "kernel-1",
          },
          {
            code: "const probe = scope.__kernelContinuityProbe; return { methodType: typeof probe.ping, value: probe.ping() };",
            returnValue: { methodType: "function", value: "LIVE_KERNEL_OK" },
            kernelIncarnationId: "kernel-2",
          },
        ])
      ).passed
    ).toBe(false);
  });

  it("requires database writes and later reads in distinct completed evals", () => {
    const result = execution("The later query returned both rows from the earlier evaluation.", [
      {
        code: "db.run('CREATE TABLE rows (id INTEGER)'); db.run('INSERT INTO rows VALUES (1), (2)'); return { inserted: 2 };",
        returnValue: { inserted: 2 },
      },
      {
        code: "return db.exec('SELECT * FROM rows');",
        returnValue: [{ id: 1 }, { id: 2 }],
      },
    ]);
    expect(scenario(evalLifecycleTests, "eval-db-persistence").validate(result).passed).toBe(true);
    expect(
      scenario(evalLifecycleTests, "eval-db-persistence").validate(
        execution("The later query returned the one row from the earlier evaluation.", [
          {
            code: "db.run('CREATE TABLE rows (id INTEGER)'); db.run('INSERT INTO rows VALUES (1)'); return { inserted: 1 };",
            returnValue: { inserted: 1 },
          },
          {
            code: "return { rows: db.exec('SELECT * FROM rows') };",
            returnValue: { rows: [{ id: 1 }] },
          },
        ])
      ).passed
    ).toBe(true);
    expect(
      scenario(evalLifecycleTests, "eval-db-persistence").validate(
        execution("The row written through db.exec remained available later.", [
          {
            code: "db.exec('CREATE TABLE rows (id INTEGER)'); db.exec('INSERT INTO rows VALUES (1)'); return { inserted: 1 };",
            returnValue: { inserted: 1 },
          },
          {
            code: "return { rows: db.exec('SELECT * FROM rows') };",
            returnValue: { rows: [{ id: 1 }] },
          },
        ])
      ).passed
    ).toBe(true);
  });

  it("requires an actual reset boundary after a separate scope confirmation", () => {
    const result = execution("The value survived one evaluation, then was absent after reset.", [
      {
        code: "scope.probe = 'retained'; return scope.probe;",
        returnValue: "retained",
      },
      { code: "return scope.probe;", returnValue: "retained" },
      {
        code: "return { fresh: scope.probe === undefined };",
        reset: true,
        returnValue: { fresh: true },
      },
    ]);
    expect(scenario(evalLifecycleTests, "eval-scope-reset").validate(result).passed).toBe(true);
    expect(
      scenario(evalLifecycleTests, "eval-scope-reset").validate(
        execution("A clean baseline was established, then the later reset removed the value.", [
          {
            code: "scope.probe = 'retained'; return scope.probe;",
            reset: true,
            returnValue: "retained",
          },
          { code: "return scope.probe;", returnValue: "retained" },
          {
            code: "return { oldValue: scope.probe ?? null };",
            reset: true,
            returnValue: { oldValue: null },
          },
        ])
      ).passed
    ).toBe(true);
    expect(
      scenario(evalLifecycleTests, "eval-scope-reset").validate(
        execution("I reset it and the value was gone.", [
          { code: "return { fresh: true };", returnValue: { fresh: true } },
        ])
      ).passed
    ).toBe(false);
  });

  it("accepts one terminal cancellation and rejects cancellation prose alone", () => {
    const cancelled: TestExecutionResult = {
      duration: 0,
      messages: [],
      diagnostics: {
        evalCancellation: {
          runId: "run-1",
          cancel: { ok: true, forcedReset: false },
          terminal: { status: "cancelled" },
        },
      },
    };
    expect(scenario(evalLifecycleTests, "eval-cancel-run").validate(cancelled).passed).toBe(true);
    expect(
      scenario(evalLifecycleTests, "eval-cancel-run").validate(
        execution("The long run was cancelled.", [])
      ).passed
    ).toBe(false);
  });

  it("requires one original eval result after an observed live vessel abort", () => {
    const validator = scenario(evalLifecycleTests, "eval-agent-replay");
    const recovered = execution("The durable eval returned once.", [
      {
        code: 'return { marker: "EVAL_AGENT_REPLAY_OK", completionCount: 1 };',
        returnValue: { marker: "EVAL_AGENT_REPLAY_OK", completionCount: 1 },
      },
    ]);
    recovered.diagnostics = {
      evalAgentReplay: {
        targetId: "do:workers/agent-worker:AiChatWorker:agent-1",
        invocationId: "eval-0",
        statusBeforeAbort: "running",
        aborted: true,
      },
    };
    expect(validator.validate(recovered).passed).toBe(true);

    const duplicate = execution("It ran twice.", [
      {
        code: 'return { marker: "EVAL_AGENT_REPLAY_OK", completionCount: 1 };',
        returnValue: { marker: "EVAL_AGENT_REPLAY_OK", completionCount: 1 },
      },
      {
        code: 'return { marker: "EVAL_AGENT_REPLAY_OK", completionCount: 2 };',
        returnValue: { marker: "EVAL_AGENT_REPLAY_OK", completionCount: 2 },
      },
    ]);
    duplicate.diagnostics = recovered.diagnostics;
    expect(validator.validate(duplicate).passed).toBe(false);
  });
});

describe("extension semantic validators", () => {
  it("accepts canonical extension identities and readiness in a projected catalog", () => {
    expect(scenario(extensionSurfaceTests, "extension-list").validate(execution(
      "Typecheck Service is registered and ready.", [{
        code: "return (await build.listUnits()).filter(x => x.kind === 'extension').map(({name,status}) => ({name,status}));",
        returnValue: [{ name: "@workspace-extensions/typecheck-service", status: "ready" }]
      }]
    )).passed).toBe(true);
  });

  it("rejects source names without registered readiness", () => {
    expect(scenario(extensionSurfaceTests, "extension-list").validate(execution(
      "Two extensions are ready.", [{ code: "return build.listUnits();", returnValue: [{ name: "typecheck" }] }]
    )).passed).toBe(false);
  });

  it("requires registry rows for extension discovery", () => {
    const result = execution("Two workspace extensions are currently available.", [
      {
        code: "return (await build.listUnits()).filter((unit) => unit.kind === 'extension');",
        returnValue: [{ name: "@workspace-extensions/typecheck-service", kind: "extension", status: "ready" }, { name: "@workspace-extensions/test-runner", kind: "extension", status: "ready" }],
      },
    ]);
    expect(scenario(extensionSurfaceTests, "extension-list").validate(result).passed).toBe(true);
  });

  it("requires diagnostics returned by the typecheck extension", () => {
    const result = execution("The selected unit type-checks without diagnostics.", [
      {
        code: 'return services.extensions.invoke("@workspace-extensions/typecheck-service", "checkPanel", ["panels/app"]);',
        operationJournal: typecheckJournal(),
        returnValue: { diagnostics: [], success: true },
      },
    ]);
    expect(
      scenario(extensionSurfaceTests, "extension-typecheck-unit").validate(result).passed
    ).toBe(true);
  });

  it("accepts an explicit compact diagnostic summary from the installed typecheck service", () => {
    const result = execution("The typecheck reported 26 errors and no warnings.", [
      {
        code: 'const result = await services.extensions.invoke("@workspace-extensions/typecheck-service", "checkPanel", ["packages/about-shared"]); return { errorCount: result.errorCount, warningCount: result.warningCount };',
        operationJournal: typecheckJournal(),
        returnValue: { errorCount: 26, warningCount: 0 },
      },
    ]);
    expect(scenario(extensionSurfaceTests, "extension-typecheck-unit").validate(result).passed).toBe(true);
  });

  it("accepts an aliased invocation when its native receipt proves the exact typecheck call", () => {
    const result = execution("The typecheck reported 26 errors and no warnings.", [
      {
        code: 'const extensionClient = services.extensions; const check = extensionClient.invoke; return check("@workspace-extensions/typecheck-service", "checkPanel", ["packages/about-shared"]);',
        operationJournal: typecheckJournal(),
        returnValue: { errorCount: 26, warningCount: 0 },
      },
    ]);
    expect(scenario(extensionSurfaceTests, "extension-typecheck-unit").validate(result).passed).toBe(true);
  });

  it("rejects negative and fractional diagnostic counts", () => {
    for (const returnValue of [
      { errorCount: -1, warningCount: 0 },
      { errorCount: 1.5, warningCount: 0 },
    ]) {
      const result = execution("The typecheck reported diagnostics.", [
        {
          code: 'return services.extensions.invoke("@workspace-extensions/typecheck-service", "checkPanel", ["packages/about-shared"]);',
          operationJournal: typecheckJournal(),
          returnValue,
        },
      ]);
      expect(scenario(extensionSurfaceTests, "extension-typecheck-unit").validate(result).passed).toBe(false);
    }
  });

  it("accepts the official large-return envelope when the answer summarizes diagnostics", () => {
    const result = execution("The typecheck reported 26 errors and no warnings.", [
      {
        code: 'const result = await services.extensions.invoke("@workspace-extensions/typecheck-service", "checkPanel", ["packages/about-shared"]); return result;',
        operationJournal: typecheckJournal(),
        returnValue: {
          truncated: true,
          reason: "eval return value exceeded result transport/storage limit",
          originalChars: 20592,
          limitChars: 12000,
          measuredAs: "json-indent-2",
          scopeKey: "$lastLargeReturn",
          scopeValueType: "string",
          preview: "{ ...",
        },
      },
    ]);
    expect(scenario(extensionSurfaceTests, "extension-typecheck-unit").validate(result).passed).toBe(true);
  });

  it("rejects summaries and truncation without exact native typecheck evidence", () => {
    const code = 'return services.extensions.invoke("@workspace-extensions/typecheck-service", "checkPanel", ["panels/app"]);';
    const value = { errorCount: 26, warningCount: 0 };
    for (const [journal, returnValue] of [
      [undefined, value],
      [typecheckJournal("@workspace-extensions/other-service"), value],
      [typecheckJournal("@workspace-extensions/typecheck-service", "listUnits"), value],
      [typecheckJournal(), {
        truncated: true,
        reason: "eval return value exceeded result transport/storage limit",
        scopeKey: "$lastLargeReturn",
        scopeValueType: "string",
        originalChars: 20592,
        limitChars: 0,
        measuredAs: "json-indent-2",
        preview: "partial output",
      }],
      [typecheckJournal(), {
        truncated: true,
        reason: "eval return value exceeded result transport/storage limit",
        scopeKey: "$lastLargeReturn",
        scopeValueType: "string",
        originalChars: 12000,
        limitChars: 12000,
        measuredAs: "json-indent-2",
        preview: "partial output",
      }],
    ] as const) {
      const result = execution("The typecheck reported 26 errors and no warnings.", [
        { code, ...(journal ? { operationJournal: journal } : {}), returnValue },
      ]);
      expect(scenario(extensionSurfaceTests, "extension-typecheck-unit").validate(result).passed).toBe(false);
    }
  });

  it("rejects a failed typecheck invocation even when its return value resembles diagnostics", () => {
    const result = execution("The typecheck reported 26 errors.", [
      {
        code: 'return services.extensions.invoke("@workspace-extensions/typecheck-service", "checkPanel", ["panels/app"]);',
        operationJournal: typecheckJournal(),
        returnValue: { errorCount: 26 },
        status: "error",
      },
    ]);
    expect(scenario(extensionSurfaceTests, "extension-typecheck-unit").validate(result).passed).toBe(false);
  });

  it("rejects a candidate build receipt as evidence of an installed typecheck-service invocation", () => {
    const result = directExecution("The extension builds with no diagnostics.", [
      {
        name: "verify",
        arguments: { operation: "build", target: "extensions/typecheck-service" },
        result: {
          details: {
            diagnostics: [],
            receipt: {
              protocol: "unit-verification-receipt.v1",
              operation: "build",
              target: "extensions/typecheck-service",
              status: "ok",
            },
          },
        },
      },
    ]);
    expect(
      scenario(extensionSurfaceTests, "extension-typecheck-unit").validate(result).passed
    ).toBe(false);
  });

  it("joins registry discovery and a successful structured invocation", () => {
    const result = execution("The read-only method returned a structured status record.", [
      {
        code: "const entries = (await build.listUnits()).filter((unit) => unit.kind === 'extension'); return { entries, value: await services.extensions.invoke(entries[0].name, \"status\", []) };",
        operationJournal: extensionJournal("invoke", { kind: "object", keyCount: 1 }),
        returnValue: {
          entries: [{ name: "probe" }],
          value: { status: "ready" },
        },
      },
    ]);
    expect(
      scenario(extensionSurfaceTests, "extension-invoke-roundtrip").validate(result).passed
    ).toBe(true);
  });
});

describe("scenario prompts", () => {
  it("retains structured RPC diagnostics from harness-orchestrated eval probes", async () => {
    const test = scenario(evalLifecycleTests, "eval-events");
    const error = Object.assign(new Error("Event page probe failed"), {
      name: "RemoteRpcError",
      code: "EventPageUnavailable",
      errorData: {
        code: "EventPageUnavailable",
        diagnosticHandle: "diag:eval-events",
        sessionToken: "must-not-leak",
      },
    });

    const result = await test.orchestrate!({
      runner: {
        probeEvalEventPages: async () => {
          throw error;
        },
      } as never,
      signal: new AbortController().signal,
      remainingTimeMs: () => 10_000,
      sendAndWait: async () => {
        throw new Error("Agent turn must not be used");
      },
    });

    expect(result.failure).toEqual({
      phase: "eval-event-pages",
      error: {
        name: "RemoteRpcError",
        message: "Event page probe failed",
        code: "EventPageUnavailable",
        errorData: {
          code: "EventPageUnavailable",
          diagnosticHandle: "diag:eval-events",
          sessionToken: "[redacted]",
        },
        diagnosticHandles: ["diag:eval-events"],
      },
    });
  });

  it("use vague user goals without marker protocols or answer templates", () => {
    const tests = [
      ...buildTests,
      ...filesystemTests,
      ...workspaceTests,
      ...evalLifecycleTests,
      ...extensionSurfaceTests,
      ...workerTests,
    ];
    for (const test of tests) {
      expect(test.prompt).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/u);
      expect(test.prompt).not.toMatch(/finish with|respond with|report .*:\s*</iu);
    }
  });
});

describe("absent recipient messaging", () => {
  it("reads a canonical refusal message and rejects substitution with a reachable audience", () => {
    const validator = scenario(messagingTests, "unreachable-addressee-fails-closed");
    const result = execution(
      "The archivist is unavailable; @headless is here. The note remains unsent.",
      []
    );
    const failed = {
      id: "notify:absent",
      name: "notify",
      arguments: { to: ["@archivist"] },
      execution: {
        status: "error",
        terminalOutcome: "tool_error",
        isError: true,
        result: {
          message:
            'no participant "@archivist" on this channel. Use list_addressees to see who is here.',
        },
      },
    };
    result.messages.push({
      id: "notify:absent",
      senderId: "agent",
      senderMetadata: { type: "agent" },
      complete: true,
      contentType: "invocation",
      kind: "message",
      content: JSON.stringify(failed),
    } as (typeof result.messages)[number]);
    expect(validator.validate(result).passed).toBe(true);
    result.messages.push({
      id: "notify:other",
      senderId: "agent",
      senderMetadata: { type: "agent" },
      complete: true,
      contentType: "invocation",
      kind: "message",
      content: JSON.stringify({
        ...failed,
        id: "notify:other",
        arguments: { to: ["@headless"] },
        execution: {
          status: "complete",
          terminalOutcome: "success",
          isError: false,
        },
      }),
    } as (typeof result.messages)[number]);
    expect(validator.validate(result).passed).toBe(false);
  });
});

describe("extension transport invocation", () => {
  const test = scenario(extensionSurfaceTests, "extension-invoke-roundtrip");

  it.each([
    ["invoke", {}, { kind: "object", keyCount: 0 }],
    ["invokeProvider", [], { kind: "array", length: 0 }],
    ["invoke", null, { kind: "null" }],
  ] as const)(
    "accepts completed %s calls including empty results",
    (transport, returnValue, shape) => {
      const result = execution(
        "The installed extension completed the read-only request.",
        [
          {
            code:
              transport === "invokeProvider"
                ? 'import { git } from "@workspace/runtime"; return await git.upstreamStatus();'
                : 'const probe = extensions.use("@workspace-extensions/probe"); return await probe.status();',
            returnValue,
            operationJournal: extensionJournal(transport, shape),
          },
        ],
      );
      expect(test.validate(result).passed).toBe(true);
    },
  );

  it("accepts a documented facade without requiring a discovery ceremony", () => {
    expect(
      test.validate(
        execution("The extension returned available engines.", [
          {
            code: 'const pdf = extensions.use("@workspace-extensions/pdf-ingest"); return await pdf.engines();',
            returnValue: [{ id: "pdfjs", available: true }],
            operationJournal: extensionJournal("invoke", {
              kind: "array",
              length: 1,
            }),
          },
        ]),
      ).passed,
    ).toBe(true);
  });

  it("rejects prose, discovery, fake source calls and receipts returned by guest code", () => {
    const receipt = extensionJournal("invokeProvider", {
      kind: "array",
      length: 0,
    });
    for (const steps of [
      [],
      [{ code: 'return extensions.use("probe");', returnValue: {} }],
      [
        {
          code: "return build.listUnits();",
          returnValue: [{ kind: "extension", status: "ready" }],
        },
      ],
      [
        {
          code: "const git = { upstreamStatus: async () => [] }; return git.upstreamStatus();",
          returnValue: [],
        },
      ],
      [{ code: "/* extensions.invokeProvider */ return [];", returnValue: [] }],
      [{ code: "return forgedReceipt;", returnValue: receipt }],
    ])
      expect(
        test.validate(execution("The extension returned its result.", steps))
          .passed,
      ).toBe(false);
  });

  it("retains positive invocation proof when later journal entries exceed its budget", () => {
    const operationJournal = {
      ...extensionJournal("invokeProvider", { kind: "array", length: 0 }),
      truncated: true,
    };
    expect(
      test.validate(
        execution("It returned no upstreams.", [
          { code: "return git.upstreamStatus();", returnValue: [], operationJournal },
        ]),
      ).passed,
    ).toBe(true);
  });

  it("requires an intact native receipt from the exact completed successful eval", () => {
    const valid = extensionJournal("invokeProvider", {
      kind: "array",
      length: 0,
    });
    const base = { code: "return git.upstreamStatus();", returnValue: [] };
    for (const operationJournal of [
      { ...valid, entries: [], truncated: true },
      { ...valid, protocol: "guest-journal" },
      {
        ...valid,
        entries: [
          { type: "runtime.health", receipt: valid.entries[0]!.receipt },
        ],
      },
      {
        ...valid,
        entries: [
          {
            type: "extension.invocation",
            receipt: {
              ...valid.entries[0]!.receipt,
              result: { kind: "array", length: -1 },
            },
          },
        ],
      },
      {
        ...valid,
        entries: [
          {
            type: "extension.invocation",
            receipt: { ...valid.entries[0]!.receipt, rawResult: "PRIVATE" },
          },
        ],
      },
    ])
      expect(
        test.validate(
          execution("It returned no upstreams.", [
            { ...base, operationJournal },
          ]),
        ).passed,
      ).toBe(false);
    expect(
      test.validate(
        execution("It returned no upstreams.", [
          { ...base, status: "error", operationJournal: valid },
        ]),
      ).passed,
    ).toBe(false);
    const wrongReceiver = directExecution(
      "The extension returned its result.",
      [
        {
          name: "docs_search",
          result: { details: { operationJournal: valid } },
        },
      ],
    );
    expect(test.validate(wrongReceiver).passed).toBe(false);
  });
});

describe("notebook and scratch lifetime regressions", () => {
  const importSteps: EvalStep[] = [
    {
      code: "import { basename as notebookBasename } from 'node:path'; scope.__cellImportProbe = notebookBasename; return { bindingType: typeof notebookBasename, value: notebookBasename('/first/first.txt') };",
      kernelIncarnationId: "kernel-live",
      returnValue: { bindingType: "function", value: "first.txt" },
    },
    {
      code: "return { bindingType: typeof notebookBasename, retainedType: typeof scope.__cellImportProbe, value: scope.__cellImportProbe('/second/second.txt') };",
      kernelIncarnationId: "kernel-live",
      returnValue: {
        bindingType: "undefined",
        retainedType: "function",
        value: "second.txt",
      },
    },
    {
      code: "import { basename as notebookBasename } from 'node:path'; return { bindingType: typeof notebookBasename, value: notebookBasename('/third/third.txt') };",
      kernelIncarnationId: "kernel-live",
      returnValue: { bindingType: "function", value: "third.txt" },
    },
  ];
  it("requires captured import lifetime, explicit retention, and the same native kernel", () => {
    const test = scenario(
      evalLifecycleTests,
      "eval-cell-local-imports-retained-handle",
    );
    expect(
      test.validate(execution("Observed the three cells.", importSteps)).passed,
    ).toBe(true);
    expect(test.validate(execution("It worked.", [])).passed).toBe(false);
    for (const changed of [
      { ...importSteps[1]!, kernelIncarnationId: "replacement-kernel" },
      { ...importSteps[1]!, kernelIncarnationId: undefined },
      {
        ...importSteps[1]!,
        returnValue: {
          bindingType: "function",
          retainedType: "function",
          value: "second.txt",
        },
      },
      {
        ...importSteps[1]!,
        code: "scope.__cellImportProbe = () => 'second.txt'; return scope.__cellImportProbe();",
      },
    ])
      expect(
        test.validate(
          execution("Claimed success.", [
            importSteps[0]!,
            changed,
            importSteps[2]!,
          ]),
        ).passed,
      ).toBe(false);
  });
  const rejectedSteps: EvalStep[] = [
    {
      code: "scope.__rejectedCellProbe = { count: 0, next() { return ++this.count; } }; return { methodType: typeof scope.__rejectedCellProbe.next, count: scope.__rejectedCellProbe.next() };",
      kernelIncarnationId: "kernel-live",
      returnValue: { methodType: "function", count: 1 },
    },
    {
      code: "throw new Error('LIVE_SCOPE_DELIBERATE_FAILURE');",
      status: "error",
      result: {
        error: "LIVE_SCOPE_DELIBERATE_FAILURE",
        details: {
          kernel: { incarnationId: "kernel-live" },
          failureCode: "guest_execution_failed",
          failureKind: "user-code",
        },
      },
    },
    {
      code: "return { methodType: typeof scope.__rejectedCellProbe.next, count: scope.__rejectedCellProbe.next() };",
      kernelIncarnationId: "kernel-live",
      returnValue: { methodType: "function", count: 2 },
    },
  ];
  it("requires original state after exactly one deliberate failed cell", () => {
    const test = scenario(
      evalLifecycleTests,
      "eval-rejected-cell-preserves-live-scope",
    );
    expect(
      test.validate(
        execution("Recovered the original callable.", rejectedSteps),
      ).passed,
    ).toBe(true);
    for (const changed of [
      { ...rejectedSteps[2]!, kernelIncarnationId: "replacement-kernel" },
      {
        ...rejectedSteps[2]!,
        returnValue: { methodType: "function", count: 1 },
      },
      {
        ...rejectedSteps[2]!,
        code: "scope.__rejectedCellProbe = { count: 1, next() { return ++this.count; } }; return { count: 2 };",
      },
    ])
      expect(
        test.validate(
          execution("Claimed recovery.", [
            rejectedSteps[0]!,
            rejectedSteps[1]!,
            changed,
          ]),
        ).passed,
      ).toBe(false);
    expect(
      test.validate(
        execution("Wrong error.", [
          rejectedSteps[0]!,
          { ...rejectedSteps[1]!, result: { error: "unrelated fault" } },
          rejectedSteps[2]!,
        ]),
      ).passed,
    ).toBe(false);
  });
  it("requires the updated content through both the retained descriptor and renamed path", () => {
    const test = scenario(
      filesystemTests,
      "scratch-file-handle-survives-rename",
    );
    const step = {
      code: "const handle = await fs.open('.tmp/old', 'r'); try { await fs.rename('.tmp/old', '.tmp/new'); await fs.writeFile('.tmp/new', 'AFTER!'); const data = await handle.read(new Uint8Array(6), 0, 6, 0); const path = await fs.readFile('.tmp/new', 'utf8'); } finally { await handle.close(); }",
      returnValue: {
        throughHandle: "AFTER!",
        throughPath: "AFTER!",
        oldPathExists: false,
        closed: true,
      },
    };
    expect(test.validate(execution("Read both paths.", [step])).passed).toBe(
      true,
    );
    expect(
      test.validate(
        execution("Claimed success.", [
          {
            ...step,
            code: "return { throughHandle: 'AFTER!', throughPath: 'AFTER!', oldPathExists: false, closed: true };",
          },
        ]),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution("Stale handle.", [
          {
            ...step,
            returnValue: { ...step.returnValue, throughHandle: "BEFORE" },
          },
        ]),
      ).passed,
    ).toBe(false);
  });
});
