import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { fs, rpc, vcs } from "@workspace/runtime";
import { prepareManagedExtensionRelease } from "./extension-release-managed.js";
import { prepareManagedAuthorityReview } from "./authority-review-managed.js";
import {
  bindManagedScratchHandoff,
  materializeScratchSources,
  planScratchHandoff,
  referenceScratchHandoff,
  verifyManagedScratchHandoff,
} from "./scratch-handoff-managed.js";
import {
  managedReleaseReviewHandoffWorlds,
  releaseReviewHandoffWork,
} from "./release-review-handoff-worlds.js";
import type { ScratchHandoffWorld } from "./scratch-handoff-worlds.js";

export async function prepareReleaseReviewHandoff(
  contextId: string,
  caseId: string,
) {
  const selected = managedReleaseReviewHandoffWorlds.find(
    ({ id }) => id === caseId,
  );
  if (!selected) throw new Error("Unknown release review handoff");
  const extension = await prepareManagedExtensionRelease(
    contextId,
    selected.extension,
  );
  const authority = prepareManagedAuthorityReview(
    contextId,
    selected.authority,
  );
  const world: ScratchHandoffWorld = {
    id: caseId,
    group: "release-review",
    goal: "Stage an exact handoff quoting the extension and authority evidence.",
    questions: [
      "What is the disposition of the extension source and active runtime?",
      "What is the authority outcome and which operations were held?",
    ],
    sources: { extension: null, authority: null },
    status: "staged",
    evidence: [[["extension", 1, 2]], [["authority", 1, 2]]],
  };
  const planned = await planScratchHandoff(fs, vcs, world);
  const scratch = bindManagedScratchHandoff(fs, rpc, planned.request);
  let transferred:
    | {
        seeded: typeof planned;
        sources: Record<string, string>;
      }
    | undefined;
  let transferring: Promise<typeof transferred> | undefined;
  const readIds = new Set<string>();

  async function transfer() {
    const source = extension.reference();
    const scope = authority.reference();
    if (!source || !authority.verify(scope).passed) return;
    const release = await extension.verify(source);
    if (!release.passed) return;
    const sources = {
      extension:
        `Source disposition: ${source.source.disposition}; working tree ${source.source.observation.workingTree}; published tree ${source.source.observation.publishedTree}.\n` +
        `Runtime disposition: ${source.runtime.disposition}; active version ${source.runtime.observation.activeEv ?? "none"}.\n`,
      authority: `Authority disposition: ${scope.status}.\nHeld operations: ${scope.held.join(", ") || "none"}.\n`,
    };
    const seeded = { ...planned, world: { ...world, sources } };
    await materializeScratchSources(fs, seeded);
    return (transferred = { seeded, sources });
  }

  const services = {
    ...extension.services,
    assignedAuthorityRead: {
      async preflight(operationId: string) {
        if (!extension.reference())
          throw new Error(
            "Read the assigned extension release before authority preflight",
          );
        return authority.services.assignedAuthorityRead.preflight(operationId);
      },
    },
    scratchHandoffRead: {
      async read(id: string) {
        if (
          !Object.hasOwn(world.sources, id) ||
          !extension.reference() ||
          !authority.verify(authority.reference()).passed
        )
          return null;
        if (!(await (transferring ??= transfer()))) return null;
        const read = await scratch.scratchHandoffRead.read(id);
        if (read) readIds.add(id);
        return read;
      },
    },
    scratchHandoffWrite: {
      async stage(body: string) {
        if (!transferred || readIds.size !== planned.request.sources.length)
          return null;
        return scratch.scratchHandoffWrite.stage(body);
      },
    },
  };
  const request = {
    goal:
      selected.goal +
      " Complete the extension review, then authority preflight, then the scratch handoff. Carry the approved runtime observation and any holds into the handoff.",
    work: [
      { ...releaseReviewHandoffWork[0], input: extension.request },
      { ...releaseReviewHandoffWork[1], input: authority.request },
      { ...releaseReviewHandoffWork[2], input: planned.request },
    ],
  };

  async function verify(value: unknown) {
    const report = value as {
      results?: { domain: string; operation: string; report: unknown }[];
      remaining?: unknown[];
    } | null;
    const release = await extension.verify(
      (report?.results?.[0]?.report ?? null) as Parameters<
        typeof extension.verify
      >[0],
    );
    const scope = authority.verify(
      (report?.results?.[1]?.report ?? null) as Parameters<
        typeof authority.verify
      >[0],
    );
    const handoff = transferred
      ? await verifyManagedScratchHandoff(
          fs,
          vcs,
          rpc,
          transferred.seeded,
          report?.results?.[2]?.report,
        )
      : null;
    const sources = transferred?.sources ?? {};
    const sourceDigests = Object.entries(sources).map(([id, content]) => ({
      id,
      sha256: sha256HexSyncText(content),
    }));
    const checks = {
      release: release.passed,
      scope: scope.passed,
      handoff: handoff?.passed === true,
      transfer:
        sourceDigests.length === planned.request.sources.length &&
        sourceDigests.every(({ id }) => readIds.has(id)),
      order:
        report?.results?.length === releaseReviewHandoffWork.length &&
        report.remaining?.length === 0 &&
        report.results.every(
          ({ domain, operation }, index) =>
            domain === releaseReviewHandoffWork[index]?.domain &&
            operation === releaseReviewHandoffWork[index]?.operation,
        ),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      caseId,
      contextId,
      checks,
      request,
      release,
      scope,
      handoff,
      sourceDigests,
      sources,
    };
  }

  async function qualify() {
    let earlyAuthorityDenied = false;
    try {
      await services.assignedAuthorityRead.preflight(
        authority.request.operations[0]!.id,
      );
    } catch (error) {
      earlyAuthorityDenied =
        error instanceof Error &&
        /extension release before authority/.test(error.message);
    }
    const earlyReadDenied =
      (await services.scratchHandoffRead.read("extension")) === null;
    await services.extensionReleaseRead.source(extension.request.operationId);
    const sourceOnlyReadDenied =
      (await services.scratchHandoffRead.read("extension")) === null;
    await services.extensionReleaseRead.runtime(extension.request.operationId);
    const earlyWriteDenied =
      (await services.scratchHandoffWrite.stage("{}")) === null;
    const partialAuthorityReads: { operationId: string; denied: boolean }[] = [];
    const operations = authority.request.operations;
    for (const [index, { id }] of operations.entries()) {
      await services.assignedAuthorityRead.preflight(id);
      if (index + 1 < operations.length)
        partialAuthorityReads.push({ operationId: id,
          denied: (await services.scratchHandoffRead.read("authority")) === null });
    }
    const materialized = await services.scratchHandoffRead.read("extension");
    if (!materialized || !transferred)
      throw new Error("Verified evidence did not reach scratch");
    const partialScratchWriteDenied =
      (await services.scratchHandoffWrite.stage("{}")) === null;
    const diary = await referenceScratchHandoff(transferred.seeded, services);
    const verification = await verify({
      results: [
        { ...releaseReviewHandoffWork[0], report: extension.reference() },
        { ...releaseReviewHandoffWork[1], report: authority.reference() },
        { ...releaseReviewHandoffWork[2], report: diary },
      ],
      remaining: [],
    });
    return {
      verification,
      earlyReadDenied,
      earlyWriteDenied,
      earlyAuthorityDenied,
      sourceOnlyReadDenied,
      partialAuthorityReads,
      partialScratchWriteDenied,
    };
  }

  return { request, services, verify, qualify };
}
