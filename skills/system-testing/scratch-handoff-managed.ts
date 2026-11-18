import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type {
  RuntimeFs,
  VcsClient,
  rpc as RuntimeRpc,
} from "@workspace/runtime";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import { managedScratchWorlds } from "./scratch-handoff-worlds.js";

const scratchName = /^evidence-handoff-[a-f0-9]{32}$/u;
type World = (typeof managedScratchWorlds)[number];
type Report = {
  status: string;
  artifact: null | { path: string; bytes: number };
  missingSources: string[];
  unanswered: string[];
};

type ScratchRpc = Pick<typeof RuntimeRpc, "call">;

export function bindManagedScratchHandoff(
  fs: RuntimeFs,
  rpc: ScratchRpc,
  request: Seeded["request"],
) {
  return bindScratchHandoff(fs, request, (path, limit) =>
    readWorkspaceBytes(rpc, path, limit),
  );
}

async function readWorkspaceBytes(
  rpc: ScratchRpc,
  path: string,
  limit: number,
) {
  const slice = await rpc.call("main", mainRpcMethods["fs.readBytes"], [
    path,
    { offset: 0, limit },
  ]);
  const bytes = Uint8Array.from(atob(slice.base64), (character) =>
    character.charCodeAt(0),
  );
  if (
    slice.truncated ||
    slice.start !== 0 ||
    slice.end !== slice.totalBytes ||
    slice.totalBytes !== bytes.length ||
    bytes.length > limit
  ) {
    throw new Error("The workspace file exceeds the complete byte range.");
  }
  return bytes;
}

export async function seedScratchHandoff(
  fs: RuntimeFs,
  vcs: Pick<VcsClient, "status">,
  caseId: string,
) {
  const world = managedScratchWorlds.find((item) => item.id === caseId);
  if (!world) throw new Error(`Unknown managed scratch handoff: ${caseId}`);
  const initial = await vcs.status();
  const directory = await fs.mkdtemp("handoff-input");
  const sources = Object.keys(world.sources).map((id) => ({
    id,
    path: `${directory}/${id}.txt`,
  }));
  for (const { id, path } of sources) {
    const text = world.sources[id];
    if (text !== null && text !== undefined) await fs.writeFile(path, text);
  }

  return {
    world,
    directory,
    initial,
    outputEntries: (await fs.readdir("/.tmp")).filter((name) =>
      scratchName.test(name),
    ),
    request: { goal: world.goal, questions: [...world.questions], sources },
  };
}

type Seeded = Awaited<ReturnType<typeof seedScratchHandoff>>;
type StagedWorld = Extract<World, { status: "staged" }>;
function expectedAnswers(world: StagedWorld) {
  return world.questions.map((question, index) => ({
    question,
    evidence: world.evidence[index]!.map(([sourceId, firstLine, lastLine]) => ({
      sourceId,
      firstLine,
      lastLine,
      text: world.sources[sourceId]!.split(/\r?\n/u)
        .slice(firstLine - 1, lastLine)
        .join("\n"),
    })),
  }));
}

export async function verifyManagedScratchHandoff(
  fs: RuntimeFs,
  vcs: Pick<VcsClient, "status">,
  rpc: ScratchRpc,
  seeded: Seeded,
  reportValue: unknown,
) {
  const { world } = seeded;
  const report = reportValue as Report | null;
  const current = await vcs.status();
  const protectedUnchanged =
    current.mainEventId === seeded.initial.mainEventId &&
    isDeepStrictEqual(current.workingHead, seeded.initial.workingHead);
  const expectedIds = seeded.request.sources.filter(
    ({ id }) => world.sources[id] !== null,
  );
  const sourceEntries = await fs.readdir(seeded.directory);
  const received = await Promise.all(
    expectedIds.map(async ({ id, path }) => ({
      id,
      text: await fs.readFile(path, "utf8").catch(() => null),
    })),
  );
  const originalsUnchanged =
    sourceEntries.length === expectedIds.length &&
    received.every(({ id, text }) => text === world.sources[id]);
  const added = (await fs.readdir("/.tmp")).filter(
    (name) => scratchName.test(name) && !seeded.outputEntries.includes(name),
  );
  const missing = world.status === "source-unavailable" ? world.missing : [];
  const unanswered =
    world.status === "unanswered"
      ? world.unanswered.map((index) => world.questions[index]!)
      : [];
  const disposition =
    report?.status === world.status &&
    isDeepStrictEqual(report.missingSources, missing) &&
    isDeepStrictEqual(report.unanswered, unanswered);

  let exactReadback =
    world.status !== "staged" &&
    added.length === 0 &&
    report?.artifact === null;
  let artifact: { path: string; bytes: number; sha256: string } | null = null;
  if (world.status === "staged" && added.length === 1) {
    const directory = `/.tmp/${added[0]}`;
    const path = `${directory}/handoff.json`;
    const entries = await fs.readdir(directory).catch(() => []);
    const bytes = await readWorkspaceBytes(rpc, path, 64 * 1024).catch(
      () => null,
    );
    if (
      entries.length === 1 &&
      entries[0] === "handoff.json" &&
      bytes instanceof Uint8Array
    ) {
      try {
        const body = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
        artifact = {
          path,
          bytes: bytes.byteLength,
          sha256: sha256HexSyncText(body),
        };
        exactReadback =
          report?.artifact?.path === path &&
          report.artifact.bytes === artifact.bytes &&
          isDeepStrictEqual(JSON.parse(body), {
            answers: expectedAnswers(world),
          });
      } catch {
        // A non-JSON candidate fails exact evidence readback.
      }
    }
  }
  const checks = {
    protectedUnchanged,
    originalsUnchanged,
    disposition,
    exactReadback,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    expectedStatus: world.status,
    artifact,
    seedRevision: JSON.stringify(seeded.initial.workingHead),
    sourceIds: seeded.request.sources.map(({ id }) => id),
  };
}

/** Exercises the actual filesystem adapter without an executor model. */
export async function qualifyManagedScratchHandoff(
  fs: RuntimeFs,
  vcs: Pick<VcsClient, "status">,
  rpc: ScratchRpc,
  caseId: string,
  negative: boolean,
) {
  const seeded = await seedScratchHandoff(fs, vcs, caseId);
  const { world, request } = seeded;
  const binding = bindManagedScratchHandoff(fs, rpc, request);
  const sources = await Promise.all(
    request.sources.map(({ id }) => binding.scratchHandoffRead.read(id)),
  );
  const missingSources = request.sources
    .filter((_, index) => sources[index] === null)
    .map(({ id }) => id);
  const report: Report = {
    status: world.status,
    artifact: null,
    missingSources,
    unanswered: [],
  };
  if (world.status === "staged") {
    const answers = expectedAnswers(world);
    if (negative) answers[0]!.evidence[0]!.text += " (unobserved)";
    report.artifact = await binding.scratchHandoffWrite.stage(
      JSON.stringify({ answers }) + "\n",
    );
  }
  return verifyManagedScratchHandoff(fs, vcs, rpc, seeded, report);
}
