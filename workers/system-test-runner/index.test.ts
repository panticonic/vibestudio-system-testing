import { describe, expect, it } from "vitest";
import {
  assembleSystemTestRecord,
  splitSystemTestRecord,
  systemTestUtilityKeys,
} from "./index.js";

describe("system-test utility scope ownership", () => {
  it("gives concurrent utility calls distinct finite scope identities", () => {
    const first = systemTestUtilityKeys("doctor", "call-a");
    const second = systemTestUtilityKeys("doctor", "call-b");

    expect(first).not.toEqual(second);
    expect(first.subKey).toBe("system-test-doctor-call-a");
    expect(first.scopeKey).toBe("$systemTestUtility:doctor:call-a");
    expect(second.subKey).toBe("system-test-doctor-call-b");
    expect(second.scopeKey).toBe("$systemTestUtility:doctor:call-b");
  });
});

describe("system-test durable record paging", () => {
  it("preserves a large record exactly in code-unit and UTF-8-bounded SQLite values", () => {
    const text = "🧪abcdefghij".repeat(40_000);
    const pages = splitSystemTestRecord(text);

    expect(pages.length).toBeGreaterThan(1);
    expect(Math.max(...pages.map((page) => page.length))).toBeLessThanOrEqual(
      64 * 1024,
    );
    expect(
      Math.max(
        ...pages.map((page) => new TextEncoder().encode(page).byteLength),
      ),
    ).toBeLessThanOrEqual(256 * 1024);
    expect(pages.join("")).toBe(text);
  });

  it("represents an empty record with one durable page", () => {
    expect(splitSystemTestRecord("")).toEqual([""]);
  });

  it("rejects missing or stale pages instead of returning mixed replacement data", () => {
    expect(() =>
      assembleSystemTestRecord(6, 2, [{ page_index: 0, page_text: "abc" }]),
    ).toThrow("incomplete durable pages");
    expect(() =>
      assembleSystemTestRecord(6, 2, [
        { page_index: 0, page_text: "abc" },
        { page_index: 2, page_text: "def" },
      ]),
    ).toThrow("incomplete durable pages");
  });
});
