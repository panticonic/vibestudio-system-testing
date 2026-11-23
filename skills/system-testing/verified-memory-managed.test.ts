import { expect, it } from "vitest";
import {
  prepareManagedMemory,
  verifyManagedMemory,
} from "./verified-memory-managed.js";
it("accepts repeated recall and independently addressed owned revision reads without a scripted search/source alternation", async () => {
  const blobs = new Map<string, string>(),
    events = new Map<string, { path: string; contentHash: string }[]>();
  let head: any = { kind: "event", eventId: "start" },
    repoPath = "";
  const ports = {
    blobstore: {
      putText: async (text: string) => {
        const digest = "blob-" + blobs.size;
        blobs.set(digest, text);
        return { digest };
      },
    },
    vcs: {
      status: async () => ({ mainEventId: "main", workingHead: head }),
      importSnapshot: async (input: any) => {
        repoPath = input.repositories[0].repoPath;
        const eventId = "event-" + events.size;
        events.set(eventId, input.repositories[0].files);
        head = { kind: "event", eventId };
        return { eventId, importedRepositoryIds: ["owned-repo"] };
      },
      readFile: async (input: any) => {
        const file = events
          .get(input.state.eventId)
          ?.find((file) => file.path === input.file.path);
        return file
          ? {
              repositoryId: "owned-repo",
              repoPath,
              path: file.path,
              contentHash: file.contentHash,
              content: { kind: "text", text: blobs.get(file.contentHash) },
            }
          : null;
      },
    },
    memory: {
      recall: async () => ({
        results: [...events.keys()].map((eventId) => ({
          kind: "commit",
          eventId,
          snippet: "native recalled revision",
        })),
      }),
    },
  };
  const prepared = await prepareManagedMemory(
    ports as never,
    "owned",
    "latest-policy",
  );
  const source = (await prepared.services.decisionSource.read(
    prepared.request.eventId,
  ))!;
  await prepared.services.decisionRecall.search(prepared.request.query);
  await prepared.services.decisionRecall.search(prepared.request.query);
  expect(
    await prepared.services.decisionSource.read(prepared.request.eventId),
  ).toEqual(source);
  const lines = source.text.split("\n"),
    line = lines.findIndex((line) =>
      line.startsWith(prepared.request.field + ":"),
    );
  const report = {
    status: "verified",
    leadId: source.eventId,
    citation: {
      eventId: source.eventId,
      path: source.path,
      contentHash: source.contentHash,
      line: line + 1,
      quote: lines[line],
    },
  };
  expect(
    (await verifyManagedMemory(ports as never, prepared, report)).passed,
  ).toBe(true);
  await expect(
    prepared.services.decisionSource.read("foreign"),
  ).rejects.toThrow("assigned owned decision revision");
  await expect(
    prepared.services.decisionRecall.search("foreign query"),
  ).rejects.toThrow("assigned decision query");
  expect(
    (
      await verifyManagedMemory(ports as never, prepared, {
        ...report,
        citation: { ...report.citation, quote: "invented" },
      })
    ).passed,
  ).toBe(false);
});
