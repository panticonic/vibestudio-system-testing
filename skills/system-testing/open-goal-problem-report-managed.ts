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

  async function verify(report: unknown) {
    const wrapper = report as { incident?: string; draft?: unknown } | null;
    const selected = wrapper;
    const verification = await draft.verify(selected?.draft as Parameters<typeof draft.verify>[0] ?? null);
    const current = await problemReports.get(other.id);
    const checks = {
      foundCurrentIncident: discovered && selected?.incident === activeId &&
        openings.some(({ result }) => result !== null),
      preservedNeighbor: current.revision === baseline.revision && isDeepStrictEqual(current.value, baseline.value),
      verifiedExactLocalDraft: verification.passed,
      stayedLocal: verification.checks.localOnly && verification.checks.retention,
    };
    return { passed: Object.values(checks).every(Boolean), checks, caseId: input.caseId,
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
      verifiedExactLocalDraft: result.verification.passed && result.rejectedForeignScope && result.rejectedWrongRevision,
      stayedLocal: result.verification.checks.localOnly && result.verification.checks.retention,
    };
    return { passed: Object.values(checks).every(Boolean), checks, caseId: input.caseId,
      contextId: input.contextId, goal: world!.goal, activeId, candidates, openings, draft: result.verification };
  }

  return { services, verify, qualify };
}
