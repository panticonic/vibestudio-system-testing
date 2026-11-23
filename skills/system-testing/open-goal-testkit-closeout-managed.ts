import type { InvocationObservations } from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { contextId, fs, rpc } from "@workspace/runtime";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { LiveCleanupReport } from "../session-test-review/types.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { prepareTestkitCleanup } from "./testkit-cleanup-managed.js";
import type { OpenTestkitCloseoutWorld } from "./open-goal-testkit-closeout-worlds.js";
type CloseoutReceipt = { path: string; sha256: string; bytes: number };
type CloseoutDecision = { status: OpenTestkitCloseoutWorld["disposition"]; currentRemaining: string[]; note: boolean; explanation: string };
type CloseoutReport = {
  pair: Record<"current" | "prior", { label: string; receipt: string }>;
  current: LiveCleanupReport;
  prior: LiveCleanupReport;
  decision: CloseoutDecision;
  handoff: CloseoutReceipt | null;
};


export async function prepareOpenTestkitCloseout(input: { contextId: string; caseId: string; goal: string }, world: OpenTestkitCloseoutWorld) {
  if (!contextId || input.contextId !== contextId || input.caseId !== world.id || input.goal !== world.goal)
    throw new Error("Testkit closeout does not match the owned goal");
  const prior = await prepareTestkitCleanup(world.prior, crypto.randomUUID());
  const current = await prepareTestkitCleanup(world.current, crypto.randomUUID());
  const pair = {
    current: { label: "current Testkit attempt", receipt: current.request.receipt },
    prior: { label: "prior Testkit attempt", receipt: prior.request.receipt },
  };
  const directory = await fs.mkdtemp("testkit-closeout");
  const path = directory.replace(/\/$/u, "") + "/closeout-review.json";
  const expectedNote = world.lane === "any" || (world.lane === "clear" && world.disposition === "cleared");
  const reads: string[] = [];
  const readEvidence = new Map<string, Awaited<ReturnType<typeof current.services.testkitCleanup.inspect>>>();
  const stages: CloseoutReport[] = [];
  let nominated = false;
  let rejectedForeign = false;
  let handoff: CloseoutReceipt | null = null;
  const contents = ({ current, prior, decision }: CloseoutReport) => JSON.stringify({ scope: "private-local", current, prior, decision });

  const services = {
    testkitCloseout: {
      async nominate(goal: string) {
        if (goal !== world.goal) throw new Error("Only the exact goal can nominate this closeout pair");
        nominated = true;
        return structuredClone(pair);
      },
      async stage(decision: CloseoutDecision) {
        const report:CloseoutReport={pair,current:current.reference,prior:prior.reference,decision,handoff:null};
        const permitted = world.lane === "any" || (world.lane === "clear" && report.decision.status === "cleared");
        if (!nominated || handoff || !permitted || !report.decision.note || report.handoff !== null ||
            reads.length !== 2 || !isDeepStrictEqual(report.pair, pair) ||
            !isDeepStrictEqual(report.current, current.reference) || !isDeepStrictEqual(report.prior, prior.reference) ||
            !isDeepStrictEqual(report.decision.currentRemaining, current.reference.remainingIds) ||
            (report.decision.status === "cleared" && current.reference.remainingIds.length > 0))
          throw new Error("This private closeout was not authorized or did not preserve the exact evidence");
        const text = contents(report);
        await fs.writeFile(path, text);
        stages.push(structuredClone(report));
        handoff = { path, sha256: sha256HexSyncText(text), bytes: new TextEncoder().encode(text).length };
        return structuredClone(handoff);
      },
    },
    testkitCleanup: {
      async inspect(receipt: string) {
        const attempt = receipt === pair.current.receipt ? current : receipt === pair.prior.receipt ? prior : null;
        if (!nominated || !attempt) {
          if (!attempt) rejectedForeign = true;
          throw new Error("Use a nominated Testkit closeout receipt");
        }
        if (readEvidence.has(receipt)) return structuredClone(readEvidence.get(receipt)!);
        const evidence = await attempt.services.testkitCleanup.inspect(receipt);
        readEvidence.set(receipt, structuredClone(evidence));
        reads.push(receipt);
        return evidence;
      },
    },
  };

  async function verify(raw: unknown, invocation?: InvocationObservations) {
    const result = raw as CloseoutReport | null;
    const outcome = result;
    const same = nominated;
    const currentCheck = current.verify(current.reference);
    const priorCheck = prior.verify(prior.reference);
    const actualFiles = await fs.readdir(directory);
    const artifact = handoff && actualFiles.length === 1 && actualFiles[0] === "closeout-review.json"
      ? new TextDecoder("utf-8", { fatal: true }).decode(await readWorkspaceBytes(rpc, path, 32000))
      : null;
    const decision = outcome?.decision;
    const checks = {
      exactNominatedTestkitAttempts: !!same && isDeepStrictEqual([...reads].sort(), [pair.current.receipt, pair.prior.receipt].sort()),
      separatedActualCurrentAndPrior: currentCheck.passed && priorCheck.passed,
      separateReleaseAndObservedResidue: currentCheck.evidence.protectedUnchanged && priorCheck.evidence.protectedUnchanged,
      exactUserAcceptanceDecision: isDeepStrictEqual(decision?.currentRemaining,current.reference.remainingIds)&&isDeepStrictEqual(outcome?.handoff,handoff)&&decision?.status === world.disposition && decision.note === expectedNote &&
        typeof decision.explanation === "string" && decision.explanation.trim().length > 0 && decision.explanation.length <= 1200,
      verifiedPrivateCloseout: expectedNote
        ? artifact !== null && stages.length === 1 && stages[0]!.decision.status===world.disposition&&stages[0]!.decision.note===expectedNote&&artifact === contents(stages[0]) &&
          handoff?.sha256 === sha256HexSyncText(artifact)
        : actualFiles.length === 0 && stages.length === 0 && handoff === null,
    };
    return {
      outcomeContract:{effects:{checks:["exactNominatedTestkitAttempts", "separatedActualCurrentAndPrior", "separateReleaseAndObservedResidue", "verifiedPrivateCloseout"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["exactUserAcceptanceDecision"],required:!expectedNote,rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:raw!==undefined&&!(checks.exactUserAcceptanceDecision)?[{required:!expectedNote,definition:invocation?.calls.find(call=>call.parentCallId===null)?.definition??{name:"compareTestkitCloseouts",source:"compareTestkitCloseouts.nl"},value:raw}]:[],
 caseId: world.id, contextId, goal: world.goal, pair, actual: [currentCheck.evidence, priorCheck.evidence],
      readReceipts: reads.slice(), staged: stages.slice(), artifact, report: outcome, rejectedForeign, checks,
      passed: Object.values(checks).every(Boolean) };
  }

  async function qualify() {
    await services.testkitCloseout.nominate(world.goal);
    try { await services.testkitCleanup.inspect("other-workspace:cleanup"); }
    catch (error) { if (!rejectedForeign) throw error; }
    await services.testkitCleanup.inspect(pair.current.receipt);
    await services.testkitCleanup.inspect(pair.prior.receipt);
    const decision: CloseoutDecision = { status: world.disposition, currentRemaining: current.reference.remainingIds,
      note: expectedNote, explanation: "The scoped Testkit outcomes and inventory were checked independently." };
    const outcome = { pair, current: current.reference, prior: prior.reference, decision, handoff: null };
    const report = {decision,handoff:expectedNote?await services.testkitCloseout.stage(decision):null};
    const proof = await verify(report);
    const crosswire = await verify({ ...report, decision:{...decision,currentRemaining:["foreign-attempt-resource"]} });
    if (!rejectedForeign || crosswire.passed) throw new Error("Foreign or substituted Testkit closeout evidence was accepted");
    return proof;
  }
  return { services, verify, qualify };
}
