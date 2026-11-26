import {type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome = bindObservedContentReview(["pair", "actual", "readReceipts", "staged", "rejectedForeign", "nativeFacts"], ["artifact"]);
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { contextId, fs } from "@workspace/runtime";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { LiveCleanupReport } from "../session-test-review/types.js";
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
        if (!nominated || handoff || !permitted || report.handoff !== null ||
            typeof decision.explanation!=="string" || !decision.explanation.trim() || !isDeepStrictEqual(report.pair, pair) ||
            !isDeepStrictEqual(report.current, current.reference) || !isDeepStrictEqual(report.prior, prior.reference) ||
            !isDeepStrictEqual([...report.decision.currentRemaining].sort(), [...current.reference.remainingIds].sort()) ||
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

  
  async function verify(raw: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(raw,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["exactUserAcceptanceDecision"],"rootPath":["decision"],"producerSourceSuffix":"compareTestkitCloseouts/decideCloseout.nl","producerPath":[]}];
    const contributions=authored.filter(binding=>{
      let current:unknown=raw;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,raw,invocation,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(raw: unknown, invocation?: InvocationObservations) {
    const result = raw as CloseoutReport | null;
    const outcome = result;
    const same = nominated;
    const currentCheck = current.verify(current.reference);
    const priorCheck = prior.verify(prior.reference);
    const actualFiles = await fs.readdir(directory);
    const artifact = handoff && actualFiles.length === 1 && actualFiles[0] === "closeout-review.json"
      ? await fs.readFile(path, "utf8")
      : null;
    const decision = outcome?.decision;
    const checks = {
      exactNominatedTestkitAttempts: !!same && reads.every(receipt=>receipt===pair.current.receipt||receipt===pair.prior.receipt),
      separatedActualCurrentAndPrior: currentCheck.evidence.receipt===pair.current.receipt&&priorCheck.evidence.receipt===pair.prior.receipt&&pair.current.receipt!==pair.prior.receipt,
      separateReleaseAndObservedResidue: currentCheck.evidence.protectedUnchanged && priorCheck.evidence.protectedUnchanged,
      exactUserAcceptanceDecision: typeof decision?.explanation === "string" && decision.explanation.trim().length > 0,
      authenticCurrentRemaining: !decision || Array.isArray(decision.currentRemaining)&&isDeepStrictEqual([...decision.currentRemaining].sort(), [...current.reference.remainingIds].sort()),
      authenticCloseoutReceipt: outcome?.handoff===undefined||outcome.handoff===null||isDeepStrictEqual(outcome.handoff,handoff),
      verifiedPrivateCloseout: handoff
        ? artifact !== null && actualFiles.length===1 && stages.length === 1 && artifact === contents(stages[0]!) &&
          handoff.sha256 === sha256HexSyncText(artifact) && handoff.bytes===new TextEncoder().encode(artifact).length
        : actualFiles.length === 0 && stages.length === 0,

    };
    return {
      outcomeContract:{effects:{checks:["exactNominatedTestkitAttempts", "separatedActualCurrentAndPrior", "separateReleaseAndObservedResidue", "verifiedPrivateCloseout"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["exactUserAcceptanceDecision"],required:world.requestedReturnRequired,rationale:"Every literal goal asks for an actual acceptance or teardown answer. A private note never removes the requested answer obligation."},
        incidentalValues:{checks:["authenticCurrentRemaining","authenticCloseoutReceipt"],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],
 caseId: world.id, contextId, goal: world.goal, pair, actual: [currentCheck.evidence, priorCheck.evidence],
      nativeFacts:{current:{receipt:pair.current.receipt,evidence:currentCheck.evidence,actorInspected:reads.includes(pair.current.receipt)},prior:{receipt:pair.prior.receipt,evidence:priorCheck.evidence,actorInspected:reads.includes(pair.prior.receipt)},privateNotePermission:world.lane,
        protocol:"The nominated current attempt is the candidate under the user's acceptance conditions. The prior attempt is retained comparison evidence, not a second candidate that must also pass. Test outcome, cleanup acknowledgement and surviving inventory are separate facts. A private-note permission is not a request. Verifier-held facts do not claim the actor inspected an attempt."},
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
    if(expectedNote && !report.handoff)throw new Error("Reference did not actually retain its conditional private evidence");
    const crosswire = await verify({ ...report, decision:{...decision,currentRemaining:["foreign-attempt-resource"]} });
    if (!rejectedForeign || crosswire.outcomeDimensions.incidentalValues?.checks.authenticCurrentRemaining!==false) throw new Error("Foreign or substituted Testkit closeout evidence was accepted");
    return proof;
  }
  return { services, verify, qualify };
}
