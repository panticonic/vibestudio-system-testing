import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { fs, rpc, vcs } from "@workspace/runtime";
import {
  driveCheckpointHandoffWork,
  projectDriveCheckpointSource,
} from "./drive-checkpoint-worlds.js";
import {
  bindManagedScratchHandoff,
  materializeScratchSources,
  planScratchHandoff,
  referenceScratchHandoff,
  verifyManagedScratchHandoff,
} from "./scratch-handoff-managed.js";
import type { ScratchHandoffWorld } from "./scratch-handoff-worlds.js";

type Evidence = Parameters<typeof projectDriveCheckpointSource>[0] & {
  passed: boolean;
  checks: { exactTransport: boolean; exactRead: boolean; exactWrite: boolean };
};
type Drive<Report, Request extends { goal: string }> = {
  request: Request;
  services: Record<string, object>;
  verify(report: Report | null): Promise<Evidence>;
  qualify(): Promise<{ earlyRejected: boolean; report: Report }>;
};

export async function prepareDriveCheckpointHandoff<
  Report,
  Request extends { goal: string },
>(drive: Drive<Report, Request>, caseId: string) {
  const input: ScratchHandoffWorld = {
    id: caseId,
    group: "drive-checkpoint-handoff",
    goal: "Leave the verified Drive cursor and the outcome of the terminal candidate for the next shift.",
    questions: [
      "Which cursor is saved for the next shift?",
      "What terminal cursor did this run observe, and what happened to its write?",
    ],
    sources: { checkpoint: null },
    status: "staged",
    evidence: [[["checkpoint", 1, 1]], [["checkpoint", 2, 3]]],
  };
  const planned = await planScratchHandoff(fs, vcs, input);
  const scratch = bindManagedScratchHandoff(fs, rpc, planned.request);
  let transfer: Promise<typeof planned> | undefined;
  let readSource = false;
  async function materialize() {
    const evidence = await drive.verify(null);
    if (
      !evidence.checks.exactTransport ||
      !evidence.checks.exactRead ||
      !evidence.checks.exactWrite
    )
      return null;
    return (transfer ??= (async () => {
      const seeded = {
        ...planned,
        world: {
          ...input,
          sources: { checkpoint: projectDriveCheckpointSource(evidence) },
        },
      };
      await materializeScratchSources(fs, seeded);
      return seeded;
    })());
  }
  const services = {
    ...drive.services,
    scratchHandoffRead: {
      async read(id: string) {
        if (id !== "checkpoint" || !(await materialize())) return null;
        const text = await scratch.scratchHandoffRead.read(id);
        if (text) readSource = true;
        return text;
      },
    },
    scratchHandoffWrite: {
      async stage(body: string) {
        return readSource ? scratch.scratchHandoffWrite.stage(body) : null;
      },
    },
  };
  const request = {
    goal:
      drive.request.goal +
      " Complete the Drive review first. Stage the handoff using the verified saved cursor even if the candidate was stale.",
    work: [
      { ...driveCheckpointHandoffWork[0], input: drive.request },
      { ...driveCheckpointHandoffWork[1], input: planned.request },
    ],
  };
  async function verify(value: unknown) {
    const results = (value as { results?: { report: unknown }[] } | null)
      ?.results;
    const checkpoint = await drive.verify(
      (results?.[0]?.report ?? null) as Report | null,
    );
    const seeded = transfer && (await transfer);
    const handoff = seeded
      ? await verifyManagedScratchHandoff(
          fs,
          vcs,
          rpc,
          seeded,
          results?.[1]?.report,
        )
      : null;
    const source = seeded?.world.sources.checkpoint;
    const checks = {
      exactCheckpoint: checkpoint.passed,
      exactHandoff: handoff?.passed === true,
      verifiedTransfer:
        readSource && source === projectDriveCheckpointSource(checkpoint),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      request,
      caseId,
      checkpoint,
      handoff,
      sourceSha256: source ? sha256HexSyncText(source) : null,
      checks,
    };
  }
  return {
    request,
    services,
    verify,
    async qualify() {
      const earlyRead = await services.scratchHandoffRead.read("checkpoint");
      const earlyWrite =
        await services.scratchHandoffWrite.stage('{"answers":[]}');
      const driveResult = await drive.qualify();
      const unassigned = await services.scratchHandoffRead.read("other-cursor");
      const seeded = await materialize();
      if (!seeded)
        throw new Error("The verified Drive cursor did not reach the handoff");
      const handoff = await referenceScratchHandoff(seeded, services);
      return {
        earlyRejected:
          driveResult.earlyRejected &&
          earlyRead === null &&
          earlyWrite === null &&
          unassigned === null,
        verification: await verify({
          results: [{ report: driveResult.report }, { report: handoff }],
        }),
      };
    },
  };
}
