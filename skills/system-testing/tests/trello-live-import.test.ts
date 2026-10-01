import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import {
  trelloLiveImportTests,
  validateTrelloLiveImport,
  trelloTabIdentity,
} from "./trello-live-import.js";
import {
  preparation,
  publicationMessages,
} from "./_project-evidence-fixtures.js";

it("keeps the live migration opt-in and without an elapsed-time deadline", () => {
  expect(trelloLiveImportTests[0]!.explicitOnly).toBe(true);
  expect(trelloLiveImportTests[0]!.timeoutMs).toBeNull();
});

function completeEvidence(): TestExecutionResult {
  const returned = [
    { sourceId: "normal", browser: "firefox" },
    { sourceId: "snap", browser: "firefox" },
    {
      operationId: "empty",
      state: "complete",
      counts: [{ dataType: "cookies", read: 0, errors: 0 }],
    },
    {
      operationId: "full",
      state: "complete",
      counts: [{ dataType: "cookies", read: 2, errors: 0 }],
    },
  ];
  const invocation = {
    id: "eval:observations",
    name: "eval",
    execution: {
      status: "complete",
      isError: false,
      result: { details: { returnValue: returned } },
    },
  };
  const messages = [
    ...publicationMessages([preparation()]),
    {
      id: invocation.id,
      kind: "message",
      contentType: "invocation",
      complete: true,
      senderId: "agent",
      senderMetadata: { type: "agent" },
      content: JSON.stringify(invocation),
      invocation,
    },
    {
      id: "done",
      kind: "message",
      complete: true,
      senderId: "agent",
      senderMetadata: { type: "agent" },
      content: "Completed and verified.",
    },
  ];
  return {
    duration: 1,
    messages,
    diagnostics: {
      trelloImport: {
        inputs: [
          {
            source: { sourceId: "normal" },
            tabs: [],
            preview: { dataTypes: [{ dataType: "cookies", totalItems: 0 }] },
          },
          {
            source: { sourceId: "snap" },
            tabs: [
              { url: "https://trello.com/b/board/source" },
              { url: "https://trello.com/c/card/title" },
            ],
            preview: { dataTypes: [{ dataType: "cookies", totalItems: 2 }] },
          },
        ],
        browserTabs: [
          { source: "https://trello.com/b/board/new-slug?filter=+" },
          { source: "https://trello.com/c/card/title" },
        ],
        source: {
          fingerprint: "source-fingerprint",
          title: "Example board",
          lists: [{ id: "todo", name: "To do" }],
          cards: [{ name: "Card", idList: "todo" }],
          detailSamples: [
            {
              name: "Card",
              checklistItems: ["**Item**"],
              comments: ["**Original comment**"],
              attachments: [
                {
                  name: "original.txt",
                  url: "https://example.com/original.txt",
                },
              ],
            },
          ],
        },
        beforeReload: "Example board To do Card",
        afterReload: "Example board To do Card",
      },
    },
  } as unknown as TestExecutionResult;
}
const observations = (result: TestExecutionResult) =>
  result.diagnostics!["trelloImport"] as any;

describe("live Trello acceptance evidence", () => {
  it("accepts independently observed migration and reload persistence", () => {
    expect(validateTrelloLiveImport(completeEvidence()).passed).toBe(true);
  });
  it("rejects an imported card lost after reload", () => {
    const result = completeEvidence();
    observations(result).afterReload = "Example board To do";
    expect(validateTrelloLiveImport(result)).toMatchObject({
      passed: false,
      reason: expect.stringContaining("afterReload"),
    });
  });
  it("rejects missing Firefox tabs", () => {
    const result = completeEvidence();
    observations(result).browserTabs.pop();
    expect(validateTrelloLiveImport(result)).toMatchObject({
      passed: false,
      reason: expect.stringContaining("tabs"),
    });
  });
  it("rejects insufficient cookie import counts", () => {
    const result = completeEvidence();
    observations(result).inputs[1].preview.dataTypes[0].totalItems = 3;
    expect(validateTrelloLiveImport(result)).toMatchObject({
      passed: false,
      reason: expect.stringContaining("cookie"),
    });
  });
  it("recognizes Trello identities independently of renamed slugs and filters", () => {
    expect(trelloTabIdentity("https://trello.com/b/abc/new?filter=+")).toBe(
      "b/abc",
    );
    expect(trelloTabIdentity("https://trello.com/c/def/old")).toBe("c/def");
    expect(trelloTabIdentity("https://example.com/b/abc/new")).toBeNull();
  });
});
