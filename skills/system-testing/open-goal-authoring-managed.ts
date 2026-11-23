import {assessObservedApplicationOutcome,type ApplicationReturnContribution} from "./observed-application-outcome.js";
import type { InvocationObservations } from "./observed-invocation.js";
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
  const report = outcome as AuthoringOpenOutcome;

  return report ?? null;
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
  const issuedSelections: Selection[] = [];
  const confirmations: ("current" | "changed")[] = [];
  let observedIds: string[] = [];
  let discovered = 0;
  let edited = false;
  let confirmed: AuthoringReceipt | null = null;
  let handoffReceipt: AuthoringHandoff | null = null;

  function matchesReceipts(selection: Selection, receipt: AuthoringReceipt) {
    return isDeepStrictEqual(selection.choice, receipt.selection) &&
      selection.reads.find(read => read.role === "candidate")?.revision === receipt.review.candidateRevision &&
      (selection.reads.find(read => read.role === "baseline")?.revision ?? null) === receipt.review.baselineRevision &&
      selection.reads.length === (selection.baseline ? 2 : 1);
  }
  function issuedFor(receipt: AuthoringReceipt): Selection | null {
    return issuedSelections.findLast(selection => matchesReceipts(selection, receipt)) ?? null;
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
        if (goal !== world.goal || !sources.has(choice.candidateId) ||
            (choice.baselineId !== null && !sources.has(choice.baselineId))) return null;
        const candidate = sources.get(choice.candidateId);
        const baseline = choice.baselineId === null ? null : sources.get(choice.baselineId) ?? null;
        if (!candidate) return null;
        const record = await readReviewBrief(candidate);
        const release = baseline ? (await readReviewBrief(baseline)).source : null;
        if (!record.contract || record.source.state !== "candidate" || record.contract.preserveBaseline !== Boolean(release) ||
            (release !== null && (release.state !== "released" || release.product !== record.source.product))) return null;
        const request: AuthoringRequest = { goal, compare: Boolean(release), contract: record.contract };
        opened = { choice: structuredClone(choice), request, candidate, baseline, reads: [] };
        issuedSelections.push(opened);
        return { selection: structuredClone(choice), request: structuredClone(request) };
      },
    },
    authoringCompiler: {
      async inspect(role: ProgramRole) {
        const selected = opened;
        const source = role === "candidate" ? selected?.candidate : role === "baseline" ? selected?.baseline : null;
        if (!selected || !source) throw new Error("Inspect an owned selected candidate or applicable baseline");
        const start = await revision(source);
        const previous = selected.reads.find(read => read.role === role);
        if (previous) {
          if (previous.revision !== start) throw new Error("Selected source changed; open its current review again");
          return structuredClone(previous);
        }
        const result = await readAuthoringProgram(ports.describe, source.workspacePath, role, start);
        if (start !== await revision(source)) throw new Error("Source changed during compiler inspection");
        selected.reads.push(result);
        selected.reads.sort((a,b)=>Number(a.role === "baseline")-Number(b.role === "baseline"));
        return structuredClone(result);
      },
    },
    authoringReviewControl: {
      async confirm(receipt: AuthoringReceipt) {
        const selected = issuedFor(receipt);
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
        const selected = issuedFor(receipt);
        if (!world.canStage || !selected || !isDeepStrictEqual(receipt, confirmed) || !await current(selected, receipt))
          return null;
        if (handoffReceipt) return await fs.exists(handoff) && sha256HexSyncText(String(await fs.readFile(handoff, "utf8"))) === handoffReceipt.revision ? structuredClone(handoffReceipt) : null;
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
    const after = await vcs.status();
    const receipt = outcome?.status === "reviewed" ? outcome.receipt : null;
    const selected = confirmed ? issuedFor(confirmed) : opened;
    const artifact = outcome?.status === "reviewed" ? outcome.artifact : null;
    const actual = selected?.reads.length ? reviewCompilerReadbacks(selected) : null;
    const currentConfirmed = wanted ? confirmations.at(-1) === "current" && (!world.edit || confirmations.includes("changed")) : confirmations.length === 0;
    const recordedSources = await Promise.all(world.records.map(async seed => {
      const record = sources.get(keys.get(seed.key)!)!;
      const tree = world.edit && seed.key === world.expected.candidate ? { ...seed.files, [world.edit.path]: world.edit.text } : seed.files;
      return record.expectedTreeDigest === digest(seed.files) && await revision(record) === digest(tree) &&
        isDeepStrictEqual((await readReviewBrief(record)).source, record.source);
    }));
    const stagedText = await fs.exists(handoff) ? String(await fs.readFile(handoff, "utf8")) : null;
    const stageVerified = world.expected.stage
      ? !!confirmed&&!!handoffReceipt&&stagedText===encode(confirmed)&&handoffReceipt.path===handoff&&handoffReceipt.revision===sha256HexSyncText(stagedText)
      : handoffReceipt===null&&stagedText===null;
    return {
      discoveredAuthoringRecords: (discovered === 0 || isDeepStrictEqual(observedIds.slice().sort(), [...sources.keys()].sort())),
      selectedAuthorizedTrees: wanted ? !!selected && isDeepStrictEqual(selected.choice, wanted) : opened === null,
      observedCurrentCompiler: wanted
        ? !!selected&&!!confirmed&&await current(selected,confirmed)&&currentConfirmed
        : selected === null && confirmations.length === 0,
      returnedAuthoringArtifacts: isDeepStrictEqual(artifact,handoffReceipt)&&(!wanted||!!selected&&!!receipt&&await current(selected,receipt)),
      verifiedAuthoringFindings: wanted
        ? !!actual && !!receipt && !!receipt.review.findings?.every(({ recovery }) => typeof recovery === "string" && recovery.trim()) &&
          actual.status === disposition(receipt) && actual.status === world.expected.status &&
          isDeepStrictEqual(normalizedFindings(receipt.review), normalizedFindings(actual)) &&
          isDeepStrictEqual(reportMarkers(actual), world.expected.markers.map(([code, subject]) => `${code}:${subject}`).sort())
        : outcome?.status === "unresolved" && outcome.reason === world.expected.unresolvedReason,
      retainedAuthoringSources: recordedSources.every(Boolean) && after.mainEventId === before.mainEventId && isDeepStrictEqual(after.workingHead, before.workingHead),
      verifiedAuthoringHandoff: stageVerified,
      rejectedStaleAuthoringReceipt: wanted ? edited === Boolean(world.edit) && currentConfirmed : !edited,
    };
  }

  async function archive(checks: Awaited<ReturnType<typeof verifyOutcome>>, value?:unknown, invocation?:InvocationObservations) {
    const handoffText = await fs.exists(handoff) ? String(await fs.readFile(handoff, "utf8")) : null;
    return {
      outcomeContract:{effects:{checks:["discoveredAuthoringRecords", "selectedAuthorizedTrees", "observedCurrentCompiler", "retainedAuthoringSources", "verifiedAuthoringHandoff", "rejectedStaleAuthoringReceipt"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["verifiedAuthoringFindings", "returnedAuthoringArtifacts"],required:!world.expected.stage,rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],

      caseId: input.caseId, contextId: input.contextId, goal: world.goal, checks,
      passed: Object.values(checks).every(Boolean), confirmations: [...confirmations],
      readbacks: structuredClone(opened?.reads ?? []), receipt: structuredClone(confirmed),
      handoff: structuredClone(handoffReceipt), handoffText,
    };
  }

  
  async function verify(report: unknown,invocation?:InvocationObservations) {
    const proof=await verifyNativeApplication(report,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["verifiedAuthoringFindings","returnedAuthoringArtifacts"],"rootPath":["receipt","review"],"producerSourceSuffix":"reviewProgram.nl","producerPath":[]}];
    const contributions=authored.filter(binding=>{
      let current:unknown=report;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,report,invocation,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(report: unknown, invocation?:InvocationObservations) {
    return archive(await verifyOutcome(readReview(report)),report,invocation);
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
        !(await verifyOutcome(supplied)).returnedAuthoringArtifacts && (!world.edit || rejectedStale);
    }
    return archive(checks);
  } };
}
