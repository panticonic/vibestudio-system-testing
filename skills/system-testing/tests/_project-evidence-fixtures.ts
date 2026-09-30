import { walkRecords } from "./_scenario-evidence.js";

export function preparation() {
  return {
    protocol: "project-preparation.v1",
    contextId: "context:prepared",
    workingHead: { kind: "application", applicationId: "application:prepared" },
    publication: "unchanged",
    liveRuntime: "unchanged",
  };
}

/** Explicit fake canonical VCS receipts for tests of prepared-publication evidence. */
export function publicationMessages(values: unknown[]) {
  const prepared = walkRecords(values).find(
    (record) => record["protocol"] === "project-preparation.v1",
  );
  if (!prepared) return [];
  const workingHead = prepared["workingHead"] as { applicationId: string };
  const contextId = prepared["contextId"];
  const eventId = "event:prepared-publication";
  return [
    {
      operation: "commit",
      result: {
        contextId,
        event: { kind: "event", eventId },
        committedApplicationIds: [workingHead.applicationId],
      },
    },
    {
      operation: "push",
      result: {
        contextId,
        eventId,
        mainEventId: eventId,
        effectId: "effect:prepared-publication",
      },
    },
  ].map((details) => ({
    id: `prepared:${details.operation}`,
    content: JSON.stringify({
      name: "vcs",
      arguments: { operation: details.operation },
      execution: { status: "complete", isError: false, result: { details } },
    }),
    kind: "message" as const,
    senderId: "agent",
    senderMetadata: { type: "agent" as const },
    complete: true,
    contentType: "invocation" as const,
    invocation: {
      id: `prepared:${details.operation}`,
      name: "vcs",
      arguments: { operation: details.operation },
      execution: {
        status: "complete" as const,
        description: "",
        isError: false,
        result: { protocolContent: [], details },
      },
    },
  }));
}
