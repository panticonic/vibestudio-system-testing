import { isDeepStrictEqual } from "node:util";
import { sha256Hex } from "@vibestudio/content-addressing";
import type {
  RuntimeFs,
  VcsClient,
  rpc as RuntimeRpc,
  extensions as RuntimeExtensions,
} from "@workspace/runtime";
import { createPdfIntakeBindings } from "@workspace-skills/pdf-intake-bindings";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { managedPdfWorlds } from "./pdf-intake-worlds.js";

const maximumBytes = 64 * 1024;
const extensionName = "@workspace-extensions/pdf-ingest";
type Ports = {
  fs: RuntimeFs;
  vcs: Pick<VcsClient, "status">;
  rpc: Pick<typeof RuntimeRpc, "call">;
  extensions: Pick<typeof RuntimeExtensions, "invoke">;
};
type Engine = Parameters<typeof createPdfIntakeBindings>[0];
type Receipt = Awaited<ReturnType<Engine["ingest"]>>;
type Binding = ReturnType<typeof createPdfIntakeBindings>;
type Mode = Parameters<Binding["pdfIntakeRead"]["read"]>[2];
type Citation = {
  page: number;
  line: number;
  quote: string;
  bounds: number[];
  source: string;
  confidence: number | null;
};
type Report = {
  status: string;
  digest: string;
  readPages: number[];
  remaining: number[];
  citations: Citation[];
  unanswered: string[];
};

