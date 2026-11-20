import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { fs, rpc, vcs } from "@workspace/runtime";
import {
  bindManagedScratchHandoff,
  materializeScratchSources,
  planScratchHandoff,
  referenceScratchHandoff,
  verifyManagedScratchHandoff,
} from "./scratch-handoff-managed.js";
import type { ScratchHandoffWorld } from "./scratch-handoff-worlds.js";
import { prepareManagedResearchIntake } from "./web-brief-managed.js";
import {
  managedResearchHandoffWorlds,
  managedResearchIntakeWorlds,
  researchHandoffWork,
} from "./web-brief-worlds.js";

type Input = { contextId: string; caseId: string };

export async function prepareManagedResearchHandoff({ contextId, caseId }: Input) {
  const assignment = managedResearchHandoffWorlds.find(({ id }) => id === caseId);
  const source = managedResearchIntakeWorlds.find(({ id }) => id === assignment?.intake);
  if (!assignment || !source) throw new Error("Unknown research handoff assignment");
  const staged = assignment.status === "staged";

  const intake = prepareManagedResearchIntake(contextId, source.id);
  const sourceIds = source.sources.map((_, index) => `source-${index + 1}`);
  const world: ScratchHandoffWorld = {
    id: caseId,
    group: "verified-research-to-scratch",
    goal: assignment.goal,
    questions: [assignment.question],
    sources: Object.fromEntries(sourceIds.map((id) => [id, null])),
    ...(staged
      ? { status: "staged", evidence: [[[sourceIds[0]!, 1, 1]]] }
      : { status: "unanswered", unanswered: [0] }),
  };
  const plan = await planScratchHandoff(fs, vcs, world);
  const scratch = bindManagedScratchHandoff(fs, rpc, plan.request);
  const reads = new Set<string>();
  let writeAttempts = 0;
  let materializing: Promise<typeof plan> | undefined;

  async function transfer() {
    const reference = intake.reference();
    const { passed, projection } = intake.verify(reference);
    if (!passed || !projection) return null;
    const cited = reference?.findings[0]?.citations[0];
    return (materializing ??= (async () => {
      const sources = Object.fromEntries(projection.pages.map((page) => {
        const extract = cited?.sourceId === page.id
          ? cited.quote
          : page.head.replace(/\s+/gu, " ").trim().slice(0, 300);
        return [page.id, `${page.finalUrl} — ${extract}\nCached digest: ${page.digest}\n`];
      }));
      const seeded = { ...plan, world: { ...world, sources } };
      await materializeScratchSources(fs, seeded);
      return seeded;
    })());
  }

  const scratchBindings = {
    scratchHandoffRead: {
      async read(id: string) {
        if (!sourceIds.includes(id) || !(await transfer())) return null;
        const result = await scratch.scratchHandoffRead.read(id);
        if (result) reads.add(id);
        return result;
      },
    },
    scratchHandoffWrite: {
      async stage(body: string) {
        if (!materializing || reads.size !== sourceIds.length) return null;
        writeAttempts++;
        if (!staged) return null;
        return scratch.scratchHandoffWrite.stage(body);
      },
    },
  };
  const request = {
    goal: `${assignment.goal} First run the research intake, then assemble the evidence handoff.`,
    work: [
      { ...researchHandoffWork[0], input: intake.request },
      { ...researchHandoffWork[1], input: plan.request },
    ],
  };
  async function verify(value: unknown) {
    const report = value as { results?: { report: unknown }[]; remaining?: string[] } | null;
    const research = intake.verify((report?.results?.[0]?.report ?? null) as Parameters<typeof intake.verify>[0]);
    const seeded = await materializing;
    const handoff = seeded
      ? await verifyManagedScratchHandoff(fs, vcs, rpc, seeded, report?.results?.[1]?.report)
      : null;
    const sources = seeded?.world.sources ?? {};
    const sourceDigests = Object.entries(sources).map(([id, content]) =>
      ({ id, sha256: sha256HexSyncText(content!) })
    );
    const checks = {
      research: research.passed,
      handoff: handoff?.passed === true,
      transfer: sourceDigests.length === sourceIds.length && sourceIds.every((id) => reads.has(id)),
      exactWriteCount: writeAttempts === Number(staged),
    };
    return { contextId, caseId, request, research, handoff, sources, sourceDigests, checks,
      passed: Object.values(checks).every(Boolean) };
  }
  return {
    request,
    services: { ...intake.services, ...scratchBindings },
    verify,
    async qualify() {
      const earlyRead = await scratchBindings.scratchHandoffRead.read(sourceIds[0]!);
      const earlyWrite = await scratchBindings.scratchHandoffWrite.stage("{}");
      await intake.services.assignedResearchIntake.read(intake.request.operationId);
      const research = intake.reference();
      const seeded = await transfer();
      if (!seeded) throw new Error("Verified public receipts are unavailable for the handoff");
      const handoff = await referenceScratchHandoff(seeded, scratchBindings);
      return {
        verification: await verify({ results: [{ report: research }, { report: handoff }] }),
        earlyReadDenied: earlyRead === null,
        earlyWriteDenied: earlyWrite === null,
      };
    },
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedResearchHandoff>>;
export interface ManagedResearchHandoffReceiver {
  runManagedResearchHandoffTeacher(input: Input & { executorModel: string }): Promise<{
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedResearchHandoff(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedResearchHandoffMethods = createReceiverRpcMethods<ManagedResearchHandoffReceiver>([
  "runManagedResearchHandoffTeacher",
  "qualifyManagedResearchHandoff",
]);
