import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import {
  prepareManagedPdf,
  referencePdfIntake,
  verifyManagedPdf,
} from "./pdf-intake-managed.js";
import {
  managedPdfExpectation,
  managedPdfHandoffWorlds,
} from "./pdf-intake-worlds.js";
import type { ScratchHandoffWorld } from "./scratch-handoff-worlds.js";
import {
  bindManagedScratchHandoff,
  materializeScratchSources,
  planScratchHandoff,
  referenceScratchHandoff,
  verifyManagedScratchHandoff,
} from "./scratch-handoff-managed.js";

type Ports = Parameters<typeof prepareManagedPdf>[0];
const pageId = (page: number) => `page-${page}`;

export async function prepareManagedPdfHandoff(ports: Ports, caseId: string) {
  const scenario = managedPdfHandoffWorlds.find(({ pdf }) => pdf === caseId);
  if (!scenario) throw new Error("Unknown managed PDF handoff");
  const pdf = await prepareManagedPdf(ports, scenario.pdf);
  const { readPages, attemptedBatches } = managedPdfExpectation(pdf.world);
  if (readPages.length === 0) throw new Error("PDF handoff requires evidence");
  const lines = (page: number) => pdf.world.sheets[page - 1]!;
  const evidence = pdf.world.claims.map(({ evidence }) =>
    evidence.map(({ page, line, quote }): [string, number, number] => {
      const index = line ?? lines(page).indexOf(quote);
      if (
        !readPages.includes(page) ||
        index < 0 ||
        lines(page)[index] !== quote
      )
        throw new Error("Handoff evidence is outside the assigned PDF prefix");
      return [pageId(page), index + 1, index + 1];
    }),
  );
  const unanswered = evidence.flatMap((items, index) =>
    items.length ? [] : [index],
  );
  const world = {
    id: caseId,
    group: "pdf-to-scratch",
    goal: `${scenario.goal} Quote the original extracted lines. If any question remains unsupported, report it and withhold the artifact.`,
    questions: pdf.world.claims.map(({ question }) => question),
    sources: Object.fromEntries(
      readPages.map((page) => [pageId(page), lines(page).join("\n") + "\n"]),
    ),
    ...(unanswered.length
      ? { status: "unanswered", unanswered }
      : { status: "staged", evidence }),
  } satisfies ScratchHandoffWorld;
  const scratch = await planScratchHandoff(ports.fs, ports.vcs, world);
  const binding = bindManagedScratchHandoff(
    ports.fs,
    ports.rpc,
    scratch.request,
  );
  const readIds = new Set<string>();
  let materialized: Promise<void> | undefined;
  let transferred: Record<string, string> | undefined;
  async function openEvidence() {
    const pages = pdf.verifiedBatches.flatMap((receipt) => receipt.pages);
    if (
      !isDeepStrictEqual(pdf.readAttempts, attemptedBatches) ||
      pdf.faultDelivered() !== Boolean(pdf.world.fault) ||
      !isDeepStrictEqual(
        pages.map(({ number }) => number).sort((a, b) => a - b),
        [...readPages].sort((a, b) => a - b),
      ) ||
      pdf.verifiedBatches.some(({ digest }) => digest !== pdf.digest)
    )
      return false;
    const indexed = new Map(pages.map((page) => [page.number, page.lines]));
    const sources = Object.fromEntries(
      readPages.map((page) => [
        pageId(page),
        indexed
          .get(page)!
          .map(({ text }) => text)
          .join("\n") + "\n",
      ]),
    );
    if (!isDeepStrictEqual(sources, world.sources)) return false;
    await (materialized ??= materializeScratchSources(ports.fs, {
      ...scratch,
      world: { ...world, sources },
    }));
    transferred = sources;
    return true;
  }
  const scratchBindings = {
    scratchHandoffRead: {
      async read(id: string) {
        if (!Object.hasOwn(world.sources, id) || !(await openEvidence()))
          return null;
        const observed = await binding.scratchHandoffRead.read(id);
        if (observed) readIds.add(id);
        return observed;
      },
    },
    scratchHandoffWrite: {
      async stage(body: string) {
        if (!transferred || readIds.size !== scratch.request.sources.length)
          return null;
        return binding.scratchHandoffWrite.stage(body);
      },
    },
  };
  return {
    pdf,
    scratch,
    readIds,
    transferred: () => transferred,
    scratchBindings,
    services: { ...pdf.bindings, ...scratchBindings },
    request: {
      goal: `${scenario.goal} First run PDF intake. Then run the evidence handoff on the verified pages, even if the intake leaves some questions open. The handoff must report whether the available evidence is sufficient to stage an artifact.`,
      work: [
        {
          kind: "domain",
          domain: "pdfIntake",
          operation: "extractPdfEvidence",
          input: pdf.request,
        },
        {
          kind: "domain",
          domain: "scratchHandoff",
          operation: "assembleHandoff",
          input: scratch.request,
        },
      ],
    },
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedPdfHandoff>>;

export async function verifyManagedPdfHandoff(
  ports: Ports,
  prepared: Prepared,
  value: unknown,
) {
  const report = value as { results?: { report: unknown }[] } | null;
  const pdf = await verifyManagedPdf(
    ports,
    prepared.pdf,
    report?.results?.[0]?.report,
  );
  const scratch = await verifyManagedScratchHandoff(
    ports.fs,
    ports.vcs,
    ports.rpc,
    prepared.scratch,
    report?.results?.[1]?.report,
  );
  const transferred = prepared.transferred();
  const sourceDigests = prepared.scratch.request.sources.map(({ id }) => ({
    id,
    sha256: sha256HexSyncText(transferred?.[id] ?? ""),
  }));
  const checks = {
    exactPdf: pdf.passed,
    exactHandoff: scratch.passed,
    verifiedTransfer:
      isDeepStrictEqual(transferred, prepared.scratch.world.sources) &&
      sourceDigests.every(({ id }) => prepared.readIds.has(id)),
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    pdf,
    scratch,
    sourceDigests,
  };
}

export async function qualifyManagedPdfHandoff(ports: Ports, caseId: string) {
  const prepared = await prepareManagedPdfHandoff(ports, caseId);
  const earlyRead = await prepared.scratchBindings.scratchHandoffRead.read(
    prepared.scratch.request.sources[0]!.id,
  );
  const earlyWrite =
    await prepared.scratchBindings.scratchHandoffWrite.stage('{"answers":[]}');
  const pdf = await referencePdfIntake(prepared.pdf);
  const scratch = await referenceScratchHandoff(
    prepared.scratch,
    prepared.scratchBindings,
  );
  return {
    verification: await verifyManagedPdfHandoff(ports, prepared, {
      results: [{ report: pdf }, { report: scratch }],
    }),
    earlyReadDenied: earlyRead === null,
    earlyWriteDenied: earlyWrite === null,
  };
}
