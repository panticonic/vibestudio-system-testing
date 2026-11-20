import { isDeepStrictEqual } from "node:util";
import { sha256Hex, sha256HexSyncText } from "@vibestudio/content-addressing";
import { extensions, fs, rpc, vcs } from "@workspace/runtime";
import { createPdfIntakeBindings } from "@workspace-skills/pdf-intake-bindings";
import { bindPdfLayout } from "@workspace-skills/pdf-intake-bindings/layout";
import { inspectPdfRaster } from "@workspace-skills/pdf-intake-bindings/render";
import type {
  BatchReceipt, PdfGoalBinding, PdfGoalFile, PdfGoalRender, PdfGoalReport, PdfGoalSelection,
  PdfIntakeReport, PdfIntakeRequest, PdfLayoutPage, PdfLayoutReport,
} from "@workspace-skills/pdf-intake/types";
import { openGoalPdfWorlds, type OpenPdfWorld } from "./open-goal-pdf-worlds.js";
import { packetFromStreams } from "./pdf-intake-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";

const extensionName = "@workspace-extensions/pdf-ingest";
type Engine = Parameters<typeof createPdfIntakeBindings>[0];
type Layout = ReturnType<typeof bindPdfLayout>;
type RasterArtifact = { artifactId: string; digest: string; mimeType: string; data: Uint8Array };
type RenderedPage = RasterArtifact & { pageNumber: number; width: number; height: number };
const engine: Engine = {
  async probe(data, options) {
    return await extensions.invoke(extensionName, "probe", [data, options]) as Awaited<ReturnType<Engine["probe"]>>;
  },
  async ingest(data, options) {
    return await extensions.invoke(extensionName, "ingest", [data, options]) as Awaited<ReturnType<Engine["ingest"]>>;
  },
};

function encodePdf(sheets: OpenPdfWorld["documents"][string]) {
  return packetFromStreams(sheets.map(({ rows = [], marks = [] }) => {
    const text = rows.flatMap((row, index) => row.map((value, column) =>
      [24 + column * 226, 170 - index * 20, value.replace(/[\\()]/gu, "\\$&")],
    )).map(([x, y, value]) => `1 0 0 1 ${x} ${y} Tm (${value}) Tj`).join(" ");
    const shapes = marks.map((coordinates) => `q 0.2 0.4 0.6 rg ${coordinates.join(" ")} re f Q`).join(" ");
    return `BT /F1 12 Tf ${text} ET ${shapes}\n`;
  }));
}

function exactEntries(page: PdfLayoutPage, order: string[]) {
  const entries = page.rows.flatMap((row, rowIndex) =>
    row.map((fragment, fragmentIndex) => ({ row: rowIndex, fragment: fragmentIndex, ...fragment })),
  );
  return order.map(text => entries.find(entry => entry.text === text));
}

function exactCitations(receipts: BatchReceipt[], required: NonNullable<OpenPdfWorld["expected"]["text"]>["quotes"]) {
  return required.map(({ page, text }) => {
    const lines = receipts.flatMap(receipt => receipt.pages).find(item => item.number === page)?.lines;
    const line = lines?.findIndex(item => item.text === text) ?? -1;
    const item = lines?.[line];
    return item && { page, line, quote: item.text, bounds: item.bounds, confidence: item.confidence, source: item.source };
  });
}

function validPages(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= 12 && value.every(number =>
    Number.isSafeInteger(number) && number > 0,
  ) && new Set(value).size === value.length;
}

const wrap = (outcome: PdfGoalReport) => ({ status: "workspace-skill-reviewed", skill: "pdf", outcome });

