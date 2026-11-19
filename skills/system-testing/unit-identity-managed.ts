import { isDeepStrictEqual } from "node:util";
import { contextId, vcs } from "@workspace/runtime";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { bindUnitIdentity } from "@workspace-skills/unit-identity-bindings";
import { unitIdentityWorlds } from "./unit-identity-worlds.js";

type Input = { contextId: string; caseId: string };
type Bound = ReturnType<typeof bindUnitIdentity>;
type Services = Bound["services"];
type Icon = Parameters<Services["unitIdentity"]["resolve"]>[1];
type Observation = Awaited<ReturnType<Services["unitIdentity"]["observe"]>>;
type Candidate = NonNullable<Awaited<ReturnType<Services["unitIdentity"]["resolve"]>>>;
type Change = Awaited<ReturnType<Services["unitIdentity"]["stage"]>>;
type Report = {
  observed: Observation;
  intent: Icon;
  assessment: { candidate: Candidate | null; next: string };
  change: Change | null;
  outcome: string;
};

export async function prepareUnitIdentityCase(input: Input) {
  const world = unitIdentityWorlds.find(({ id }) => id === input.caseId);
  if (!world || input.contextId !== contextId) throw new Error("Unknown assigned unit identity");
  const { repoPath, goal, unit, prepare, intent, outcome } = world;
  const bound = bindUnitIdentity({ repoPath, goal, unit, prepare });
  const before = await vcs.status({ contextId });
  let original: Observation | undefined;
  let selected: Candidate | null = null;
  let prepared: Change | null = null;
  const operations: string[] = [];
  const services: Services = {
    unitIdentity: {
      async observe(id) {
        const result = await bound.services.unitIdentity.observe(id);
        original = structuredClone(result);
        operations.push("observe");
        return result;
      },
      async resolve(id, specified) {
        const result = await bound.services.unitIdentity.resolve(id, specified);
        selected = structuredClone(result);
        operations.push("resolve");
        return result;
      },
      async stage(id, revision, authoringId) {
        const result = await bound.services.unitIdentity.stage(id, revision, authoringId);
        prepared = structuredClone(result);
        operations.push("stage");
        return result;
      },
    },
  };
  const next = outcome === "prepared" ? "prepare" : outcome;
  const authoringId = `${intent.family}:${intent.term}`;
  const revision = (head: typeof before.workingHead) =>
    head.kind === "event" ? head.eventId : head.applicationId;

  async function verify(report: Report | null) {
    const after = await vcs.status({ contextId });
    const checks = {
      source: original?.repoPath === repoPath && original.revision === revision(before.workingHead) &&
        isDeepStrictEqual(report?.observed, original),
      candidate: selected?.choice.id === authoringId &&
        selected.declaration === "./assets/icon.svg" && !!selected.artworkDigest &&
        isDeepStrictEqual(report?.intent, intent) &&
        isDeepStrictEqual(report?.assessment, { candidate: selected, next }),
      working: outcome === "prepared"
        ? prepared?.repoPath === repoPath && prepared.revision === revision(after.workingHead) &&
          prepared.revision !== original?.revision &&
          prepared.icon === selected?.declaration &&
          prepared.artworkDigest === selected?.artworkDigest &&
          prepared.mainUnchanged && prepared.manifestOtherwiseUnchanged &&
          isDeepStrictEqual(prepared.changedFiles, ["package.json", "assets/icon.svg"])
        : prepared === null && isDeepStrictEqual(after.workingHead, before.workingHead) &&
          (outcome === "already-matches"
            ? original?.icon === selected?.declaration &&
              original?.artworkDigest === selected?.artworkDigest
            : original?.artworkDigest !== selected?.artworkDigest),
      publication: after.mainEventId === before.mainEventId,
      operations: report?.outcome === outcome && isDeepStrictEqual(report.change, prepared) &&
        isDeepStrictEqual(operations, outcome === "prepared" ? ["observe", "resolve", "stage"] : ["observe", "resolve"]),
    };
    return { ...input, request: bound.request, original, selected, prepared, checks, operations, passed: Object.values(checks).every(Boolean) };
  }
  async function qualify() {
    const id = bound.request.operationId;
    const observed = await services.unitIdentity.observe(id);
    const candidate = await services.unitIdentity.resolve(id, intent);
    const change = outcome === "prepared" && candidate
      ? await services.unitIdentity.stage(id, observed.revision, candidate.choice.id)
      : null;
    return verify({ observed, intent, assessment: { candidate, next }, change, outcome });
  }
  return { request: bound.request, services, qualify, verify };
}

type Prepared = Awaited<ReturnType<typeof prepareUnitIdentityCase>>;
export interface UnitIdentityReceiver {
  runUnitIdentityTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyUnitIdentity(input: Input): ReturnType<Prepared["qualify"]>;
}
export const unitIdentityMethods = createReceiverRpcMethods<UnitIdentityReceiver>([
  "runUnitIdentityTeacher", "qualifyUnitIdentity",
]);
