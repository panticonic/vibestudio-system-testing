import type { InvocationObservations } from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { contextId, problemReports } from "@workspace/runtime";
import { prepareManagedProblemDraft } from "./problem-draft-managed.js";
import { openProblemReportWorlds } from "./open-goal-problem-report-worlds.js";

export async function prepareOpenProblemReport(input: { contextId: string; caseId: string }) {
  const world = openProblemReportWorlds.find(({ id }) => id === input.caseId);
  if (!world || contextId !== input.contextId) throw new Error("The local incident belongs to another workspace");

  const other = await problemReports.create({
    category: "quality", component: "unknown", operation: null, code: null, kind: "unknown",
    frames: [], externalFramesOmitted: 0, symptom: world.archive, expected: "",
  });
  const baseline = await problemReports.get(other.id);
  const draft = await prepareManagedProblemDraft(input.contextId, input.caseId, world);
  const activeId = crypto.randomUUID();
  const candidates = [
    { id: other.id, title: world.surface, surface: world.surface, state: "archived", observation: world.archive },
    { id: activeId, title: world.surface, surface: world.surface,
      state: world.defect === "transient" ? "recovered" : "current", observation: world.account.observed },
  ];
  // Do not correlate candidate order with identification.
  candidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  let discovered = false;
  const openings: { id: string; result: { operationId: string } | null }[] = [];
  const services = {
    ...draft.services,
    problemIncident: {
      async discover() {
        discovered = true;
        return candidates;
      },
      async open(id: string) {
        const result = discovered && id === activeId ? { operationId: draft.request.operationId } : null;
        openings.push({ id, result });
        return result;
      },
    },
  };

  async function verify(report: unknown, invocation?:InvocationObservations) {
    const verification=await draft.verify(report as Parameters<typeof draft.verify>[0]??null);
    const current = await problemReports.get(other.id);
    const checks = {
      foundCurrentIncident: discovered &&
        openings.some(({ result }) => result !== null),
      preservedNeighbor: current.revision === baseline.revision && isDeepStrictEqual(current.value, baseline.value),
      verifiedExactLocalDraft: Object.entries(verification.checks).filter(([key])=>key!=="result").every(([,passed])=>passed),
      returnedProblemDraft: verification.checks.result,
      stayedLocal: verification.checks.localOnly && verification.checks.retention,
    };
    return {
      outcomeContract:{effects:{checks:["foundCurrentIncident", "preservedNeighbor", "verifiedExactLocalDraft", "stayedLocal"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["returnedProblemDraft"],required:world.mode==="stale",rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:report!==undefined&&!(checks.returnedProblemDraft)?[{required:world.mode==="stale",definition:invocation?.calls.find(call=>call.parentCallId===null)?.definition??{name:"workOnProblemReportGoal",source:"workOnProblemReportGoal.nl"},value:report}]:[],
 passed: Object.values(checks).every(Boolean), checks, caseId: input.caseId,
      contextId: input.contextId, goal: world!.goal, activeId, candidates, openings, draft: verification };
  }

  async function qualify() {
    await services.problemIncident.discover();
    const denied = await services.problemIncident.open(other.id);
    const allowed = await services.problemIncident.open(activeId);
    if (denied !== null || allowed?.operationId !== draft.request.operationId)
      throw new Error("The incident selector opened the wrong draft scope");
    const result = await draft.qualify();
    const current = await problemReports.get(other.id);
    const checks = {
      foundCurrentIncident: discovered && openings.some(({ result }) => result !== null),
      preservedNeighbor: current.revision === baseline.revision && isDeepStrictEqual(current.value, baseline.value),
      verifiedExactLocalDraft: Object.entries(result.verification.checks).filter(([key])=>key!=="result").every(([,passed])=>passed)&&result.rejectedForeignScope&&result.rejectedWrongRevision,
      returnedProblemDraft: result.verification.checks.result,
      stayedLocal: result.verification.checks.localOnly && result.verification.checks.retention,
    };
    return {outcomeContract:{effects:{checks:["foundCurrentIncident","preservedNeighbor","verifiedExactLocalDraft","stayedLocal"],rationale:"Actual native draft state and its retained negative-authority tests establish the effect."},returnedValue:{checks:["returnedProblemDraft"],required:true,rationale:"The reference includes its requested actual reporter value."}}, passed: Object.values(checks).every(Boolean), checks, caseId: input.caseId,
      contextId: input.contextId, goal: world!.goal, activeId, candidates, openings, draft: result.verification };
  }

  return { services, verify, qualify };
}
