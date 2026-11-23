import {assessSemanticOutcome} from "./semantic-outcome-contract.js";
import {assessObservedApplicationOutcome} from "./observed-application-outcome.js";
import {referenceObserver} from "./observer-slot-control.js";
import type {InvocationObservations} from "./observed-invocation.js";
import { sameEvidenceMembers } from "./semantic-evidence.js";
import { isDeepStrictEqual } from "node:util";
import { sha256Hex, sha256HexSyncText } from "@vibestudio/content-addressing";
import { extensions, fs, rpc, vcs } from "@workspace/runtime";
import { createPdfIntakeBindings } from "@workspace-skills/pdf-intake-bindings";
import { bindPdfLayout } from "@workspace-skills/pdf-intake-bindings/layout";
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
type RetainedRaster = Omit<PdfGoalRender, "documentDigest" | "pageNumber"> & Pick<RasterArtifact, "digest" | "mimeType">;
async function inspectRasterArtifact(artifactId: string): Promise<RetainedRaster> {
  return await extensions.invoke(extensionName, "inspectRasterArtifact", [artifactId]) as RetainedRaster;
}
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



export async function prepareOpenPdfGoal({ contextId, caseId }: { contextId: string; caseId: string }) {
  const world = openGoalPdfWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown open PDF goal.");
  return prepareOpenPdfInspection(contextId, world);
}

