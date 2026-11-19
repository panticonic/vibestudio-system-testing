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
import {
  managedPdfExpectation,
  managedPdfWorlds,
} from "./pdf-intake-worlds.js";

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
  const readAttempts: number[][] = [];
  let faultDelivered = false;
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
      if (world.fault?.batch === extractionRequests.length) {
        faultDelivered = true;
        if (world.fault.kind === "read-error")
          throw new Error("The assigned PDF batch became unavailable.");
        return {
          ...receipt,
          document: { ...receipt.document, digest: "f".repeat(64) },
        };
      }
      return receipt;
    },
  };
  const bindings = createPdfIntakeBindings(engine, request, retained);
  const read = bindings.pdfIntakeRead.read;
  const verifiedBatches: Awaited<ReturnType<typeof read>>[] = [];
  bindings.pdfIntakeRead.read = async (document, pages, mode) => {
    readAttempts.push([...pages]);
    const receipt = await read(document, pages, mode);
    verifiedBatches.push(structuredClone(receipt));
    return receipt;
  };
  return {
    world,
    request,
    before,
    bindings,
    receipts,
    extractionRequests,
    readAttempts,
    verifiedBatches,
    faultDelivered: () => faultDelivered,
    probes: () => probes,
    digest,
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedPdf>>;

function expectedCitation(
  prepared: Prepared,
  expected: { page: number; quote: string; line?: number },
): Citation | null {
  const expectation = managedPdfExpectation(prepared.world);
  if (!expectation.readPages.includes(expected.page)) return null;
  const received = prepared.world.fault
    ? prepared.receipts.slice(0, prepared.world.fault.batch - 1)
    : prepared.receipts;
  const page = received
    .flatMap((receipt) => receipt.pages)
    .find((page) => page.pageNumber === expected.page);
  const line =
    expected.line ??
    page?.lines.findIndex(({ text }) => text === expected.quote) ??
    -1;
  const observed = page?.lines[line];
  return observed?.text === expected.quote
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
  const expected = world.claims.flatMap(({ evidence }) => evidence);
  const citations = expected.map((item) => expectedCitation(prepared, item));
  const unanswered = world.blocked
    ? [request.query]
    : world.claims
        .filter(({ evidence }) => !evidence.length)
        .map(({ question }) => question);
  const { expectedStatus, readPages, remaining, attemptedBatches } =
    managedPdfExpectation(world);
  const checks = {
    sourceUnchanged: sha256Hex(persisted) === digest,
    workspaceHeadUnchanged:
      before.mainEventId === current.mainEventId &&
      isDeepStrictEqual(before.workingHead, current.workingHead),
    localExtraction:
      prepared.probes() === 1 &&
      prepared.faultDelivered() === Boolean(world.fault) &&
      isDeepStrictEqual(prepared.readAttempts, attemptedBatches) &&
      isDeepStrictEqual(prepared.extractionRequests, attemptedBatches) &&
      receipts.length === attemptedBatches.length &&
      receipts.every(
        (receipt, index) =>
          receipt.document.digest === digest &&
          isDeepStrictEqual(
            receipt.pages
              .map(({ pageNumber }) => pageNumber)
              .sort((a, b) => a - b),
            [...attemptedBatches[index]!].sort((a, b) => a - b),
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
      JSON.stringify(report.readPages) === JSON.stringify(readPages) &&
      JSON.stringify(report.remaining) === JSON.stringify(remaining) &&
      JSON.stringify(report.unanswered) === JSON.stringify(unanswered),
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    caseId: world.id,
    digest,
    expectedStatus,
    requestedPages: request.pages,
    readPages,
    remaining,
    attemptedBatches: prepared.readAttempts,
    fault: world.fault ?? null,
    seedRevision: JSON.stringify(before.workingHead),
  };
}

export async function qualifyManagedPdf(ports: Ports, caseId: string) {
  const prepared = await prepareManagedPdf(ports, caseId);
  const report = await referencePdfIntake(prepared);
  const accepted = await verifyManagedPdf(ports, prepared, report);
  const wrong = await verifyManagedPdf(ports, prepared, {
    ...report,
    digest: report.citations.length ? report.digest : "forged",
    citations: report.citations.map((item, index) =>
      index === 0 ? { ...item, bounds: [0, 0, 0, 0] } : item,
    ),
  });
  return { accepted, rejectedUnsupportedReceipt: !wrong.passed };
}

export async function referencePdfIntake(prepared: Prepared): Promise<Report> {
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
  const readPages: number[] = [];
  let interrupted = false;
  if (!status) {
    const mode: Mode = "embedded";
    for (
      let offset = 0;
      offset < request.pages.length;
      offset += request.batchSize
    ) {
      const batch = request.pages.slice(offset, offset + request.batchSize);
      try {
        await bindings.pdfIntakeRead.read(request.document, batch, mode);
        readPages.push(...batch);
      } catch {
        interrupted = true;
        break;
      }
    }
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
  return {
    status:
      status ??
      (interrupted
        ? "incomplete"
        : citations.length === 0
          ? "no-match"
          : unanswered.length
            ? "partial-match"
            : "verified"),
    digest: probe.digest,
    readPages,
    remaining: request.pages.slice(readPages.length),
    citations,
    unanswered,
  };
}
