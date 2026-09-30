import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import {
  preparedProject,
  publishedPreparation,
  committedPreparation,
} from "./_project-evidence.js";
import {
  preparation,
  publicationMessages,
} from "./_project-evidence-fixtures.js";

const prepared = {
  created: "panels/test",
  preflight: { ok: true, projectType: "panel" },
  preparation: preparation(),
};
function execution(messages: unknown[]): TestExecutionResult {
  return { duration: 0, messages } as TestExecutionResult;
}

describe("preparation and canonical publication evidence", () => {
  it("never accepts preparation alone as publication", () => {
    expect(preparedProject(prepared, "panel")).toBe(true);
    expect(publishedPreparation(execution([]), prepared)).toBe(false);
    expect(
      preparedProject(
        { ...prepared, preparation: { published: true } },
        "panel",
      ),
    ).toBe(false);
  });
  it("joins an application to its commit and later protected push", () => {
    const messages = publicationMessages([prepared]);
    expect(publishedPreparation(execution(messages), prepared)).toBe(true);
    expect(
      committedPreparation(execution(messages.slice(0, 1)), prepared),
    ).toBe(true);
    expect(committedPreparation(execution([]), prepared)).toBe(false);
    expect(
      publishedPreparation(execution(messages.slice(0, 1)), prepared),
    ).toBe(false);
    expect(
      publishedPreparation(execution([...messages].reverse()), prepared),
    ).toBe(false);
    expect(
      publishedPreparation(execution(messages), {
        ...prepared,
        preparation: {
          ...preparation(),
          workingHead: {
            kind: "application",
            applicationId: "application:unrelated",
          },
        },
      }),
    ).toBe(false);
    expect(
      publishedPreparation(execution(messages), {
        ...prepared,
        preparation: { ...preparation(), contextId: "context:other" },
      }),
    ).toBe(false);
  });
});
