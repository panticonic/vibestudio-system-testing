import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { packageWebsite } from "@workspace/integrations/website";
import { contextId, rpc, vcs } from "@workspace/runtime";
import { bindPublicationRevision } from "@workspace-skills/publication-revision-bindings";
import { publicationRevisionWorlds } from "./publication-revision-worlds.js";

type Input = { contextId: string; caseId: string; source: string };
type Binding = ReturnType<typeof bindPublicationRevision>;
type Comparison = Awaited<ReturnType<Binding["services"]["publicationRevision"]["compare"]>>;
type Report = {
  comparison: Comparison;
  match: string;
  impact: { affectedPaths: string[]; entryChanged: boolean; htmlChanged: boolean; manifestChanged: boolean };
  decision: string;
  reason: string;
};
const oldCaption = "Weekday departures in local time";
const newCaption = "Weekend departures are shown separately";

export async function preparePublicationRevision(input: Input) {
  const assigned = publicationRevisionWorlds.find(({ id }) => id === input.caseId);
  if (!assigned || input.contextId !== contextId) throw new Error("Unknown assigned publication revision");
  const world = assigned;
  const { source } = input;
  const ref = `ctx:${contextId}` as const;
  const before = await vcs.status({ contextId });
  const prior = await packageWebsite(rpc, source, ref);
  const primary = prior.files.find(({ path }) => path === prior.entryArtifact);
  if (!primary || !new TextDecoder().decode(primary.bytes).includes(oldCaption))
    throw new Error("The reviewed package did not contain the assigned departure caption");
  let editApplicationId: string | null = null;
  if (world.edit) {
    const repository = await vcs.resolveRepository({ state: before.workingHead, repoPath: source });
    if (!repository) throw new Error("The fixture website is outside the current working state");
    const sourceFile = await vcs.readFile({
      state: before.workingHead, repositoryId: repository.repositoryId,
      file: { kind: "path", path: "copy.ts" },
    });
    if (!sourceFile || sourceFile.content.kind !== "text")
      throw new Error("The source has no assigned copy module");
    const index = sourceFile.content.text.indexOf(oldCaption);
    if (index === -1 || sourceFile.content.text.indexOf(oldCaption, index + 1) !== -1)
      throw new Error("The exact reviewed caption was not uniquely present");
    const result = await vcs.edit({
      contextId, commandId: "publication-review:" + crypto.randomUUID(), intentSummary: "Update the disposable public caption",
      expectedWorkingHead: before.workingHead,
      changes: [{
        kind: "text-edit", repositoryId: sourceFile.repositoryId, fileId: sourceFile.fileId,
        edits: [{ start: index, end: index + oldCaption.length, text: newCaption }],
      }],
    });
    editApplicationId = result.applicationId;
  }
  const sealed = await vcs.status({ contextId });
  const reviewedIntent = { provider: "vercel", destination: "managed-review/departures", environment: "preview" as const };
  const candidateIntent = { ...reviewedIntent, environment: world.environment };
  const bound = bindPublicationRevision({
    goal: world.goal, source, reviewed: prior, reviewedIntent, candidateIntent,
  });
  let observed: Comparison | undefined;
  let reads = 0;
  const services: Binding["services"] = {
    publicationRevision: {
      async compare(id) {
        const result = await bound.services.publicationRevision.compare(id);
        reads++;
        observed = structuredClone(result);
        return result;
      },
    },
  };

  function expectedImpact(comparison: Comparison) {
    const paths = [
      ...comparison.change.added.map(({ path }) => path),
      ...comparison.change.removed.map(({ path }) => path),
      ...comparison.change.modified.map(({ after }) => after.path),
    ].sort();
    return {
      affectedPaths: paths,
      entryChanged: comparison.reviewed.entry !== comparison.candidate.entry ||
        paths.includes(comparison.reviewed.entry) || paths.includes(comparison.candidate.entry),
      htmlChanged: paths.includes("index.html"),
      manifestChanged: paths.includes("vibestudio-build.json"),
    };
  }

  async function verify(report: Report | null) {
    const after = await vcs.status({ contextId });
    const impact = observed && expectedImpact(observed);
    const match = world.environment === "preview" ? "same-target" : "different-target";
    const checks = {
      package: reads >= 1 && observed?.source === source &&
        observed.reviewed.artifactDigest === prior.artifactDigest &&
        observed.reviewed.sourceHash === prior.privateReceipt.sourceStateHash &&
        (world.edit
          ? observed.candidate.sourceHash !== observed.reviewed.sourceHash &&
            observed.candidate.artifactDigest !== observed.reviewed.artifactDigest &&
            impact?.entryChanged === true && impact.manifestChanged
          : observed.candidate.sourceHash === observed.reviewed.sourceHash &&
            observed.candidate.artifactDigest === observed.reviewed.artifactDigest && impact?.affectedPaths.length === 0) &&
        isDeepStrictEqual(report?.comparison, observed),
      target: report?.match === match &&
        isDeepStrictEqual(observed?.reviewed.intent, reviewedIntent) &&
        isDeepStrictEqual(observed?.candidate.intent, candidateIntent),
      decision: report?.decision === world.decision && isDeepStrictEqual(report.impact, impact) &&
        typeof report.reason === "string" && !!report.reason.trim(),
      protection: after.mainEventId === before.mainEventId && isDeepStrictEqual(after.workingHead, sealed.workingHead) &&
        (world.edit
          ? sealed.workingHead.kind === "application" && sealed.workingHead.applicationId === editApplicationId
          : isDeepStrictEqual(sealed.workingHead, before.workingHead)),
    };
    return { ...input, request: bound.request, observed, editApplicationId, checks, passed: Object.values(checks).every(Boolean) };
  }
  async function qualify() {
    const comparison = await services.publicationRevision.compare(bound.request.operationId);
    return verify({
      comparison, impact: expectedImpact(comparison), match: world.environment === "preview" ? "same-target" : "different-target",
      decision: world.decision, reason: "Use the exact package and destination comparison.",
    });
  }
  return { request: bound.request, services, qualify, verify };
}

type Prepared = Awaited<ReturnType<typeof preparePublicationRevision>>;
export interface PublicationRevisionReceiver {
  runPublicationRevisionTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyPublicationRevision(input: Input): ReturnType<Prepared["qualify"]>;
}
export const publicationRevisionMethods = createReceiverRpcMethods<PublicationRevisionReceiver>([
  "runPublicationRevisionTeacher", "qualifyPublicationRevision",
]);