export async function prepareOpenPdfInspection(contextId: string, world: OpenPdfWorld) {
  const { id: caseId, goal, expected } = world;
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
  const probeCache = new Map<string, typeof textProbes[number]>();
  const textCache = new Map<string, BatchReceipt>();
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
        const key = JSON.stringify(args);
        if (probeCache.has(key)) return structuredClone(probeCache.get(key)!);
        const receipt = await intake.pdfIntakeProbe.probe(...args);
        probeCache.set(key, structuredClone(receipt));
        textProbes.push(structuredClone(receipt));
        return receipt;
      },
    },
    pdfIntakeRead: {
      async read(...args: Parameters<ReturnType<typeof createPdfIntakeBindings>["pdfIntakeRead"]["read"]>) {
        if (!intake) throw new Error("Bind the selected local PDF before reading its text.");
        const key = JSON.stringify(args);
        if (textCache.has(key)) return structuredClone(textCache.get(key)!);
        const receipt = await intake.pdfIntakeRead.read(...args);
        textCache.set(key, structuredClone(receipt));
        textReads.push(structuredClone(receipt));
        return receipt;
      },
    },
    pdfLayoutRead: {
      async inspect(id: string) {
        const scoped = layoutBindings.get(id);
        if (!scoped) throw new Error("Use a layout page from the selected local PDF.");
        if (layoutReads.has(id)) return structuredClone(layoutReads.get(id)!);
        const receipt = await scoped.services.pdfLayoutRead.inspect(id);
        layoutReads.set(id, structuredClone(receipt));
        return receipt;
      },
    },
    pdfGoalVisual: {
      async render(id: string, pageNumber: number) {
        if (!source || visual?.operationId !== id || !visual.pages.includes(pageNumber))
          throw new Error("Use a page from the selected local PDF.");
        if (renders.has(pageNumber)) return structuredClone(renders.get(pageNumber)!);
        const page = await extensions.invoke(extensionName, "renderPage", [
          source.bytes, { pageNumber, scale: 1 },
        ]) as RenderedPage;
        const { artifactId, digest, mimeType, ...raster } = await inspectRasterArtifact(page.artifactId);
        if (page.pageNumber !== pageNumber || page.width !== raster.width || page.height !== raster.height ||
            mimeType !== page.mimeType || artifactId !== page.artifactId || page.digest !== digest ||
            page.digest !== raster.imageDigest || page.digest !== sha256Hex(page.data))
          throw new Error("The rendered PDF receipt does not match its page or retained PNG.");
        const result = { documentDigest: source.digest, pageNumber, artifactId: page.artifactId, ...raster };
        renders.set(pageNumber, result);
        return structuredClone(result);
      },
    },
  };

  async function attestCitations(value: unknown, indices: number[]) {
    const report = value as PdfGoalReport | null;
    if (report?.status !== "inspected" || !binding?.text || !source || !selection ||
        report.text?.status !== "verified" || report.text.digest !== source.digest ||
        !isDeepStrictEqual(report.text.readPages, binding.text.pages) ||
        !isDeepStrictEqual(report.document, binding.document) ||
        !isDeepStrictEqual(report.selection, selection) || report.missingPages?.length ||
        binding.missingPages.length || !Array.isArray(indices) || !indices.every(Number.isSafeInteger) ||
        !validPages(indices.map(index => index + 1)) || !indices.length)
      return null;
    const retained = await readWorkspaceBytes(rpc, `${directory}/${source.name}`, 64 * 1024);
    if (sha256Hex(retained) !== source.digest) return null;
    const citations = [];
    for (const index of indices) {
      const citation = report.text.citations?.[index];
      const span = citation && textReads.find(receipt => receipt.digest === source?.digest &&
        receipt.pages.some(page => page.number === citation.page))?.pages?.find(page => page.number === citation.page)?.lines[citation.line];
      if (!span || span.text !== citation.quote || !isDeepStrictEqual(span.bounds, citation.bounds) ||
          span.source !== citation.source || span.confidence !== citation.confidence) return null;
      citations.push({ page: citation.page, line: citation.line, quote: citation.quote });
    }
    return { document: source.name, digest: source.digest, citations };
  }

  /** Native observations for composing an inspection into another application goal. */
  function observedEvidence() {
    return structuredClone({ selection, revision, binding,
      observations: { layouts: [...layoutReads.values()], text: textReads,
        textProbes, rendered: [...renders.values()] } });
  }

  /** Verify the PDF work itself without demanding a copied PDF result from its caller. */
  async function verifyObserved({ allowWorkingHeadChange = false } = {}) {
    const [documents, after] = await Promise.all([readDocuments(), vcs.status({ contextId })]);
    const snapshot = publicDocuments(documents);
    const claims = expected.text;
    const layouts = expected.layouts ?? [];
    const pages = [...new Set(textReads.flatMap(receipt => receipt.pages.map(page => page.number)))].sort((a,b)=>a-b);
    const wanted = claims ? exactCitations(textReads, claims.quotes) : [];
    const retained = await Promise.all([...renders.values()].map(async receipt => ({
      receipt, raster: await inspectRasterArtifact(receipt.artifactId),
    })));
    const checks = {
      originalFiles: documents.length === sources.length &&
        revision === sha256HexSyncText(JSON.stringify(snapshot)) &&
        sources.every(({ name, packet, pages }) => documents.some(document => document.name === name &&
          document.digest === sha256HexSyncText(packet) && document.pageCount === pages)),
      selectedNativeDocument: source?.name === expected.document && selection?.document === expected.document &&
        !!selection.textQuery === !!claims && isDeepStrictEqual(selection.pages, expected.pages) &&
        isDeepStrictEqual(selection.layoutPages, layouts.map(layout => layout.page)) &&
        isDeepStrictEqual(selection.renderPages, expected.render) &&
        isDeepStrictEqual(binding?.missingPages, expected.missing ?? []),
      nativeTextRead: claims ? textProbes.length > 0 &&
        isDeepStrictEqual(pages, [...expected.pages].sort((a,b)=>a-b)) &&
        textReads.every(receipt => receipt.digest === source?.digest) && wanted.every(Boolean) &&
        (claims.status !== "no-match" || isDeepStrictEqual(
          textReads.flatMap(receipt => receipt.pages.flatMap(page => page.lines.map(line => line.text))),
          claims.noMatchLines ?? [])) : textProbes.length === 0 && textReads.length === 0,
      nativeLayoutRead: layoutReads.size === layouts.length && layouts.every(({page,order}) => {
        const raw = [...layoutReads.values()].find(layout => layout.pageNumber === page);
        return !!raw && raw.digest === source?.digest && raw.width === 500 && raw.height === 200 &&
          raw.rows.flat().length === order.length && exactEntries(raw, order).every(Boolean);
      }),
      nativeRenderedArtifacts: sameEvidenceMembers([...renders.keys()], expected.render) &&
        retained.every(({ receipt, raster: { digest, mimeType, ...raster } }) =>
          isDeepStrictEqual({ ...raster, pageNumber: receipt.pageNumber, documentDigest: source?.digest }, receipt) &&
          mimeType === "image/png" && digest === raster.imageDigest && raster.width === 500 && raster.height === 200 &&
          raster.inkPixels > 0 && (!expected.ink || isDeepStrictEqual(raster.inkBounds, expected.ink))),
      protectedHeads: before.mainEventId === after.mainEventId &&
        (allowWorkingHeadChange || isDeepStrictEqual(before.workingHead, after.workingHead)),
    };
    return {outcomeContract:{effects:{checks:["originalFiles","selectedNativeDocument","nativeTextRead","nativeLayoutRead","nativeRenderedArtifacts","protectedHeads"],rationale:"This native-only observation verifier checks actual PDF bytes, reads and raster artifacts without any model-returned answer."},returnedValue:{checks:[],required:false,rationale:"There is no model-generated answer in this native-only observation helper."}}, passed: Object.values(checks).every(Boolean), contextId, caseId, goal, checks,
      documents: snapshot, ...observedEvidence() };
  }

  async function verifyEvidence(value: unknown, { allowWorkingHeadChange = false } = {}) {
    const wrapper = value as Partial<PdfGoalReport> | null;
    const report = wrapper?.status === "inspected" ? wrapper : null;
    const [documents, after] = await Promise.all([readDocuments(), vcs.status({ contextId })]);
    const retained = await Promise.all([...renders.values()].map(async receipt => {
      const raster = await inspectRasterArtifact(receipt.artifactId);
      return { ...raster, pageNumber: receipt.pageNumber };
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
      textEvidence: claims ? textProbes.length > 0 &&
        isDeepStrictEqual([...new Set(readPages)].sort((a,b)=>a-b), [...expected.pages].sort((a,b)=>a-b)) &&
        textReads.every(receipt => receipt.digest === source?.digest) &&
        report?.text?.digest === source?.digest && report?.text?.status === claims.status &&
        isDeepStrictEqual(report.text.readPages, expected.pages) && isDeepStrictEqual(report.text.remaining, []) &&
        wantedCitations.every(Boolean) && isDeepStrictEqual(report.text.citations, wantedCitations) &&
        (claims.status !== "no-match" || isDeepStrictEqual(
          textReads.flatMap(receipt => receipt.pages.flatMap(page => page.lines.map(({ text }) => text))),
          claims.noMatchLines ?? [],
        )) :
        report?.text === null && textProbes.length === 0 && !textReads.length,
      layoutEvidence: reads.length === layouts.length && Array.isArray(report?.layouts) &&
        report.layouts.length === layouts.length && layouts.every(({ page, kind, order }) => {
          const raw = reads.find(item => item.pageNumber === page);
          const answer = report.layouts.find(answer => answer.pageNumber === page);
          if (!raw || !answer || raw.digest !== source?.digest || raw.width !== 500 || raw.height !== 200) return false;
          const entries = exactEntries(raw, order);
          return raw.rows.flat().length === order.length && entries.every(Boolean) &&
            answer.digest === raw.digest && answer.pageNumber === page && answer.layout?.kind === kind &&
            typeof answer.layout.basis === "string" && !!answer.layout.basis.trim() &&
            answer.reading?.status === "ordered" && isDeepStrictEqual(answer.reading.entries, entries);
        }),
      renderedEvidence: sameEvidenceMembers([...renders.keys()], expected.render) &&
        Array.isArray(report?.rendered) && sameEvidenceMembers(report.rendered, [...renders.values()]) &&
        retained.every(({ pageNumber, digest, mimeType, ...raster }) => {
          const receipt = renders.get(pageNumber);
          return receipt && isDeepStrictEqual({ ...raster, pageNumber, documentDigest: source?.digest }, receipt) &&
            mimeType === "image/png" && digest === raster.imageDigest && raster.width === 500 && raster.height === 200 &&
            raster.inkPixels > 0 && (!expected.ink || isDeepStrictEqual(raster.inkBounds, expected.ink));
        }),
      groundedRecommendation: report?.recommendation?.action === expected.action &&
        expected.evidenceTerms.every(term => rationale.includes(term.toLowerCase())),
      protectedHeads: before.mainEventId === after.mainEventId && (allowWorkingHeadChange || isDeepStrictEqual(before.workingHead, after.workingHead)),
    };
    return { passed: Object.values(checks).every(Boolean), contextId, caseId, goal, checks, selection, documents: snapshot, revision, binding,
      observations: { layouts: reads, text: textReads, textProbes, rendered: retained } };
  }

  async function reference() {
    const unreadObservationRejected = !(await verifyObserved()).passed;
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
    const verified = await verifyEvidence(outcome);
    const nativeVerified = await verifyObserved();
    const observerSlotValidated=(await verify(outcome,referenceObserver(outcome))).passed;
    const copiedObservations = observedEvidence();
    copiedObservations.observations.text.length = 0;
    const nativeObservationsRetained = observedEvidence().observations.text.length === textReads.length;
    const wrong: PdfGoalReport = { ...outcome, selection: { ...choice, document: `./${choice.document}` },
      recommendation: { action: "needs-review", rationale: "Unverified." } };
    const negative = await verifyEvidence(wrong);
    const checks = { ...verified.checks, independentNativeObservations: nativeVerified.passed, observerSlotValidated, unreadObservationRejected, nativeObservationsRetained, aliasRejected, rejectsUnverifiedReport: !negative.passed };
    return {outcome,verification:assessSemanticOutcome({...verified,checks},pdfOutcomeContract(["independentNativeObservations","observerSlotValidated","unreadObservationRejected","nativeObservationsRetained","aliasRejected","rejectsUnverifiedReport"]))};
  }

    function pdfOutcomeContract(extraEffects:readonly string[]=[]) {
    return {effects:{checks:["originalFiles","protectedHeads",...extraEffects],rationale:"Original PDF bytes, native selection/read/layout/raster observations and protected VCS head are independent application facts."},
      returnedValue:{checks:["exactSelection","textEvidence","layoutEvidence","renderedEvidence","groundedRecommendation"],required:true,rationale:"The user asks for PDF text, layout and rendering findings with exact citations, rather than only a side effect."},
      incidentalValues:{checks:[],rationale:"A known wrong requested PDF answer is bound to its actual captured source and value."}};
  }
  async function verify(value:unknown,invocation?:InvocationObservations,options:{allowWorkingHeadChange?:boolean}={}) {
    const report=await verifyEvidence(value,options),native=await verifyObserved(options);
    return assessObservedApplicationOutcome({...report,checks:{...report.checks,independentNativeObservations:native.passed}},pdfOutcomeContract(["independentNativeObservations"]),value,invocation);
  }
    return { goal, services, verify, verifyObserved, observedEvidence, attestCitations, reference, qualify: async () => (await reference()).verification };
}
