import {
  CONTENT_WORKSPACE_REPO_FIXTURE,
  type TestCase,
  type TestExecutionResult,
} from "../types.js";
import {
  completedScenarioEvidence,
  requireCodeOperations,
  walkArrays,
  walkRecords,
} from "./_scenario-evidence.js";
import {
  failedToolCalls,
  getToolCalls,
  incompleteToolCalls,
  type InvocationCardPayloadLike,
} from "./_helpers.js";

const FOCUSED_FS_TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  write: ["fs.writeFile"],
  read: ["fs.readFile"],
  ls: ["fs.readdir"],
  move_file: ["fs.rename"],
  copy_file: ["fs.copyFile"],
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function focusedFsOperations(call: InvocationCardPayloadLike): readonly string[] {
  const operations = FOCUSED_FS_TOOL_OPERATIONS[call.name] ?? [];
  if (!["write", "move_file", "copy_file"].includes(call.name)) return operations;
  const details = record(record(call.execution?.result)?.["details"]);
  return details?.["storage"] === "scratch" ? operations : [];
}

function strings(values: readonly unknown[]): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") found.push(value);
    else if (value && typeof value === "object") {
      for (const child of Object.values(value)) visit(child);
    }
  };
  for (const value of values) visit(value);
  return found;
}

function duplicateNonEmptyString(values: readonly unknown[]): boolean {
  const seen = new Set<string>();
  return strings(values).some((value) => {
    if (!value) return false;
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
}

function structuredInvocationEvidence(values: readonly unknown[]): unknown[] {
  const evidence = [...values];
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          evidence.push(JSON.parse(trimmed));
        } catch {
          // Tool output is often ordinary text. Only valid JSON adds structured evidence.
        }
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const child of Object.values(value)) visit(child);
  };
  for (const value of values) visit(value);
  return evidence;
}

function checkedFs(
  result: TestExecutionResult,
  operations: readonly (readonly string[])[],
  prove: (values: readonly unknown[]) => boolean,
  reason: string,
  options: { allowFocusedTools?: boolean } = {}
) {
  const base = completedScenarioEvidence(result, []);
  if (!base.passed) return base;
  const successfulCalls = base.evidence.calls.filter(
    (call) => call.execution?.status === "complete" && call.execution.isError !== true
  );
  const focusedOperations = new Set(
    options.allowFocusedTools ? successfulCalls.flatMap(focusedFsOperations) : []
  );
  const exercised = operations.some((alternative) =>
    alternative.every(
      (operation) =>
        focusedOperations.has(operation) ||
        requireCodeOperations(base.evidence.evalCode, [[operation]]).passed
    )
  );
  if (!exercised) {
    return requireCodeOperations(base.evidence.evalCode, operations);
  }
  const focusedCalls = options.allowFocusedTools
    ? successfulCalls.filter((call) => focusedFsOperations(call).length > 0)
    : [];
  const operationNames = new Set(operations.flat());
  const evalCalls = successfulCalls.filter(
    (call) =>
      call.name === "eval" &&
      typeof call.arguments?.["code"] === "string" &&
      [...operationNames].some(
        (operation) =>
          requireCodeOperations(call.arguments!["code"] as string, [[operation]]).passed
      )
  );
  // Discovery output is not outcome evidence for a different operation. Keep
  // returned/console data attached to the completed filesystem calls that ran.
  const values = structuredInvocationEvidence([
    ...focusedCalls.flatMap((call) => [call.arguments, call.execution?.result]),
    ...evalCalls.map((call) => call.execution?.result),
  ]);
  return prove(values) ? { passed: true, reason: undefined } : { passed: false, reason };
}

