import { describe, expect, it } from "vitest";
import {
  serializeSystemTestError,
  serializeSystemTestStack,
} from "./structured-error.js";

describe("structured system-test errors", () => {
  it("preserves typed RPC evidence and indexes opaque diagnostic handles", () => {
    const error = Object.assign(
      new Error("[vcs.importSnapshot] internal failure"),
      {
        name: "RemoteRpcError",
        code: "InternalFailure",
        errorKind: "application",
        errorData: {
          code: "InternalFailure",
          message: "Operation failed; use the diagnostic handle",
          handle: "diagnostic:vcs:01JABC",
          nested: {
            apiToken: "do-not-persist",
            diagnostic_handle: "diagnostic:vcs:01JDEF",
          },
        },
        cause: new Error("credential=do-not-persist"),
      },
    );
    Object.defineProperty(error, "stack", {
      enumerable: true,
      value: "stack containing do-not-persist",
    });

    const serialized = serializeSystemTestError(error);

    expect(serialized).toEqual({
      name: "RemoteRpcError",
      message: "[vcs.importSnapshot] internal failure",
      code: "InternalFailure",
      errorKind: "application",
      errorData: {
        code: "InternalFailure",
        message: "Operation failed; use the diagnostic handle",
        handle: "diagnostic:vcs:01JABC",
        nested: {
          apiToken: "[redacted]",
          diagnostic_handle: "diagnostic:vcs:01JDEF",
        },
      },
      diagnosticHandles: ["diagnostic:vcs:01JABC", "diagnostic:vcs:01JDEF"],
      cause: { name: "Error", message: "credential=[redacted]" },
    });
    expect(JSON.stringify(serialized)).not.toContain("stack containing");
    expect(JSON.stringify(serialized)).not.toContain("do-not-persist");
  });

  it("produces bounded JSON-safe data without invoking accessors", () => {
    const cyclic: Record<string, unknown> = { value: Number.POSITIVE_INFINITY };
    cyclic["self"] = cyclic;
    Object.defineProperty(cyclic, "password", {
      enumerable: true,
      get: () => {
        throw new Error("accessor must not run");
      },
    });
    const error = Object.assign(new Error("authorization=top-secret"), {
      errorData: cyclic,
    });

    const serialized = serializeSystemTestError(error);

    expect(serialized.message).toBe("authorization=[redacted]");
    expect(serialized.errorData).toEqual({
      value: "Infinity",
      self: "[circular]",
      password: "[redacted]",
    });
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it("redacts and bounds explicitly requested diagnostic stacks", () => {
    const error = new TypeError(
      "Cannot read properties of undefined (reading 'includes')",
    );
    error.stack = `TypeError: token=must-not-persist\n    at validate (validator.ts:12:3)`;

    expect(serializeSystemTestStack(error)).toBe(
      "TypeError: token=[redacted]\n    at validate (validator.ts:12:3)",
    );
  });

  it("retains original aggregate setup and cleanup diagnostics without raw sensitive causes", () => {
    const setup = Object.assign(
      new Error("Native owner requires a trusted loaded image"),
      {
        code: "SchemaImageMissing",
        errorKind: "application",
        errorData: { handle: "diagnostic:schema:original", token: "private" },
      },
    );
    const cleanup = Object.assign(new Error("Context reclaim failed"), {
      code: "ContextBusy",
    });
    const serialized = serializeSystemTestError(
      new AggregateError([setup, cleanup], "Setup and cleanup failed", {
        cause: setup,
      }),
    );
    expect(serialized.cause).toMatchObject({
      message: setup.message,
      code: "SchemaImageMissing",
      errorData: { token: "[redacted]" },
    });
    expect(serialized.errors).toEqual([
      serialized.cause,
      { name: "Error", message: "Context reclaim failed", code: "ContextBusy" },
    ]);
    expect(JSON.stringify(serialized)).not.toContain("private");
  });

  it("bounds circular, deep, and wide error trees without invoking accessors", () => {
    const circular = new Error("Original");
    Object.defineProperty(circular, "cause", { value: circular });
    expect(serializeSystemTestError(circular).cause).toEqual({
      name: "CircularError",
      message: "[circular]",
    });
    const accessor = new Error("Safe");
    Object.defineProperty(accessor, "cause", {
      get: () => {
        throw new Error("must not invoke");
      },
    });
    expect(serializeSystemTestError(accessor).cause).toBeUndefined();
    let deep: Error = new Error("leaf");
    for (let index = 0; index < 100; index++)
      deep = new Error("nested", { cause: deep });
    expect(JSON.stringify(serializeSystemTestError(deep))).toContain(
      "[error-tree-truncated]",
    );
    const wide = serializeSystemTestError(
      new AggregateError(
        Array.from({ length: 1000 }, () => new Error("child")),
        "wide",
      ),
    );
    expect(wide.errors!.length).toBeLessThanOrEqual(32);
    expect(wide.errors![wide.errors!.length - 1]).toEqual({
      name: "TruncatedError",
      message: "[error-tree-truncated]",
    });
  });
});
