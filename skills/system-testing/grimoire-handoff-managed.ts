import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { fs, rpc, vcs } from "@workspace/runtime";
import {
  grimoireHandoffWork,
  projectGardenHandoff,
  type managedGrimoireWorlds,
} from "./grimoire-worlds.js";
import {
  bindManagedScratchHandoff,
  materializeScratchSources,
  planScratchHandoff,
  referenceScratchHandoff,
  verifyManagedScratchHandoff,
} from "./scratch-handoff-managed.js";
import type { ScratchHandoffWorld } from "./scratch-handoff-worlds.js";

type World = (typeof managedGrimoireWorlds)[number];
type GardenReport = {
  components?: Parameters<typeof projectGardenHandoff>[1];
};
type GardenReview<Report extends GardenReport> = {
  services: { gardenRead: { observe(): Promise<unknown> } };
  expected(): Report;
  verify(report: Report | null): {
    passed: boolean;
    checks: {
      persistedClock: boolean;
      persistedVisits: boolean;
      assignedClaims: boolean;
      readOwnedGarden: boolean;
    };
    expected: Report | null;
  };
};

export async function prepareGrimoireHandoff<Report extends GardenReport>(
  world: World,
  garden: GardenReview<Report>,
) {
  if (!world.handoff) throw new Error("Missing garden handoff assignment");
  const input: ScratchHandoffWorld = {
    id: world.id,
    group: "grimoire-caretaker-handoff",
    goal: "Leave exact evidence for each caretaker question using the assigned garden source.",
    questions: world.handoff.questions,
    sources: { garden: null },
    status: "staged",
    evidence: world.handoff.questions.map((_, index) => [
      ["garden", index + 1, index + 1],
    ]),
  };
  const planned = await planScratchHandoff(fs, vcs, input);
  const scratch = bindManagedScratchHandoff(fs, rpc, planned.request);
  let transfer: Promise<typeof planned> | undefined;
  let readSource: string | undefined;
  const services = {
    ...garden.services,
    scratchHandoffRead: {
      async read(id: string) {
        if (id !== "garden") return null;
        const { checks, expected } = garden.verify(null);
        const {
          persistedClock,
          persistedVisits,
          assignedClaims,
          readOwnedGarden,
        } = checks;
        if (
          !persistedClock ||
          !persistedVisits ||
          !assignedClaims ||
          !readOwnedGarden ||
          expected?.components?.length !== input.questions.length
        )
          return null;
        const source = projectGardenHandoff(
          world.request.claims,
          expected.components,
        );
        transfer ??= (async () => {
          const seeded = {
            ...planned,
            world: { ...input, sources: { garden: source } },
          };
          await materializeScratchSources(fs, seeded);
          return seeded;
        })();
        await transfer;
        const read = await scratch.scratchHandoffRead.read(id);
        if (read) readSource = source;
        return read;
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
      world.request.goal +
      " Review the committed garden first, then stage the caretaker handoff from that evidence.",
    work: [
      { ...grimoireHandoffWork[0], input: world.request },
      { ...grimoireHandoffWork[1], input: planned.request },
    ],
  };

  async function verify(value: unknown) {
    const report = value as { results?: { report: unknown }[] } | null;
    const gardenResult = garden.verify(
      (report?.results?.[0]?.report ?? null) as Report | null,
    );
    const handoff = transfer
      ? await verifyManagedScratchHandoff(
          fs,
          vcs,
          rpc,
          await transfer,
          report?.results?.[1]?.report,
        )
      : null;
    const checks = {
      exactGarden: gardenResult.passed,
      exactHandoff: handoff?.passed === true,
      verifiedTransfer: readSource !== undefined,
    };
    return {
      passed: Object.values(checks).every(Boolean),
      garden: gardenResult,
      handoff,
      request,
      checks,
      sourceSha256: readSource ? sha256HexSyncText(readSource) : null,
    };
  }

  return {
    request,
    services,
    verify,
    async qualify() {
      const earlyRead = await services.scratchHandoffRead.read("garden");
      await services.gardenRead.observe();
      const earlyWrite =
        await services.scratchHandoffWrite.stage('{"answers":[]}');
      const foreignSource =
        await services.scratchHandoffRead.read("other-garden");
      const source = await services.scratchHandoffRead.read("garden");
      if (!source || !transfer)
        throw new Error("Missing verified garden source");
      const handoff = await referenceScratchHandoff(await transfer, services);
      return {
        verification: await verify({
          results: [{ report: garden.expected() }, { report: handoff }],
        }),
        rejectedAlteredEvidence:
          earlyRead === null && earlyWrite === null && foreignSource === null,
      };
    },
  };
}