function appendLogEvidence(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, []);
  if (!base.passed) return base;
  const calls = base.evidence.calls;
  for (let index = 0; index < calls.length; index++) {
    const edit = calls[index]!;
    const args = edit.arguments;
    const details = record(record(edit.execution?.result)?.["details"]);
    if (
      edit.name !== "edit" ||
      details?.["protocol"] !== "file-mutation.v1" ||
      details["storage"] !== "scratch" ||
      details["status"] !== "applied" ||
      typeof args?.["path"] !== "string" ||
      typeof args["oldText"] !== "string" ||
      typeof args["newText"] !== "string"
    )
      continue;
    const oldText = args["oldText"];
    const newText = args["newText"];
    if (
      !oldText.includes("First observation.") ||
      oldText.includes("Second observation.") ||
      !newText.startsWith(oldText) ||
      !newText.slice(oldText.length).includes("Second observation.")
    )
      continue;
    const initialized = calls.slice(0, index).some((call) => {
      const receipt = record(record(call.execution?.result)?.["details"]);
      return (
        call.name === "write" &&
        call.arguments?.["path"] === args["path"] &&
        call.arguments?.["content"] === oldText &&
        receipt?.["protocol"] === "file-mutation.v1" &&
        receipt["storage"] === "scratch" &&
        receipt["status"] === "applied"
      );
    });
    const verified = calls
      .slice(index + 1)
      .some(
        (call) =>
          call.name === "read" &&
          call.arguments?.["path"] === args["path"] &&
          strings([record(call.execution?.result)?.["protocolContent"]]).includes(newText)
      );
    if (initialized && verified) return { passed: true, reason: undefined };
  }
  return checkedFs(
    result,
    [
      ["fs.appendFile", "fs.readFile"],
      ["fs.open", '\"a\"'],
      ["fs.open", '\"a+\"'],
      ["fs.open", "fs.constants.O_APPEND"],
    ],
    (values) =>
      strings(values).some((value) => {
        const first = value.indexOf("First observation.");
        return first >= 0 && value.indexOf("Second observation.") > first;
      }),
    "The completed append probe did not return both pieces of content",
    { allowFocusedTools: true }
  );
}

const BINARY_ROUND_TRIP_BASE64 = "AP8B/g==";

function focusedBinaryRoundTrip(result: TestExecutionResult) {
  const calls = getToolCalls(result);
  const patch = calls.find((call) => {
    if (
      call.name !== "apply_patch" ||
      call.execution?.status !== "complete" ||
      call.execution.isError === true
    ) {
      return false;
    }
    const operations = call.arguments?.["operations"];
    return (
      Array.isArray(operations) &&
      operations.some(
        (operation) =>
          operation &&
          typeof operation === "object" &&
          !Array.isArray(operation) &&
          (operation as Record<string, unknown>)["kind"] === "write_binary" &&
          (operation as Record<string, unknown>)["base64"] === BINARY_ROUND_TRIP_BASE64 &&
          typeof (operation as Record<string, unknown>)["path"] === "string" &&
          String((operation as Record<string, unknown>)["path"]).endsWith("/asset.bin")
      )
    );
  });
  const binaryPath = Array.isArray(patch?.arguments?.["operations"])
    ? patch.arguments["operations"]
        .map((operation) =>
          operation && typeof operation === "object" && !Array.isArray(operation)
            ? (operation as Record<string, unknown>)
            : null
        )
        .find((operation) => operation?.["kind"] === "write_binary")?.["path"]
    : undefined;
  const read = calls.find(
    (call) => {
      const args = call.arguments;
      if (
        call.name !== "read_binary" ||
        call.execution?.status !== "complete" ||
        call.execution.isError === true ||
        !args ||
        args["path"] !== binaryPath
      ) {
        return false;
      }
      const offset = args["offset"];
      const limit = args["limit"];
      return (
        (offset === undefined || offset === 0) &&
        (limit === undefined ||
          (typeof limit === "number" &&
            Number.isSafeInteger(limit) &&
            limit >= 4))
      );
    }
  );
  const evidence = JSON.stringify(read?.execution?.result ?? null);
  const exactRead =
    evidence.includes(BINARY_ROUND_TRIP_BASE64) &&
    /"(?:range|byteRange)":\{"start":0,"end":4,"totalBytes":4/u.test(evidence);
  if (!patch || typeof binaryPath !== "string" || !read || !exactRead) {
    return {
      passed: false,
      reason:
        "Focused binary write/read calls did not preserve the exact four bytes and bounded range",
    };
  }
  const failed = failedToolCalls(result);
  if (failed.length > 0) {
    return {
      passed: false,
      reason: `Expected no failed tools, got ${failed.map((call) => call.name).join(", ")}`,
    };
  }
  const incomplete = incompleteToolCalls(result);
  return incomplete.length === 0
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason: `Expected no incomplete tools, got ${incomplete.map((call) => call.name).join(", ")}`,
      };
}