function makePacket(sheets: string[][]) {
  const safe = (value: string) => value.replace(/[\\()]/gu, "\\$&");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${sheets.length} /Kids [${sheets.map((_, index) => `${4 + 2 * index} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, lines] of sheets.entries()) {
    const stream = `BT /F1 12 Tf 24 170 Td 20 TL ${lines.map((text) => `(${safe(text)}) Tj T*`).join(" ")} ET\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const end = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${end}\n%%EOF\n`;
  if (!/^[\u0000-\u007f]*$/u.test(pdf))
    throw new Error("Managed PDF packets use ASCII display text");
  return pdf;
}

export async function prepareManagedPdf(ports: Ports, caseId: string) {
  const world = managedPdfWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown managed PDF intake");
  const before = await ports.vcs.status();
  const directory = await ports.fs.mkdtemp("pdf-intake");
  const document = `${directory}/packet.pdf`;
  const packet = makePacket(world.sheets);
  await ports.fs.writeFile(document, packet);
  const original = new TextEncoder().encode(packet);
  const retained = await readWorkspaceBytes(ports.rpc, document, maximumBytes);
  const digest = sha256Hex(retained);
  if (digest !== sha256Hex(original))
    throw new Error("The workspace changed the assigned PDF bytes");
  const query = world.claims.map(({ question }) => question).join("; ");
  const request = {
    goal: world.goal,
    document,
    pages: [...world.pages],
    batchSize: world.batchSize,
    purpose: world.purpose ?? ("text" as const),
    allowOcr: false,
    query,
  };
  const receipts: Receipt[] = [];
  let probes = 0;
  const extractionRequests: number[][] = [];
  const engine: Engine = {
    async probe(bytes, options) {
      probes++;
      return (await ports.extensions.invoke(extensionName, "probe", [
        bytes,
        options,
      ])) as Awaited<ReturnType<Engine["probe"]>>;
    },
    async ingest(bytes, options) {
      const pages = options?.pages;
      extractionRequests.push(Array.isArray(pages) ? [...pages] : []);
      const receipt = (await ports.extensions.invoke(extensionName, "ingest", [
        bytes,
        options,
      ])) as Receipt;
      receipts.push(receipt);
      return receipt;
    },
  };
  const bindings = createPdfIntakeBindings(engine, request, retained);
  return {
    world,
    request,
    before,
    bindings,
    receipts,
    extractionRequests,
    probes: () => probes,
    digest,
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedPdf>>;

function expectedCitation(
  prepared: Prepared,
  expected: { page: number; quote: string },
): Citation | null {
  const page = prepared.receipts
    .flatMap((receipt) => receipt.pages)
    .find((page) => page.pageNumber === expected.page);
  const line =
    page?.lines.findIndex(({ text }) => text === expected.quote) ?? -1;
  const observed = page?.lines[line];
  return observed
    ? {
        page: expected.page,
        line,
        quote: observed.text,
        bounds: [...observed.bbox],
        source: observed.source,
        confidence: observed.confidence,
      }
    : null;
}

function sameCitation(expected: Citation, actual: Citation) {
  return (
    expected.page === actual.page &&
    expected.line === actual.line &&
    expected.quote === actual.quote &&
    expected.source === actual.source &&
    expected.confidence === actual.confidence &&
    JSON.stringify(expected.bounds) === JSON.stringify(actual.bounds)
  );
}

export async function verifyManagedPdf(
  ports: Ports,
  prepared: Prepared,
  value: unknown,
) {
  const { world, request, before, digest, receipts } = prepared;
  const report = value as Report | null;
  const current = await ports.vcs.status();
  const persisted = await readWorkspaceBytes(
    ports.rpc,
    request.document,
    maximumBytes,
  );
  const requestedBatches: number[][] = [];
  if (!world.blocked)
    for (
      let offset = 0;
      offset < request.pages.length;
      offset += request.batchSize
    )
      requestedBatches.push(
        request.pages.slice(offset, offset + request.batchSize),
      );
  const expected = world.claims.flatMap(({ evidence }) => evidence);
  const citations = expected.map((item) => expectedCitation(prepared, item));
  const unanswered = world.blocked
    ? [request.query]
    : world.claims
        .filter(({ evidence }) => !evidence.length)
        .map(({ question }) => question);
  const expectedStatus =
    world.blocked ??
    (expected.length === 0
      ? "no-match"
      : unanswered.length
        ? "partial-match"
        : "verified");
  const checks = {
    sourceUnchanged: sha256Hex(persisted) === digest,
    workspaceHeadUnchanged:
      before.mainEventId === current.mainEventId &&
      isDeepStrictEqual(before.workingHead, current.workingHead),
    localExtraction:
      prepared.probes() === 1 &&
      isDeepStrictEqual(prepared.extractionRequests, requestedBatches) &&
      receipts.length === requestedBatches.length &&
      receipts.every(
        (receipt, index) =>
          receipt.document.digest === digest &&
          isDeepStrictEqual(
            receipt.pages
              .map(({ pageNumber }) => pageNumber)
              .sort((a, b) => a - b),
            [...requestedBatches[index]!].sort((a, b) => a - b),
          ) &&
          receipt.pages.every((page) =>
            page.lines.every((line) => line.source === "embedded-text"),
          ),
      ),
    exactCitations:
      Array.isArray(report?.citations) &&
      citations.every(Boolean) &&
      report.citations.length === citations.length &&
      citations.every(
        (citation) =>
          citation !== null &&
          report.citations.some((item) => sameCitation(citation, item)),
      ),
    disposition:
      report?.digest === digest &&
      report.status === expectedStatus &&
      JSON.stringify(report.readPages) ===
        JSON.stringify(world.blocked ? [] : request.pages) &&
      JSON.stringify(report.remaining) ===
        JSON.stringify(world.blocked ? request.pages : []) &&
      JSON.stringify(report.unanswered) === JSON.stringify(unanswered),
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    caseId: world.id,
    digest,
    expectedStatus,
    requestedPages: request.pages,
    readPages: world.blocked ? [] : request.pages,
    seedRevision: JSON.stringify(before.workingHead),
  };
}

export async function qualifyManagedPdf(ports: Ports, caseId: string) {
  const prepared = await prepareManagedPdf(ports, caseId);
  const { world, request, bindings } = prepared;
  const probe = await bindings.pdfIntakeProbe.probe(request.document);
  const invalid =
    new Set(request.pages).size !== request.pages.length ||
    request.pages.some((page) => !probe.selectedPages.includes(page));
  const status = invalid
    ? "missing-pages"
    : !probe.embedded || (request.purpose === "ocr" && !request.allowOcr)
      ? "engine-unavailable"
      : null;
  if (!status) {
    const mode: Mode = "embedded";
    for (
      let offset = 0;
      offset < request.pages.length;
      offset += request.batchSize
    )
      await bindings.pdfIntakeRead.read(
        request.document,
        request.pages.slice(offset, offset + request.batchSize),
        mode,
      );
  }
  const citations = world.claims
    .flatMap(({ evidence }) => evidence)
    .map((item) => expectedCitation(prepared, item))
    .filter((item): item is Citation => item !== null);
  const unanswered = status
    ? [request.query]
    : world.claims
        .filter(({ evidence }) => !evidence.length)
        .map(({ question }) => question);
  const report = {
    status:
      status ??
      (citations.length === 0
        ? "no-match"
        : unanswered.length
          ? "partial-match"
          : "verified"),
    digest: probe.digest,
    readPages: status ? [] : request.pages,
    remaining: status ? request.pages : [],
    citations,
    unanswered,
  };
  const accepted = await verifyManagedPdf(ports, prepared, report);
  const wrong = await verifyManagedPdf(ports, prepared, {
    ...report,
    digest: citations.length ? report.digest : "forged",
    citations: citations.map((item, index) =>
      index === 0 ? { ...item, bounds: [0, 0, 0, 0] } : item,
    ),
  });
  return { accepted, rejectedUnsupportedReceipt: !wrong.passed };
}
