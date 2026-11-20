import { requireAssignedWorld } from "./assigned-world.js";
import { isDeepStrictEqual } from "node:util";
import { sha256Hex } from "@vibestudio/content-addressing";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { extensions } from "@workspace/runtime";
import type { PdfArtifact, PdfIngestResult } from "../../extensions/pdf-ingest/pdf/types.js";
import type { MediaImportReport, MediaImportRequest } from "../media-and-import-review/types.js";
import { packetFromStreams } from "./pdf-intake-managed.js";
import { pdfMediaWorlds } from "./pdf-media-worlds.js";

type Input = { contextId: string; caseId: string };
const pdfExtension = "@workspace-extensions/pdf-ingest";

export async function prepareManagedPdfMedia(input: Input) {
  const world = requireAssignedWorld(pdfMediaWorlds, input.caseId, "Unknown assigned PDF media case");
  const bytes = new TextEncoder().encode(packetFromStreams(world.pages.map((line) =>
    line ? `BT /F1 12 Tf 24 170 Td (${line}) Tj ET\n` : "q Q\n",
  )));
  const digest = sha256Hex(bytes);
  const native = await extensions.invoke(pdfExtension, "ingest", [bytes, {
    pages: [...world.extracted], preserveLayout: true, ocrFallback: false,
    pageImages: world.images ? "always" : "never",
  }]) as PdfIngestResult;
  const evidence = {
    id: crypto.randomUUID(), digest: native.document.digest, pageCount: native.document.pageCount,
    encrypted: native.document.encrypted, selectedPages: native.pages.map(({ pageNumber }) => pageNumber),
    pages: native.pages.map(({ pageNumber, extractionMethod, lines, imageArtifactId, warnings }) => ({
      pageNumber, extractionMethod,
      lines: lines.map(({ text, bbox, source, confidence }) => ({ text, bbox, source, confidence })),
      imageArtifactId: imageArtifactId ?? null, warnings,
    })),
    engines: native.engines.map(({ id, available, bundled }) => ({ id, available, bundled })),
  };
  const request: MediaImportRequest = {
    goal: world.goal, checks: ["pdf"], pdf: {
      digest, requestedPages: [...world.requested], need: world.need, minimumOcrConfidence: null, evidence,
    }, speech: null, git: null,
  };
  async function verify(report: MediaImportReport | null) {
    const images = await Promise.all(native.pages.flatMap((page) => {
      if (!page.imageArtifactId) return [];
      return [extensions.invoke(pdfExtension, "readArtifact", [page.imageArtifactId]).then((value) => {
        const artifact = value as PdfArtifact;
        const { data } = artifact;
        if (!(data instanceof Uint8Array)) {
          const shape = data && typeof data === "object" ? Object.keys(data).slice(0, 4) : [];
          throw new Error(`PDF artifact readback lost its byte type: ${Object.prototype.toString.call(data)}, ${shape.join(",")}`);
        }
        return {
          page: page.pageNumber, id: artifact.artifactId,
          digest: artifact.digest, expectedDigest: page.imageDigest,
          bytes: data.length, png: artifact.mimeType === "image/png" &&
            isDeepStrictEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]),
          integrity: page.imageArtifactId === artifact.artifactId && artifact.digest === sha256Hex(data),
        };
      })];
    }));
    const checks = {
      source: evidence.digest === digest && evidence.pageCount === world.pages.length && !evidence.encrypted &&
        evidence.engines.some(({ id, available, bundled }) => id === "pdfjs" && available && bundled),
      pages: isDeepStrictEqual(evidence.selectedPages, [...world.extracted]) && evidence.pages.every((page) => {
        const text = world.pages[page.pageNumber - 1];
        return text ? page.extractionMethod === "embedded-text" && page.lines.length === 1 &&
          page.lines[0]!.text === text && page.lines[0]!.bbox[2]! > 0 && page.lines[0]!.bbox[3]! > 0
          : page.extractionMethod === "none" && page.lines.length === 0;
      }),
      artifact: world.images ? images.length === world.extracted.length &&
        images.every((image) => image.integrity && image.png && image.bytes > 8 && image.digest === image.expectedDigest)
        : images.length === 0,
      report: report?.findings?.length === 1 && report.findings[0]?.check === "pdf" &&
        report.findings[0].disposition === world.disposition && report.findings[0].transcript === null &&
        typeof report.findings[0].detail === "string" && !!report.findings[0].detail.trim() &&
        isDeepStrictEqual(report.findings[0].evidenceIds, [evidence.id]),
    };
    return { ...input, request, images, checks, passed: Object.values(checks).every(Boolean) };
  }
  const qualify = () => verify({
    findings: [{ check: "pdf", disposition: world.disposition, transcript: null, detail: world.goal, evidenceIds: [evidence.id] }],
  });
  return { request, services: {}, verify, qualify };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedPdfMedia>>;
export interface PdfMediaReceiver {
  runPdfMediaTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyPdfMedia(input: Input): ReturnType<Prepared["qualify"]>;
}
export const pdfMediaMethods = createReceiverRpcMethods<PdfMediaReceiver>([
  "runPdfMediaTeacher", "qualifyPdfMedia",
]);
