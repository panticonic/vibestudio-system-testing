import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { ProgramDescription } from "@workspace/natlang/describe-types";
import type { RuntimeFs, VcsClient } from "@workspace/runtime";
import type { AuthoringRequest, ProgramReadback, ProgramRole } from "@workspace-skills/natlang-authoring/types";
import type { AuthoringHandoff, AuthoringOpenOutcome, AuthoringReceipt, AuthoringSelection, AuthoringSource } from "@workspace-skills/open-authoring-goal/types";
import { readAuthoringProgram, reviewCompilerReadbacks } from "./authoring-managed.js";
import type { OpenAuthoringWorld } from "./open-goal-authoring-worlds.js";

type Ports = {
  fs: Pick<RuntimeFs, "mkdtemp" | "mkdir" | "readdir" | "readFile" | "writeFile" | "rename" | "exists">;
  vcs: Pick<VcsClient, "status">;
  contextId: string;
  describe(path: string): Promise<ProgramDescription>;
};
type RecordSource = OpenAuthoringWorld["records"][number];
type WorkspaceSource = {
  source: AuthoringSource;
  workspacePath: string;
  briefPath: string;
  expectedTreeDigest: string;
};

const digest = (files: Record<string, string>) => sha256HexSyncText(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
const disposition = (receipt: AuthoringReceipt | null) => receipt?.review.status ?? null;
const reportMarkers = (report: AuthoringReceipt["review"]) => report.findings
  .map(({ code, subject }) => `${code}:${code === "compiler-error" ? subject.replace(/:\d+:\d+$/u, "") : subject}`).sort();
const normalizedFindings = (report: AuthoringReceipt["review"]) => report.findings
  .map(({ code, subject, observed }) => JSON.stringify([code, subject, observed])).sort();

function readReview(outcome: unknown): AuthoringOpenOutcome | null {
  if (!outcome || typeof outcome !== "object") return null;
  const report = outcome as { status?: string; skill?: string; outcome?: AuthoringOpenOutcome };
  if (report.status !== "workspace-skill-reviewed" || report.skill !== "authoring") return null;
  return report.outcome ?? null;
}

export async function prepareOpenAuthoringGoal(
  input: { contextId: string; caseId: string },
  world: OpenAuthoringWorld,
  ports: Ports,
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("Authoring review needs its owned workspace context");
  const { fs, vcs } = ports;
  const before = await vcs.status();
  const root = await fs.mkdtemp("open-authoring");
  const handoff = `${root}/review-handoff.json`;
  await fs.mkdir(`${root}/programs`);
  const sources = new Map<string, WorkspaceSource>();
  const keys = new Map<string, string>();

  async function storeSource(seed: RecordSource) {
    const { key, files, contract, ...metadata } = seed;
    const id = crypto.randomUUID();
    const path = `${root}/programs/${id}`;
    const workspacePath = `${path}/source`;
    await fs.mkdir(workspacePath, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      const name = `${workspacePath}/${relative}`;
      await fs.mkdir(name.slice(0, name.lastIndexOf("/")), { recursive: true });
      await fs.writeFile(name, content);
    }
    const source = { id, ...metadata };
    const briefPath = `${path}/authoring-record.json`;
    await fs.writeFile(briefPath, JSON.stringify({ source, contract: contract ?? null }));
    sources.set(id, { source, workspacePath, briefPath, expectedTreeDigest: digest(files) });
    if (keys.has(key)) throw new Error("Duplicate authoring workspace source");
    keys.set(key, id);
  }
  for (const seed of world.records) await storeSource(seed);

  async function currentTree(source: WorkspaceSource) {
    const read = async (directory: string, relative = ""): Promise<Record<string, string>> => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const pairs = await Promise.all(entries.map(async (entry) => {
        const name = `${directory}/${entry.name}`;
        const key = relative + entry.name;
        if (entry.isDirectory()) return Object.entries(await read(name, `${key}/`));
        if (!entry.isFile()) throw new Error("An authoring tree gained an unexpected non-file entry");
        const raw = await fs.readFile(name, "utf8");
        if (typeof raw !== "string") throw new Error("Authoring source requires exact text bytes");
        return [[key, raw]];
      }));
      return Object.fromEntries(pairs.flat());
    };
    return read(source.workspacePath);
  }
  async function revision(source: WorkspaceSource) {
    return digest(await currentTree(source));
  }
  async function readReviewBrief(source: WorkspaceSource) {
    const record = JSON.parse(String(await fs.readFile(source.briefPath, "utf8"))) as {
      source: AuthoringSource;
      contract: AuthoringRequest["contract"] | null;
    };
    if (record.source.id !== source.source.id) throw new Error("Authoring record identity changed");
    return record;
  }

  type Selection = { choice: AuthoringSelection; request: AuthoringRequest; candidate: WorkspaceSource; baseline: WorkspaceSource | null; reads: ProgramReadback[] };
  let opened: Selection | null = null;
  const readSelections: AuthoringSelection[] = [];
  const confirmations: ("current" | "changed")[] = [];
  let observedIds: string[] = [];
  let discovered = 0;
  let edited = false;
  let confirmed: AuthoringReceipt | null = null;
  let handoffReceipt: AuthoringHandoff | null = null;

  function matchesReceipts(selection: Selection, receipt: AuthoringReceipt) {
    return isDeepStrictEqual(selection.choice, receipt.selection) &&
      selection.reads[0]?.role === "candidate" && selection.reads[0].revision === receipt.review.candidateRevision &&
      (selection.reads[1]?.revision ?? null) === receipt.review.baselineRevision &&
      selection.reads.length === (selection.baseline ? 2 : 1);
  }
  async function current(selection: Selection, receipt: AuthoringReceipt) {
    return matchesReceipts(selection, receipt) &&
      receipt.review.candidateRevision === await revision(selection.candidate) &&
      receipt.review.baselineRevision === (selection.baseline ? await revision(selection.baseline) : null);
  }
  function encode(receipt: AuthoringReceipt) {
    return JSON.stringify({ schema: "vibestudio.authoring-handoff/1", contextId: input.contextId, receipt }, null, 2) + "\n";
  }

  const services = {
    authoringDiscovery: {
      async list() {
        discovered++;
        const ids = await fs.readdir(`${root}/programs`);
        const entries = await Promise.all(ids.map(async id => {
          const source = sources.get(id);
          if (!source) throw new Error("Unexpected authoring record in the owned scope");
          return (await readReviewBrief(source)).source;
        }));
        observedIds = entries.map(({ id }) => id);
        return entries;
      },
      async open(goal: string, choice: AuthoringSelection) {
        if (goal !== world.goal || !observedIds.includes(choice.candidateId) ||
            (choice.baselineId !== null && !observedIds.includes(choice.baselineId))) return null;
        const candidate = sources.get(choice.candidateId);
        const baseline = choice.baselineId === null ? null : sources.get(choice.baselineId) ?? null;
        if (!candidate) return null;
        const record = await readReviewBrief(candidate);
        const release = baseline ? (await readReviewBrief(baseline)).source : null;
        if (!record.contract || record.source.state !== "candidate" || record.contract.preserveBaseline !== Boolean(release) ||
            (release !== null && (release.state !== "released" || release.product !== record.source.product))) return null;
        const request: AuthoringRequest = { goal, compare: Boolean(release), contract: record.contract };
        opened = { choice: structuredClone(choice), request, candidate, baseline, reads: [] };
        confirmed = null;
        readSelections.push(structuredClone(choice));
        return { selection: structuredClone(choice), request: structuredClone(request) };
      },
    },
    authoringCompiler: {
      async inspect(role: ProgramRole) {
        const selected = opened;
        const source = role === "candidate" ? selected?.candidate : role === "baseline" ? selected?.baseline : null;
        const expectedRole = selected?.reads.length ? "baseline" : "candidate";
        if (!selected || !source || role !== expectedRole || selected.reads.some(read => read.role === role))
          throw new Error("Read the owned selected candidate and applicable comparison once per review");
        const start = await revision(source);
        const result = await readAuthoringProgram(ports.describe, source.workspacePath, role, start);
        if (start !== await revision(source)) throw new Error("Source changed during compiler inspection");
        selected.reads.push(result);
        return structuredClone(result);
      },
    },
    authoringReviewControl: {
      async confirm(receipt: AuthoringReceipt) {
        const selected = opened;
        if (!selected || !matchesReceipts(selected, receipt)) return "changed" as const;
        if (world.edit && !edited && selected.choice.candidateId === keys.get("candidate")) {
          await fs.writeFile(`${selected.candidate.workspacePath}/${world.edit.path}`, world.edit.text);
          edited = true;
        }
        const result = await current(selected, receipt) ? "current" : "changed";
        confirmations.push(result);
        if (result === "current") confirmed = structuredClone(receipt);
        return result;
      },
      async stage(receipt: AuthoringReceipt) {
        const selected = opened;
        if (!world.canStage || !selected || !isDeepStrictEqual(receipt, confirmed) || !await current(selected, receipt) || handoffReceipt)
          return null;
        const text = encode(receipt);
        await fs.writeFile(`${handoff}.pending`, text);
        await fs.rename(`${handoff}.pending`, handoff);
        handoffReceipt = { path: handoff, revision: sha256HexSyncText(text) };
        return structuredClone(handoffReceipt);
      },
    },
  };

  const wanted: AuthoringSelection | null = world.expected.candidate === null ? null : {
    candidateId: keys.get(world.expected.candidate)!,
    baselineId: world.expected.baseline === null ? null : keys.get(world.expected.baseline)!,
  };
  if (wanted && (!wanted.candidateId || wanted.baselineId === undefined))
    throw new Error("The independent expected authoring source is missing");

  async function verifyOutcome(outcome: AuthoringOpenOutcome | null) {
    const selected = opened;
    const after = await vcs.status();
    const receipt = outcome?.status === "reviewed" ? outcome.receipt : null;
    const artifact = outcome?.status === "reviewed" ? outcome.artifact : null;
    const actual = selected?.reads.length ? reviewCompilerReadbacks(selected) : null;
    const wantedReadCount = wanted ? (world.edit ? 2 : 1) : 0;
    const expectedConfirmations = wanted ? (world.edit ? ["changed", "current"] : ["current"]) : [];
    const recordedSources = await Promise.all(world.records.map(async seed => {
      const record = sources.get(keys.get(seed.key)!)!;
      const tree = world.edit && seed.key === world.expected.candidate ? { ...seed.files, [world.edit.path]: world.edit.text } : seed.files;
      return record.expectedTreeDigest === digest(seed.files) && await revision(record) === digest(tree) &&
        isDeepStrictEqual((await readReviewBrief(record)).source, record.source);
    }));
    const stagedText = await fs.exists(handoff) ? String(await fs.readFile(handoff, "utf8")) : null;
    const stageVerified = world.expected.stage
      ? !!receipt && !!artifact && stagedText === encode(receipt) &&
        artifact.path === handoff && artifact.revision === sha256HexSyncText(stagedText)
      : artifact === null && stagedText === null;
    return {
      discoveredAuthoringRecords: discovered === Math.max(1, wantedReadCount) &&
        isDeepStrictEqual(observedIds.slice().sort(), [...sources.keys()].sort()),
      selectedAuthorizedTrees: readSelections.length === wantedReadCount && readSelections.every(choice => isDeepStrictEqual(choice, wanted)),
      observedCurrentCompiler: wanted
        ? !!selected && !!receipt && await current(selected, receipt) && isDeepStrictEqual(confirmations, expectedConfirmations)
        : selected === null && confirmations.length === 0,
      verifiedAuthoringFindings: wanted
        ? !!actual && !!receipt && !!receipt.review.findings?.every(({ recovery }) => typeof recovery === "string" && recovery.trim()) &&
          actual.status === disposition(receipt) && actual.status === world.expected.status &&
          isDeepStrictEqual(normalizedFindings(receipt.review), normalizedFindings(actual)) &&
          isDeepStrictEqual(reportMarkers(actual), world.expected.markers.map(([code, subject]) => `${code}:${subject}`).sort())
        : outcome?.status === "unresolved" && outcome.reason === world.expected.unresolvedReason,
      retainedAuthoringSources: recordedSources.every(Boolean) && after.mainEventId === before.mainEventId && isDeepStrictEqual(after.workingHead, before.workingHead),
      verifiedAuthoringHandoff: stageVerified,
      rejectedStaleAuthoringReceipt: wanted ? edited === Boolean(world.edit) && isDeepStrictEqual(confirmations, expectedConfirmations) : !edited,
    };
  }

  async function archive(checks: Awaited<ReturnType<typeof verifyOutcome>>) {
    const handoffText = await fs.exists(handoff) ? String(await fs.readFile(handoff, "utf8")) : null;
    return {
      caseId: input.caseId, contextId: input.contextId, goal: world.goal, checks,
      passed: Object.values(checks).every(Boolean), confirmations: [...confirmations],
      readbacks: structuredClone(opened?.reads ?? []), receipt: structuredClone(confirmed),
      handoff: structuredClone(handoffReceipt), handoffText,
    };
  }

  async function verify(report: unknown) {
    return archive(await verifyOutcome(readReview(report)));
  }

  return { services, verify, async qualify() {
    let outcome: AuthoringOpenOutcome = {
      status: "unresolved", reason: world.expected.unresolvedReason ?? "source-kept-changing",
    };
    let rejectedStale: boolean = false;
    for (const attempt of [0, 1]) {
      await services.authoringDiscovery.list();
      if (!wanted) break;
      const bound = await services.authoringDiscovery.open(world.goal, wanted);
      if (!bound || !opened) throw new Error("The authorized reference does not resolve its source");
      await services.authoringCompiler.inspect("candidate");
      if (bound.request.compare) await services.authoringCompiler.inspect("baseline");
      const receipt = { selection: wanted, review: reviewCompilerReadbacks(opened) };
      const fresh = await services.authoringReviewControl.confirm(receipt);
      if (fresh === "changed") {
        rejectedStale = await services.authoringReviewControl.stage(receipt) === null;
        if (attempt === 1) throw new Error("The repeated reference review could not find a current revision");
        continue;
      }
      const artifact = world.expected.stage ? await services.authoringReviewControl.stage(receipt) : null;
      outcome = { status: "reviewed", receipt, artifact };
      break;
    }
    const checks = await verifyOutcome(outcome);
    if (outcome.status === "reviewed") {
      const supplied = structuredClone(outcome);
      supplied.receipt.review.candidateRevision = "earlier-revision";
      checks.rejectedStaleAuthoringReceipt = checks.rejectedStaleAuthoringReceipt &&
        !(await verifyOutcome(supplied)).observedCurrentCompiler && (!world.edit || rejectedStale);
    }
    return archive(checks);
  } };
}
