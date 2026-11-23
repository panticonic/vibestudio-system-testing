import { isDeepStrictEqual } from "node:util";
import { sha256Hex } from "@vibestudio/content-addressing";
import { extensions } from "@workspace/runtime";
import { bindPdfLayout } from "@workspace-skills/pdf-intake-bindings/layout";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { packetFromStreams } from "./pdf-intake-managed.js";
import { managedPdfLayoutWorlds } from "./pdf-layout-worlds.js";

type Engine = Parameters<typeof bindPdfLayout>[0];
type Services = ReturnType<typeof bindPdfLayout>["services"];
type Page = Awaited<ReturnType<Services["pdfLayoutRead"]["inspect"]>>;
type Entry = Page["rows"][number][number] & { row: number; fragment: number };
type Report = {
  digest: string;
  pageNumber: number;
  layout: { kind: string; basis: string };
  reading: { status: string; entries: Entry[] };
};

export function prepareManagedPdfLayout(contextId: string, caseId: string) {
  const assigned = managedPdfLayoutWorlds.find(({ id }) => id === caseId);
  if (!assigned) throw new Error("Unknown assigned PDF layout case");
  const world = assigned;

  const commands = world.rows.flatMap((row, index) =>
    row.map(
      (text, column) =>
        `1 0 0 1 ${24 + column * 226} ${170 - index * 20} Tm (${text}) Tj`,
    ),
  );
  const bytes = new TextEncoder().encode(
    packetFromStreams([`BT /F1 12 Tf ${commands.join(" ")} ET\n`]),
  );
  const digest = sha256Hex(bytes);
  const bound = bindPdfLayout(
    {
      async ingest(data, options) {
        return (await extensions.invoke(
          "@workspace-extensions/pdf-ingest",
          "ingest",
          [data, options],
        )) as Awaited<ReturnType<Engine["ingest"]>>;
      },
    },
    world.goal,
    1,
    bytes,
  );

  let observed: Page | undefined;
  const services: Services = {
    pdfLayoutRead: {
      async inspect(id) {
        const result = await bound.services.pdfLayoutRead.inspect(id);
        observed = structuredClone(result);
        return result;
      },
    },
  };

  function expectedEntries(page: Page) {
    const entries = page.rows.flatMap((row, rowIndex) =>
      row.map((fragment, fragmentIndex) => ({
        row: rowIndex,
        fragment: fragmentIndex,
        ...fragment,
      })),
    );
    return world.order.map((text) =>
      entries.find((entry) => entry.text === text),
    );
  }

  function verify(report: Report | null) {
    const checks = {
      source:
        observed?.digest === digest &&
        observed.pageNumber === 1 &&
        observed.width === 500 &&
        observed.height === 200,
      geometry:
        !!observed &&
        isDeepStrictEqual(
          observed.rows.map((row) => row.map(({ text }) => text)),
          world.rows,
        ) &&
        observed.rows.every((row, index) =>
          row.every(
            ({ bounds }, column) =>
              bounds.length === 4 &&
              bounds[0] === 24 + column * 226 &&
              (bounds[1] ?? Number.NaN) < 34 + index * 20 &&
              (bounds[1] ?? Number.NaN) >= 16 + index * 20 &&
              (bounds[2] ?? Number.NaN) > 0 &&
              (bounds[3] ?? Number.NaN) > 0,
          ),
        ),
      reading:
        !!observed &&
        report?.digest === digest &&
        report.pageNumber === 1 &&
        report.layout.kind === world.kind &&
        !!report.layout.basis.trim() &&
        report.reading.status === "ordered" &&
        isDeepStrictEqual(report.reading.entries, expectedEntries(observed)),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId,
      caseId,
      request: bound.request,
      observed,
      checks,
    };
  }

  async function qualify() {
    let rejectsWrongPage = false;
    try {
      await services.pdfLayoutRead.inspect("some-other-pdf-assignment");
    } catch (error) {
      rejectsWrongPage =
        error instanceof Error && error.message.includes("assigned PDF page");
    }
    const page = await services.pdfLayoutRead.inspect(
      bound.request.operationId,
    );
    return {
      verification: verify({
        digest,
        pageNumber: 1,
        layout: {
          kind: world.kind,
          basis: "Compare the authored cells with their captured bounds.",
        },
        reading: {
          status: "ordered",
          entries: expectedEntries(page).filter(
            (item): item is Entry => !!item,
          ),
        },
      }),
      rejectsWrongPage,
    };
  }
  return { request: bound.request, services, verify, qualify };
}

type Prepared = ReturnType<typeof prepareManagedPdfLayout>;
type Input = { contextId: string; caseId: string };
export interface ManagedPdfLayoutReceiver {
  runManagedPdfLayoutTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyManagedPdfLayout(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedPdfLayoutMethods =
  createReceiverRpcMethods<ManagedPdfLayoutReceiver>([
    "runManagedPdfLayoutTeacher",
    "qualifyManagedPdfLayout",
  ]);
