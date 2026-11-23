import { compareUtf16CodeUnits, sha256HexSyncText } from "@vibestudio/content-addressing";
import type {
  blobstore as RuntimeBlobstore,
  memory as RuntimeMemory,
  VcsClient,
} from "@workspace/runtime";
import { decisionPath, managedMemoryWorlds } from "./verified-memory-worlds.js";

type Ports = {
  vcs: Pick<VcsClient, "status" | "importSnapshot" | "readFile">;
  blobstore: Pick<typeof RuntimeBlobstore, "putText">;
  memory: Pick<typeof RuntimeMemory, "recall">;
};

type Lead = { id: string; eventId: string; snippet: string };
type Source = {
  eventId: string;
  path: string;
  contentHash: string;
  text: string;
};
type Citation = Omit<Source, "text"> & { line: number; quote: string };
type Report = {
  status: string;
  leadId: string | null;
  citation: Citation | null;
};

export async function prepareManagedMemory(
  ports: Ports,
  contextId: string,
  caseId: string,
) {
  const world = managedMemoryWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown managed verified memory case");
  const tag = crypto.randomUUID().replace(/-/gu, "");
  const query = `decision${tag}`;
  const repoPath = `projects/decision-${tag.slice(0, 10)}`;
  const before = await ports.vcs.status();
  let repositoryId: string | undefined;
  let head = before.workingHead;
  const events: string[] = [];
  for (const [ordinal, revision] of world.revisions.entries()) {
    const message =
      revision.indexed === false ? revision.note : `${query} ${revision.note}`;
    const files = await Promise.all(
      [...revision.files]
        .sort((left, right) => compareUtf16CodeUnits(left.path, right.path))
        .map(async ({ path, text }) => ({
          path,
          contentHash: (await ports.blobstore.putText(text)).digest,
          mode: 0o644,
        })),
    );
    const result = await ports.vcs.importSnapshot({
      contextId,
      commandId: `decision-${tag}-${ordinal}`,
      expectedWorkingHead: head,
      intentSummary: message,
      source: {
        kind: "generated",
        uri: `system-test://verified-memory/${tag}`,
        snapshotRevision: sha256HexSyncText(JSON.stringify({ ordinal, files })),
      },
      repositories: [
        { repoPath, ...(repositoryId ? { repositoryId } : {}), files },
      ],
      message,
    });
    const imported = result.importedRepositoryIds[0];
    if (
      !imported ||
      (repositoryId && repositoryId !== imported) ||
      result.importedRepositoryIds.length !== 1
    )
      throw new Error("The source history changed repository identity");
    repositoryId = imported;
    events.push(result.eventId);
    head = { kind: "event", eventId: result.eventId };
  }
  const eventId = events[world.target];
  if (!eventId || !repositoryId)
    throw new Error("The decision assignment has no owned revision");
  const assignedRepository = repositoryId;
  const request = { goal: world.goal, query, eventId, field: world.field };
  const beforeEventId = world.comparison
    ? events[world.comparison.before]
    : undefined;
  if (world.comparison && (!beforeEventId || beforeEventId === eventId))
    throw new Error("The comparison needs two assigned revisions");
  const assignedEvents = beforeEventId ? [beforeEventId, eventId] : [eventId];
  const comparisonRequest = beforeEventId
    ? {
        goal: world.goal,
        query,
        beforeEventId,
        afterEventId: eventId,
        field: world.field,
      }
    : null;
  const operations: string[] = [];
  let indexed = false;
  const leads: Lead[] = [];
  async function readAssignedFile(eventId: string): Promise<Source | null> {
    const response = await ports.vcs.readFile({
      state: { kind: "event", eventId },
      repositoryId: assignedRepository,
      file: { kind: "path", path: decisionPath },
    });
    if (!response) return null;
    if (
      response.repositoryId !== assignedRepository ||
      response.repoPath !== repoPath ||
      response.path !== decisionPath ||
      response.content.kind !== "text"
    )
      throw new Error("The source reader returned a different committed file");
    return {
      eventId,
      path: `${repoPath}/${decisionPath}`,
      contentHash: response.contentHash,
      text: response.content.text,
    };
  }
  return {
    world,
    request,
    comparisonRequest,
    assignedEvents,
    before,
    head,
    events,
    operations,
    leads,
    readAssignedFile,
    services: {
      decisionRecall: {
        async search(text: string): Promise<Lead[]> {
          if (text !== query) throw new Error("Search only the assigned decision query.");
          operations.push("search");
          if (indexed) return structuredClone(leads);
          const observed = await ports.memory.recall({
            query,
            kinds: ["commit"],
            limit: 12,
          });
          for (const result of observed.results) {
            const id = result.eventId;
            if (
              result.kind === "commit" &&
              id &&
              events.includes(id) &&
              !leads.some((lead) => lead.id === id)
            )
              leads.push({ id, eventId: id, snippet: result.snippet });
          }
          indexed = true;
          return structuredClone(leads);
        },
      },
      decisionSource: {
        async read(leadId: string): Promise<Source | null> {
          if (!assignedEvents.includes(leadId))
            throw new Error("Read only an assigned owned decision revision.");
          operations.push(`source:${leadId}`);
          return readAssignedFile(leadId);
        },
      },
    },
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedMemory>>;
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

function cite(prepared: Prepared, observed: Source | null): Citation | null {
  const { field } = prepared.request;
  const prefix = `${field}:`;
  const lines = observed?.text.split(/\r?\n/u) ?? [];
  const found = lines.flatMap((quote, index) =>
    quote.startsWith(prefix) && quote.slice(prefix.length).trim()
      ? [{ quote, line: index + 1 }]
      : [],
  );
  if (!observed || found.length !== 1 || !found[0]) return null;
  const { eventId, path, contentHash } = observed;
  return { eventId, path, contentHash, ...found[0] };
}

function observedReport(
  prepared: Prepared,
  lead: Lead | undefined,
  observed: Source | null,
): Report {
  const citation = cite(prepared, observed);
  return {
    status: !lead
      ? "no-lead"
      : !observed
        ? "missing-source"
        : citation
          ? "verified"
          : "missing-field",
    leadId: lead?.id ?? null,
    citation,
  };
}

function comparisonStatus(field: string, before: Report, after: Report) {
  if (!before.citation || !after.citation) return "unverified";
  const value = (citation: Citation) =>
    citation.quote.slice(field.length + 1).trim();
  return value(before.citation) === value(after.citation)
    ? "unchanged"
    : "changed";
}

function joinsReport(expected: Report, value: Report | null | undefined) {
  const { status, leadId, citation } = expected;
  const claimed = value?.citation;
  return (
    value?.status === status &&
    value.leadId === leadId &&
    (citation
      ? claimed?.eventId === citation.eventId &&
        claimed.path === citation.path &&
        claimed.contentHash === citation.contentHash &&
        claimed.line === citation.line &&
        claimed.quote === citation.quote
      : claimed === null)
  );
}

type Comparison = { status: string; before: Report; after: Report };

export async function verifyManagedMemory(
  ports: Ports,
  prepared: Prepared,
  value: unknown,
) {
  const after = await ports.vcs.status();
  const requiredSources: string[] = [];
  const observed: Report[] = [];
  for (const eventId of prepared.assignedEvents) {
    const lead = prepared.leads.find(({ id }) => id === eventId);
    const source = lead ? await prepared.readAssignedFile(eventId) : null;
    if (lead) requiredSources.push(`source:${eventId}`);
    observed.push(observedReport(prepared, lead, source));
  }
  const final = observed.at(-1)!;
  const first = observed[0]!;
  const assigned = prepared.world.comparison;
  const status = assigned
    ? comparisonStatus(prepared.request.field, first, final)
    : final.status;
  const matches = (expected: typeof prepared.world.expected, report: Report) =>
    report.status === expected.status &&
    (report.citation?.quote ?? null) === (expected.quote ?? null) &&
    (report.citation?.line ?? null) === (expected.line ?? null);
  const comparison = assigned ? (value as Comparison | null) : null;
  const checks = {
    protectedMainUnchanged:
      after.mainEventId === prepared.before.mainEventId &&
      same(after.workingHead, prepared.head),
    actualRecall:
      prepared.operations.includes("search") && requiredSources.every(operation => prepared.operations.includes(operation)) &&
      prepared.leads.length ===
        prepared.world.revisions.filter(({ indexed }) => indexed !== false)
          .length,
    observedWorld:
      matches(prepared.world.expected, final) &&
      (!assigned ||
        (matches(assigned.expected, first) && assigned.status === status)),
    joinedSource: assigned
      ? comparison?.status === status &&
        joinsReport(first, comparison.before) &&
        joinsReport(final, comparison.after)
      : joinsReport(final, value as Report | null),
  };
  return {
    checks,
    passed: Object.values(checks).every(Boolean),
    status,
    caseId: prepared.world.id,
    eventId: prepared.request.eventId,
    citation: final.citation,
    leadId: final.leadId,
    endpoints: assigned
      ? {
          beforeEventId: prepared.assignedEvents[0]!,
          afterEventId: prepared.request.eventId,
          before: first,
          after: final,
        }
      : null,
  };
}

export async function qualifyManagedMemory(
  ports: Ports,
  contextId: string,
  caseId: string,
) {
  const prepared = await prepareManagedMemory(ports, contextId, caseId);
  const reports: Report[] = [];
  for (const eventId of prepared.assignedEvents) {
    const leads = await prepared.services.decisionRecall.search(
      prepared.request.query,
    );
    const lead = leads.find(({ id }) => id === eventId);
    const source = lead
      ? await prepared.services.decisionSource.read(lead.id)
      : null;
    reports.push(observedReport(prepared, lead, source));
  }
  const before = reports[0]!;
  const after = reports.at(-1)!;
  const comparison = prepared.comparisonRequest;
  const status = comparisonStatus(prepared.request.field, before, after);
  const reference = comparison ? { status, before, after } : after;
  const accepted = await verifyManagedMemory(ports, prepared, reference);
  const altered = await verifyManagedMemory(
    ports,
    prepared,
    comparison
      ? {
          status,
          before: after,
          after: before,
        }
      : {
          ...after,
          ...(after.citation
            ? { citation: { ...after.citation, eventId: "different-revision" } }
            : { leadId: "unobserved-lead" }),
        },
  );
  return { accepted, rejectedUnboundEvidence: !altered.passed };
}
