import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
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

export async function readWorkspaceBytes(
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
  const seeded = await planScratchHandoff(fs, vcs, world);
  await materializeScratchSources(fs, seeded);
  return seeded;
}

export async function planScratchHandoff(
  fs: RuntimeFs,
  vcs: Pick<VcsClient, "status">,
  world: World,
) {
  const initial = await vcs.status();
  const directory = await fs.mkdtemp("handoff-input");
  const sources = Object.keys(world.sources).map((id) => ({
    id,
    path: `${directory}/${id}.txt`,
  }));
  return {
    world,
    directory,
    initial,
    outputEntries: (await listOwnedScratchEntries(fs)).filter((name) =>
      scratchName.test(name),
    ),
    request: { goal: world.goal, questions: [...world.questions], sources },
  };
}

type Seeded = Awaited<ReturnType<typeof planScratchHandoff>>;

export async function materializeScratchSources(fs: RuntimeFs, seeded: Seeded) {
  for (const { id, path } of seeded.request.sources) {
    const text = seeded.world.sources[id];
    if (text !== null && text !== undefined) await fs.writeFile(path, text);
  }
}
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

type Answer = ReturnType<typeof expectedAnswers>[number];

function citedLines(answer: Answer, sources: World["sources"]) {
  if (
    !Array.isArray(answer.evidence) ||
    answer.evidence.length < 1 ||
    answer.evidence.length > 4
  )
    return null;
  const cited = new Set<string>();
  for (const { sourceId, firstLine, lastLine, text } of answer.evidence) {
    const lines = sources[sourceId]?.split(/\r?\n/u);
    if (
      !lines ||
      !Number.isInteger(firstLine) ||
      !Number.isInteger(lastLine) ||
      firstLine < 1 ||
      lastLine < firstLine ||
      lastLine > lines.length ||
      lastLine - firstLine >= 8 ||
      text !== lines.slice(firstLine - 1, lastLine).join("\n")
    )
      return null;
    for (let line = firstLine; line <= lastLine; line++) {
      const key = `${sourceId}:${line}`;
      if (cited.has(key)) return null;
      cited.add(key);
    }
  }
  return cited;
}

function checkAnswers(body: string, world: StagedWorld) {
  const { answers } = JSON.parse(body) as { answers: Answer[] };
  const expected = expectedAnswers(world);
  return (
    Array.isArray(answers) &&
    answers.length === expected.length &&
    expected.every(
      (answer, index) =>
        answers[index]?.question === answer.question &&
        isDeepStrictEqual(
          citedLines(answers[index]!, world.sources),
          citedLines(answer, world.sources),
        ),
    )
  );
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
  const added = (await listOwnedScratchEntries(fs)).filter(
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
          checkAnswers(body, world);
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
  const binding = bindManagedScratchHandoff(fs, rpc, seeded.request);
  const report = await referenceScratchHandoff(seeded, binding, negative);
  return verifyManagedScratchHandoff(fs, vcs, rpc, seeded, report);
}

export async function referenceScratchHandoff(
  seeded: Seeded,
  binding: ReturnType<typeof bindManagedScratchHandoff>,
  negative = false,
) {
  const { world, request } = seeded;
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
    unanswered:
      world.status === "unanswered"
        ? world.unanswered.map((index) => world.questions[index]!)
        : [],
  };
  if (world.status === "staged") {
    const answers = expectedAnswers(world);
    for (const answer of answers) {
      const split = answer.evidence.flatMap(({ sourceId, firstLine, text }) =>
        text.split("\n").map((line, offset) => ({
          sourceId,
          firstLine: firstLine + offset,
          lastLine: firstLine + offset,
          text: line,
        })),
      );
      if (split.length <= 4) answer.evidence = split;
    }
    if (negative) answers[0]!.evidence[0]!.text += " (unobserved)";
    report.artifact = await binding.scratchHandoffWrite.stage(
      JSON.stringify({ answers }) + "\n",
    );
  } else if (negative) {
    report.artifact =
      await binding.scratchHandoffWrite.stage('{"answers":[]}\n');
  }
  return report;
}