export const filesystemTests: TestCase[] = [
  {
    name: "scratch-file-handle-survives-rename",
    description:
      "An open scratch file descriptor keeps reading the same file after rename and an update through its new path",
    category: "filesystem",
    validation: "harness",
    prompt:
      "Inspect the live fs help, then check the documented portable scratch-file handle across rename: create a temporary file containing BEFORE, open a handle, rename the file, overwrite the renamed path with AFTER!, then read the updated bytes through both the original open handle and the new path. Return { throughHandle, throughPath, oldPathExists, closed: true } from eval with the actual observed values. Close the handle and remove your temporary files in finally, including on failure. Use scratch storage, not workspace source files.",
    validate: (result) => {
      const code = getToolCalls(result)
        .filter(
          (call) =>
            call.name === "eval" &&
            call.execution?.status === "complete" &&
            call.execution.isError !== true,
        )
        .map((call) => String(call.arguments?.["code"] ?? ""))
        .join("\n");
      if (
        !/\.read\s*\(/u.test(code) ||
        !/\.close\s*\(/u.test(code) ||
        !/\bfinally\b/u.test(code)
      )
        return {
          passed: false,
          reason:
            "The execution did not read its retained handle and explicitly close it in finally",
        };
      return checkedFs(
        result,
        [["fs.open", "fs.rename", "fs.writeFile", "fs.readFile"]],
        (values) =>
          walkRecords(values).some(
            (value) =>
              value["throughHandle"] === "AFTER!" &&
              value["throughPath"] === "AFTER!" &&
              value["oldPathExists"] === false &&
              value["closed"] === true,
          ),
        "The completed execution did not prove descriptor continuity, the renamed path, and explicit close",
      );
    },
  },
  {
    name: "read-write-text",
    description: "Write and read a text file",
    category: "filesystem",
    prompt: "Round-trip some text through a temporary file and tell me what you verified.",
    validate: (result) =>
      checkedFs(
        result,
        [["fs.writeFile", "fs.readFile"]],
        duplicateNonEmptyString,
        "The completed file operations did not return matching written and read text",
        { allowFocusedTools: true }
      ),
  },
  {
    name: "read-write-binary",
    description: "Write arbitrary bytes atomically and read them back through bounded base64",
    category: "filesystem",
    workspaceRepoFixture: CONTENT_WORKSPACE_REPO_FIXTURE,
    prompt:
      "In the disposable project, add asset.bin containing exactly the four bytes 00 ff 01 fe. Read it back losslessly through a bounded file read and explain what survived. Do not publish it.",
    validation: "harness",
    validate: focusedBinaryRoundTrip,
  },
  {
    name: "append-file",
    description: "Append content to a file and verify all content is present",
    category: "filesystem",
    prompt:
      "Keep two entries in a temporary scratch log: ‘First observation.’ and ‘Second observation.’. Add the second by appending, then verify both entries remain in order.",
    validate: appendLogEvidence,
  },
  {
    name: "directory-ops",
    description: "Create nested directories and list contents",
    category: "filesystem",
    prompt:
      "Create a temporary nested directory with one.txt at the top and two.txt in a child directory. Inspect what is inside.",
    validate: (result) =>
      checkedFs(
        result,
        [["fs.writeFile", "fs.readdir"]],
        (values) => {
          const names = walkArrays(values).flatMap((entries) =>
            entries.flatMap((entry) => {
              const name = typeof entry === "string" ? entry : record(entry)?.["name"];
              return typeof name === "string" ? [name.split("/").at(-1)] : [];
            })
          );
          return names.includes("one.txt") && names.includes("two.txt");
        },
        "The completed directory inspection did not expose both requested files",
        { allowFocusedTools: true }
      ),
  },
  {
    name: "file-stats",
    description: "Get file statistics including size and modification time",
    category: "filesystem",
    prompt:
      "Create a temporary file containing ‘hello’. Inspect its size and modification time, and verify that the byte size agrees with that content.",
    validate: (result) =>
      checkedFs(
        result,
        [["fs.writeFile", "fs.stat"]],
        (values) =>
          walkRecords(values).some((record) => {
            const size = record["size"] ?? record["metadataSize"];
            const modified = record["mtimeMs"] ?? record["mtime"] ?? record["modifiedAt"];
            return (
              size === 5 &&
              ((typeof modified === "number" && Number.isFinite(modified) && modified > 0) ||
                (typeof modified === "string" && Number.isFinite(Date.parse(modified))))
            );
          }),
        "The completed stat probe did not expose the requested five-byte size and a valid modification time",
        { allowFocusedTools: true }
      ),
  },
  {
    name: "rename-copy",
    description: "Copy or rename a file and verify the result",
    category: "filesystem",
    prompt: "Copy or relocate a temporary file and verify its content at the destination.",
    validate: (result) =>
      checkedFs(
        result,
        [
          ["fs.rename", "fs.readFile"],
          ["fs.copyFile", "fs.readFile"],
        ],
        duplicateNonEmptyString,
        "The completed transfer probe did not return matching source and destination content",
        { allowFocusedTools: true }
      ),
  },
  {
    name: "remove",
    description: "Create and recursively remove a directory",
    category: "filesystem",
    prompt: "Create a temporary directory tree, remove it, and verify that it is gone.",
    validate: (result) =>
      checkedFs(
        result,
        [["fs.mkdir", "fs.rm"]],
        (values) =>
          walkRecords(values).some(
            (record) =>
              record["absent"] === true ||
              record["exists"] === false ||
              record["removed"] === true ||
              record["cleaned"] === true ||
              record["gone"] === true ||
              Object.entries(record).some(
                ([key, value]) => /exists.*after|after.*exists/iu.test(key) && value === false
              )
          ),
        "The completed removal probe did not prove the directory is absent"
      ),
  },
  {
    name: "symlinks",
    description: "Probe symbolic-link inspection and creation support",
    category: "filesystem",
    prompt:
      "Check how temporary symbolic links behave here and report the observed support honestly.",
    validate: (result) =>
      checkedFs(
        result,
        [
          ["fs.symlink", "fs.lstat"],
          ["fs.symlink", "fs.readlink"],
        ],
        (values) =>
          walkRecords(values).some(
            (record) =>
              record["supported"] === true ||
              record["symlinkCreated"] === true ||
              record["isSym"] === true ||
              record["isSymbolicLink"] === true ||
              (record["linkStat"] === true && typeof record["readlink"] === "string") ||
              (typeof record["mode"] === "number" && (record["mode"] & 0xf000) === 0xa000) ||
              (typeof record["linkPath"] === "string" &&
                typeof record["readlink"] === "string" &&
                typeof record["realpath"] === "string") ||
              (record["supported"] === false && typeof record["reason"] === "string")
          ),
        "The completed symlink probe exposed neither verified support nor a concrete limitation"
      ),
  },
  {
    name: "file-handles",
    description: "Use low-level file handles to write and read",
    category: "filesystem",
    prompt:
      "Check whether a temporary file remains available after its handle is closed, and tell me what happened.",
    validate: (result) =>
      checkedFs(
        result,
        [["fs.open", ".close"]],
        duplicateNonEmptyString,
        "The completed handle lifecycle did not prove a read/write round trip or a supported limitation"
      ),
  },
];