export async function prepareOpenPdfGoal({ contextId, caseId }: { contextId: string; caseId: string }) {
  const world = openGoalPdfWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown open PDF goal.");
  const { goal, expected } = world;
  const before = await vcs.status({ contextId });
  const directory = await fs.mkdtemp("open-pdf-goal");
  const sources = Object.entries(world.documents).map(([name, sheets]) => ({ name, packet: encodePdf(sheets), pages: sheets.length }));
  for (const { name, packet } of sources) await fs.writeFile(`${directory}/${name}`, packet);

  async function readDocuments() {
    const documents = [];
    for (const name of (await fs.readdir(directory)).sort()) {
      if (!sources.some(source => source.name === name)) throw new Error("Unexpected document in the owned PDF directory.");
      const bytes = await readWorkspaceBytes(rpc, `${directory}/${name}`, 64 * 1024);
      const digest = sha256Hex(bytes);
      const { document } = await engine.probe(bytes);
      if (document.digest !== digest) throw new Error("The PDF probe identified different bytes.");
      documents.push({ name, digest, pageCount: document.pageCount, encrypted: document.encrypted, bytes });
    }
    return documents;
  }

  function publicDocuments(documents: Awaited<ReturnType<typeof readDocuments>>): PdfGoalFile[] {
    return documents.map(({ name, digest, pageCount, encrypted }) => ({ name, digest, pageCount, encrypted }));
  }

  let revision: string | undefined;
  let selection: PdfGoalSelection | undefined;
  let source: Awaited<ReturnType<typeof readDocuments>>[number] | undefined;
  let binding: PdfGoalBinding | undefined;
  let intake: ReturnType<typeof createPdfIntakeBindings> | undefined;
  let visual: PdfGoalBinding["visual"];
  const textProbes: Awaited<ReturnType<ReturnType<typeof createPdfIntakeBindings>["pdfIntakeProbe"]["probe"]>>[] = [];
  const textReads: BatchReceipt[] = [];
  const layoutBindings = new Map<string, Layout>();
  const layoutReads = new Map<string, PdfLayoutPage>();
  const renders = new Map<number, PdfGoalRender>();

  const services = {
    pdfGoalDocuments: {
      async discover() {
        const documents = publicDocuments(await readDocuments());
        revision = sha256HexSyncText(JSON.stringify(documents));
        return { revision, documents };
      },
      async bind(observed: string, choice: PdfGoalSelection) {
        if (!revision || observed !== revision || binding || !choice ||
            !validPages(choice.pages) || !choice.pages.length ||
            !validPages(choice.layoutPages) || !validPages(choice.renderPages) ||
            ![...choice.layoutPages, ...choice.renderPages].every(page => choice.pages.includes(page)) ||
            (choice.textQuery !== null && (typeof choice.textQuery !== "string" ||
              !choice.textQuery.trim() || choice.textQuery.length > 1200))) return null;
        const documents = await readDocuments();
        if (sha256HexSyncText(JSON.stringify(publicDocuments(documents))) !== revision) return null;
        const document = documents.find(item => item.name === choice.document);
        if (!document || document.encrypted) return null;
        source = document;
        selection = structuredClone(choice);
        const missingPages = choice.pages.filter(page => page > document.pageCount);
        const pages = choice.pages.filter(page => page <= document.pageCount);
        const text: PdfIntakeRequest | null = choice.textQuery && pages.length ? {
          goal, document: document.name, pages, batchSize: 2, purpose: "text", allowOcr: false, query: choice.textQuery,
        } : null;
        if (text) intake = createPdfIntakeBindings(engine, text, document.bytes);
        const layouts = choice.layoutPages.filter(page => pages.includes(page)).map(page => {
          const scoped = bindPdfLayout(engine, goal, page, document.bytes);
          layoutBindings.set(scoped.request.operationId, scoped);
          return scoped.request;
        });
        const visualPages = choice.renderPages.filter(page => pages.includes(page));
        visual = visualPages.length ? { operationId: `pdf-raster:${document.digest}`, pages: visualPages } : null;
        binding = { document: publicDocuments([document])[0]!, missingPages, text, layouts, visual };
        return structuredClone(binding);
      },
    },
    pdfIntakeProbe: {
      async probe(...args: Parameters<ReturnType<typeof createPdfIntakeBindings>["pdfIntakeProbe"]["probe"]>) {
        if (!intake) throw new Error("Bind the selected local PDF before probing its text.");
        const receipt = await intake.pdfIntakeProbe.probe(...args);
        textProbes.push(structuredClone(receipt));
        return receipt;
      },
    },
    pdfIntakeRead: {
      async read(...args: Parameters<ReturnType<typeof createPdfIntakeBindings>["pdfIntakeRead"]["read"]>) {
        if (!intake) throw new Error("Bind the selected local PDF before reading its text.");
        const receipt = await intake.pdfIntakeRead.read(...args);
        textReads.push(structuredClone(receipt));
        return receipt;
      },
    },
    pdfLayoutRead: {
      async inspect(id: string) {
        const scoped = layoutBindings.get(id);
        if (!scoped || layoutReads.has(id)) throw new Error("Use an unread layout page from the selected local PDF.");
        const receipt = await scoped.services.pdfLayoutRead.inspect(id);
        layoutReads.set(id, structuredClone(receipt));
        return receipt;
      },
    },
    pdfGoalVisual: {
      async render(id: string, pageNumber: number) {
        if (!source || visual?.operationId !== id || !visual.pages.includes(pageNumber) || renders.has(pageNumber))
          throw new Error("Use an unrendered page from the selected local PDF.");
        const page = await extensions.invoke(extensionName, "renderPage", [
          source.bytes, { pageNumber, scale: 1 },
        ]) as RenderedPage;
        const raster = await inspectPdfRaster(page.data);
        if (page.pageNumber !== pageNumber || page.width !== raster.width || page.height !== raster.height ||
            page.mimeType !== "image/png" || !page.artifactId || page.digest !== raster.imageDigest)
          throw new Error("The rendered PDF receipt does not match its page or retained PNG.");
        const result = { documentDigest: source.digest, pageNumber, artifactId: page.artifactId, ...raster };
        renders.set(pageNumber, result);
        return structuredClone(result);
      },
    },
  };

  async function verify(value: unknown) {
    const wrapper = value as Partial<ReturnType<typeof wrap>> | null;
    const report = wrapper?.status === "workspace-skill-reviewed" && wrapper.skill === "pdf" &&
      wrapper.outcome?.status === "inspected" ? wrapper.outcome : null;
    const [documents, after] = await Promise.all([readDocuments(), vcs.status({ contextId })]);
    const retained = await Promise.all([...renders.values()].map(async receipt => {
      const artifact = await extensions.invoke(extensionName, "readArtifact", [receipt.artifactId]) as RasterArtifact;
      const raster = await inspectPdfRaster(artifact.data);
      return { ...raster, artifactId: artifact.artifactId, mimeType: artifact.mimeType,
        digest: artifact.digest, pageNumber: receipt.pageNumber };
    }));
    const reads = [...layoutReads.values()];
    const layouts = expected.layouts ?? [];
    const claims = expected.text;
    const readPages = textReads.flatMap(receipt => receipt.pages.map(({ number }) => number));
    const wantedCitations = claims ? exactCitations(textReads, claims.quotes) : [];
    const proposedRationale = report?.recommendation?.rationale;
    const rationale = typeof proposedRationale === "string" ? proposedRationale.toLowerCase() : "";
    const snapshot = publicDocuments(documents);
    const checks = {
      originalFiles: documents.length === sources.length &&
        revision === sha256HexSyncText(JSON.stringify(snapshot)) &&
        sources.every(({ name, packet, pages }) => documents.some(document => document.name === name &&
          document.digest === sha256HexSyncText(packet) && document.pageCount === pages)),
      exactSelection: source?.name === expected.document &&
        selection?.document === expected.document && !!selection.textQuery === !!claims &&
        isDeepStrictEqual(selection.pages, expected.pages) &&
        isDeepStrictEqual(selection.layoutPages, layouts.map(({ page }) => page)) &&
        isDeepStrictEqual(selection.renderPages, expected.render) &&
        isDeepStrictEqual(report?.selection, selection) && isDeepStrictEqual(report?.document, binding?.document) &&
        isDeepStrictEqual(report?.missingPages, expected.missing ?? []),
      textEvidence: claims ? textProbes.length === 1 &&
        isDeepStrictEqual(readPages, expected.pages) &&
        textReads.every(receipt => receipt.digest === source?.digest) &&
        report?.text?.digest === source?.digest && report?.text?.status === claims.status &&
        isDeepStrictEqual(report.text.readPages, expected.pages) && isDeepStrictEqual(report.text.remaining, []) &&
        wantedCitations.every(Boolean) && isDeepStrictEqual(report.text.citations, wantedCitations) &&
        (claims.status !== "no-match" || textReads.every(receipt => receipt.pages.every(page => !page.lines.length))) :
        report?.text === null && textProbes.length === 0 && !textReads.length,
      layoutEvidence: reads.length === layouts.length && Array.isArray(report?.layouts) &&
        report.layouts.length === layouts.length && layouts.every(({ page, kind, order }, index) => {
          const raw = reads.find(item => item.pageNumber === page);
          const answer = report.layouts[index];
          if (!raw || !answer || raw.digest !== source?.digest || raw.width !== 500 || raw.height !== 200) return false;
          const entries = exactEntries(raw, order);
          return raw.rows.flat().length === order.length && entries.every(Boolean) &&
            answer.digest === raw.digest && answer.pageNumber === page && answer.layout?.kind === kind &&
            typeof answer.layout.basis === "string" && !!answer.layout.basis.trim() &&
            answer.reading?.status === "ordered" && isDeepStrictEqual(answer.reading.entries, entries);
        }),
      renderedEvidence: isDeepStrictEqual([...renders.keys()], expected.render) &&
        isDeepStrictEqual(report?.rendered, [...renders.values()]) &&
        retained.every(({ pageNumber, digest, mimeType, ...raster }) => {
          const receipt = renders.get(pageNumber);
          return receipt && isDeepStrictEqual({ ...raster, pageNumber, documentDigest: source?.digest }, receipt) &&
            mimeType === "image/png" && digest === raster.imageDigest && raster.width === 500 && raster.height === 200 &&
            raster.inkPixels > 0 && (!expected.ink || isDeepStrictEqual(raster.inkBounds, expected.ink));
        }),
      groundedRecommendation: report?.recommendation?.action === expected.action &&
        expected.evidenceTerms.every(term => rationale.includes(term.toLowerCase())),
      protectedHeads: before.mainEventId === after.mainEventId && isDeepStrictEqual(before.workingHead, after.workingHead),
    };
    return { passed: Object.values(checks).every(Boolean), contextId, caseId, goal, checks, selection, documents: snapshot, revision, binding,
      observations: { layouts: reads, text: textReads, textProbes, rendered: retained } };
  }

  async function qualify() {
    const available = await services.pdfGoalDocuments.discover();
    const choice = {
      document: expected.document, pages: expected.pages,
      textQuery: expected.text?.quotes[0]?.text ?? (expected.text ? "Any meaningful selectable text" : null),
      layoutPages: expected.layouts?.map(item => item.page) ?? [], renderPages: expected.render,
    };
    const aliasRejected = await services.pdfGoalDocuments.bind(available.revision, {
      ...choice, document: `./${choice.document}`,
    }) === null;
    const request = await services.pdfGoalDocuments.bind(available.revision, choice);
    if (!request) throw new Error("The PDF reference could not bind the observed original.");
    const layouts: PdfLayoutReport[] = [];
    for (const [index, scoped] of request.layouts.entries()) {
      const raw = await services.pdfLayoutRead.inspect(scoped.operationId);
      const wanted = expected.layouts?.[index];
      if (!wanted) throw new Error("Unexpected reference layout.");
      const ordered = exactEntries(raw, wanted.order);
      if (!ordered.every(item => item !== undefined)) throw new Error("A reference fragment was absent.");
      layouts.push({ digest: raw.digest, pageNumber: raw.pageNumber,
        layout: { kind: wanted.kind, basis: "Read the native fragment coordinates in the requested order." },
        reading: { status: "ordered", entries: ordered } });
    }
    let text: PdfIntakeReport | null = null;
    if (request.text && expected.text) {
      await services.pdfIntakeProbe.probe(request.text.document);
      for (let index = 0; index < request.text.pages.length; index += request.text.batchSize) {
        await services.pdfIntakeRead.read(request.text.document,
          request.text.pages.slice(index, index + request.text.batchSize), "embedded");
      }
      const citations = exactCitations(textReads, expected.text.quotes);
      if (!citations.every(item => item !== undefined)) throw new Error("A reference quotation was absent.");
      text = { status: expected.text.status, digest: request.document.digest,
        readPages: request.text.pages, remaining: [], citations, unanswered: [] };
    }
    const rendered = [];
    for (const page of request.visual?.pages ?? [])
      rendered.push(await services.pdfGoalVisual.render(request.visual!.operationId, page));
    const outcome: PdfGoalReport = { status: "inspected", document: request.document, selection: choice,
      missingPages: request.missingPages, text, layouts, rendered,
      recommendation: { action: expected.action, rationale: expected.evidenceTerms.join(", ") } };
    const verified = await verify(wrap(outcome));
    const wrong: PdfGoalReport = { ...outcome, selection: { ...choice, document: `./${choice.document}` },
      recommendation: { action: "needs-review", rationale: "Unverified." } };
    const negative = await verify(wrap(wrong));
    const checks = { ...verified.checks, aliasRejected, rejectsUnverifiedReport: !negative.passed };
    return { ...verified, checks, passed: Object.values(checks).every(Boolean) };
  }

  return { goal, services, verify, qualify };
}
