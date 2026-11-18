import { sha256HexSyncText } from "@vibestudio/content-addressing";
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
      revision.files.map(async ({ path, text }) => ({
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
  const operations: string[] = [];
  const leads: Lead[] = [];
  async function readAssignedFile(): Promise<Source | null> {
    const response = await ports.vcs.readFile({
      state: { kind: "event", eventId: request.eventId },
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
      eventId: request.eventId,
      path: `${repoPath}/${decisionPath}`,
      contentHash: response.contentHash,
      text: response.content.text,
    };
  }
  return {
    world,
    request,
    before,
    head,
    events,
    operations,
    leads,
    readAssignedFile,
    services: {
      decisionRecall: {
        async search(text: string): Promise<Lead[]> {
          if (text !== query || operations.length)
            throw new Error("Search once for the assigned decision.");
          operations.push("search");
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
          return structuredClone(leads);
        },
      },
      decisionSource: {
        async read(leadId: string): Promise<Source | null> {
          if (
            leadId !== eventId ||
            operations.length !== 1 ||
            !leads.some(({ id }) => id === leadId)
          )
            throw new Error(
              "Read the assigned file at the exact recalled revision.",
            );
          operations.push("source");
          return readAssignedFile();
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

export async function verifyManagedMemory(
  ports: Ports,
  prepared: Prepared,
  report: Report | null,
) {
  const after = await ports.vcs.status();
  const selected = prepared.leads.find(
    ({ eventId }) => eventId === prepared.request.eventId,
  );
  const expected = prepared.world.expected;
  const observed = selected ? await prepared.readAssignedFile() : null;
  const citation = cite(prepared, observed);
  const status = !selected
    ? "no-lead"
    : !observed
      ? "missing-source"
      : citation
        ? "verified"
        : "missing-field";
  const claimed = report?.citation;
  const checks = {
    protectedMainUnchanged:
      after.mainEventId === prepared.before.mainEventId &&
      same(after.workingHead, prepared.head),
    actualRecall:
      same(prepared.operations, selected ? ["search", "source"] : ["search"]) &&
      prepared.leads.length ===
        prepared.world.revisions.filter(({ indexed }) => indexed !== false)
          .length,
    observedWorld:
      status === expected.status &&
      (citation?.quote ?? null) === (expected.quote ?? null) &&
      (citation?.line ?? null) === (expected.line ?? null),
    joinedSource:
      report?.status === status &&
      report.leadId === (selected?.id ?? null) &&
      (citation
        ? claimed?.eventId === citation.eventId &&
          claimed.path === citation.path &&
          claimed.contentHash === citation.contentHash &&
          claimed.line === citation.line &&
          claimed.quote === citation.quote
        : claimed === null),
  };
  return {
    checks,
    passed: Object.values(checks).every(Boolean),
    status,
    caseId: prepared.world.id,
    eventId: prepared.request.eventId,
    citation,
    leadId: selected?.id ?? null,
  };
}

export async function qualifyManagedMemory(
  ports: Ports,
  contextId: string,
  caseId: string,
) {
  const prepared = await prepareManagedMemory(ports, contextId, caseId);
  const leads = await prepared.services.decisionRecall.search(
    prepared.request.query,
  );
  const selected = leads.find(
    ({ eventId }) => eventId === prepared.request.eventId,
  );
  const source = selected
    ? await prepared.services.decisionSource.read(selected.id)
    : null;
  const citation = cite(prepared, source);
  const status = !selected
    ? "no-lead"
    : !source
      ? "missing-source"
      : citation
        ? "verified"
        : "missing-field";
  const reference = { status, leadId: selected?.id ?? null, citation };
  const accepted = await verifyManagedMemory(ports, prepared, reference);
  const altered = await verifyManagedMemory(ports, prepared, {
    ...reference,
    ...(citation
      ? { citation: { ...citation, eventId: "different-revision" } }
      : { leadId: "unobserved-lead" }),
  });
  return { accepted, rejectedUnboundEvidence: !altered.passed };
}
