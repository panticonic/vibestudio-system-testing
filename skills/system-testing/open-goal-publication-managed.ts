import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { packageWebsite } from "@workspace/integrations/website";
import { panelTree, rpc, vcs } from "@workspace/runtime";
import { createWebsiteReadback } from "@workspace-skills/publish-preflight-bindings";
import { bindPublicationRevision } from "@workspace-skills/publication-revision-bindings";
import {
  publicationGoalLaunchFacts, publicationGoalWorlds,
  type PublicationGoalWorld,
} from "./open-goal-publication-worlds.js";

type Input = { contextId: string; caseId: string; source: string };
type CandidateInput = Input & { panelId: string; reviewedRef?: `state:${string}` };
type Facts = ReturnType<typeof publicationGoalLaunchFacts>;
type Choice = PublicationGoalWorld["expected"]["choice"];
type PreflightObservation = Awaited<ReturnType<ReturnType<typeof createWebsiteReadback>["observe"]>>;
type Revision = ReturnType<typeof bindPublicationRevision>;
type Comparison = Awaited<ReturnType<Revision["services"]["publicationRevision"]["compare"]>>;
const contextRef = (id: string) => `ctx:${id}` as const;

function findWorld(caseId: string) {
  const world = publicationGoalWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown open publishing goal");
  return world;
}

/** Prepare an actual workspace revision before the candidate renderer opens. */
export async function seedOpenPublicationGoal(input: Input): Promise<`state:${string}` | undefined> {
  const world = findWorld(input.caseId);
  if (!world.revisedCaption) return undefined;
  const { source, contextId } = input;
  const prior = await packageWebsite(rpc, source, contextRef(contextId));
  const hash = prior.privateReceipt.sourceStateHash;
  if (!hash?.startsWith("state:")) throw new Error("The prior website package has no immutable source state");
  const { workingHead } = await vcs.status({ contextId });
  const repo = await vcs.resolveRepository({ state: workingHead, repoPath: source });
  if (!repo) throw new Error("The owned website source is absent");
  const file = await vcs.readFile({ state: workingHead, repositoryId: repo.repositoryId, file: { kind: "path", path: "copy.ts" } });
  const text = file?.content.kind === "text" ? file.content.text : "";
  const start = text.indexOf(world.caption);
  if (!file || start < 0 || text.indexOf(world.caption, start + 1) >= 0)
    throw new Error("The retained website caption is absent or ambiguous");
  const edit = await vcs.edit({
    contextId, commandId: `open-publication:seed-change:${contextId}`, expectedWorkingHead: workingHead,
    changes: [{ kind: "text-edit", repositoryId: repo.repositoryId, fileId: file.fileId,
      edits: [{ start, end: start + world.caption.length, text: world.revisedCaption }] }],
  });
  if (!edit.changeIds.length) throw new Error("The disposable website source did not change");
  return hash as `state:${string}`;
}

async function readLaunchFacts({ source, contextId }: Input) {
  const { workingHead } = await vcs.status({ contextId });
  const repo = await vcs.resolveRepository({ state: workingHead, repoPath: source });
  if (!repo) throw new Error("The owned website source is absent");
  const receipt = await vcs.readFile({
    state: workingHead, repositoryId: repo.repositoryId, file: { kind: "path", path: "launch-review.json" },
  });
  if (receipt?.content.kind !== "text") throw new Error("The owned launch review is absent");
  const facts = JSON.parse(receipt.content.text) as Facts;
  if (!facts.title || !Array.isArray(facts.labels) || !Array.isArray(facts.targets) ||
      facts.targets.length < 2 || new Set(facts.targets.map(({ id }) => id)).size !== facts.targets.length)
    throw new Error("The owned launch review has invalid destination coordinates");
  return { facts, workingHead, hash: receipt.contentHash };
}

function disposition(result: PreflightObservation, action: NonNullable<Choice["preflight"]>) {
  const { artifact, presentation, publication, matchesRequest } = result;
  const blockers = !matchesRequest ? ["different-request"] : [
    ...(!artifact.referenceMatches ? ["source-reference"] : []),
    ...(!artifact.hasHtml ? ["html-entry"] : []),
    ...(!artifact.manifestMatches ? ["public-manifest"] : []),
    ...(artifact.unapprovedFiles.length ? ["public-paths"] : []),
    ...(!presentation.matchesPanelAttempt ? ["stale-panel"] :
      presentation.missedProbes.length ? ["missing-presentation"] : []),
    ...(action === "check-existing" ? !publication ? ["missing-publication"] :
      !publication.matchesIntent || !publication.matchesOperation || !publication.matchesArtifact
        ? ["different-publication"] : ["awaiting-provider"] : []),
  ];
  const next = action === "prepare" ? undefined :
    blockers.some(blocker => blocker !== "missing-publication" && blocker !== "awaiting-provider") ? "hold-review" :
      !publication ? "recover-receipt" : publication.phase === "submitted" ? "watch-provider" : "resume-operation";
  return {
    status: !blockers.length ? "ready-for-review" :
      blockers.every(blocker => blocker === "awaiting-provider") ? "waiting" : "blocked",
    blockers, ...(next ? { next } : {}),
  };
}

function revisionOutcome(comparison: Comparison) {
  const { reviewed, candidate, change } = comparison;
  const affectedPaths = [
    ...change.added.map(({ path }) => path),
    ...change.removed.map(({ path }) => path),
    ...change.modified.map(({ after }) => after.path),
  ].sort();
  const sameTarget = isDeepStrictEqual(reviewed.intent, candidate.intent);
  return {
    impact: { affectedPaths, entryChanged: reviewed.entry !== candidate.entry ||
      affectedPaths.includes(reviewed.entry) || affectedPaths.includes(candidate.entry),
    htmlChanged: affectedPaths.includes("index.html"), manifestChanged: affectedPaths.includes("vibestudio-build.json") },
    match: sameTarget ? "same-target" : "different-target",
    decision: !sameTarget ? "review-target" : affectedPaths.length || reviewed.artifactDigest !== candidate.artifactDigest ||
      reviewed.entry !== candidate.entry ? "review-public-change" : "keep-review",
  };
}

export async function prepareOpenPublicationGoal(input: CandidateInput) {
  const { contextId, caseId, panelId, source, reviewedRef } = input;
  const world = findWorld(caseId);
  const { goal, expected } = world;
  const ref = contextRef(contextId);
  const panel = panelTree.get(panelId);
  const initial = await vcs.status({ contextId });
  const renderer = await panel.observe();
  if (renderer.kind !== "workspace" || renderer.phase !== "ready" || renderer.contextId !== contextId ||
      renderer.source !== source || renderer.requestedRef !== ref || !renderer.buildKey)
    throw new Error("The publishing review requires the owned current website renderer");
  const build = await rpc.call("main", mainRpcMethods["build.getBuildMetadata"], [renderer.buildKey]);
  if (!build?.sourceStateHash) throw new Error("The renderer has no exact source receipt");
  const readPackage = () => packageWebsite(rpc, source, ref);
  const current = await readPackage();
  const prior = reviewedRef ? await packageWebsite(rpc, source, reviewedRef) : current;

  // Reference setup records private operation history through the actual
  // Host journal. The model gets only observations of existing owned rows.
  const receipts = new Map<string, { intent: Parameters<typeof begin>[0]; seeded: Awaited<ReturnType<typeof begin>> }>();
  function begin(intent: {
    operationId: string;
    artifactDigest: string;
    provider: string;
    destination: string;
    environment: "preview" | "production";
  }) {
    return rpc.call("main", mainRpcMethods["credentials.beginWebsitePublication"], [intent]);
  }
  for (const { id, intent, journal } of world.targets) {
    if (!journal) continue;
    const owned = { ...intent, operationId: `managed-publication-${contextId}-${id}`,
      artifactDigest: journal.digest === "prior" ? prior.artifactDigest : current.artifactDigest };
    let seeded = await begin(owned);
    if (journal.phase !== "prepared") {
      seeded = await rpc.call("main", mainRpcMethods["credentials.recordWebsitePublication"], [
        owned, journal.phase === "submitted" ? { phase: "submitted", deploymentId: `disposable-${id}` } : { phase: journal.phase },
      ]);
    }
    receipts.set(id, { intent: owned, seeded });
  }

  let discovery: { revision: string; facts: Facts } | undefined;
  let selected: Choice | undefined;
  let boundPreflight: ReturnType<typeof createWebsiteReadback> | undefined;
  let boundRevision: Revision | undefined;
  let observed: PreflightObservation | undefined;
  let compared: Comparison | undefined;
  let preflightReads = 0;
  let revisionReads = 0;
  const readPanel = async () => {
    const snapshot = await panel.snapshot();
    return { snapshot, panel: await panel.observe() };
  };
  const services = {
    publicationGoal: {
      async discover() {
        const read = await readLaunchFacts(input);
        const revision = sha256HexSyncText(JSON.stringify([read.hash, read.workingHead, renderer.attemptId]));
        discovery = { revision, facts: read.facts };
        return { site: read.facts.title, revision,
          targets: read.facts.targets.map(({ id, name, intent, audience, review }) =>
            ({ id, name, intent, audience, hasRetainedReview: review !== undefined })) };
      },
      async bind(revision: string, choice: Choice) {
        const basis = discovery;
        if (!basis || revision !== basis.revision || selected || !choice || typeof choice.compareRevision !== "boolean" ||
            ![null, "prepare", "check-existing"].includes(choice.preflight) ||
            (!choice.preflight && !choice.compareRevision)) return null;
        const target = basis.facts.targets.find(({ id }) => id === choice.targetId);
        if (!target || (choice.compareRevision && !target.review)) return null;
        const read = await readLaunchFacts(input);
        const active = await panel.observe();
        if (active.attemptId !== renderer.attemptId || active.buildKey !== renderer.buildKey ||
            sha256HexSyncText(JSON.stringify([read.hash, read.workingHead, active.attemptId])) !== revision)
          return null;
        selected = structuredClone(choice);
        if (choice.preflight) {
          const receipt = choice.preflight === "check-existing" ? receipts.get(target.id) : undefined;
          boundPreflight = createWebsiteReadback({
            reviewedSourceHash: build.sourceStateHash!,
            requestedIntent: target.intent,
            reviewedIntent: target.review?.intent ?? { ...target.intent, provider: "no-retained-review" },
            panelId, panelRef: ref, panelBuildKey: renderer.buildKey!,
            approvedPaths: [".nojekyll", "index.html", "vibestudio-build.json",
              ...(target.review?.entryApproved === false ? [] : [current.entryArtifact])],
            presentationProbes: basis.facts.labels,
            operationId: receipt?.intent.operationId ?? null,
          }, {
            readPackage, readPanel,
            readPublication: async () => receipt ? { receipt: await begin(receipt.intent), readyUrl: null, verified: null } : null,
          });
        }
        if (choice.compareRevision && target.review) {
          boundRevision = bindPublicationRevision({
            goal, source, reviewed: prior, reviewedIntent: target.review.intent, candidateIntent: target.intent,
          });
        }
        return {
          preflight: choice.preflight ? { goal, audience: target.audience, action: choice.preflight, intendedDestination: target.intent } : null,
          revision: boundRevision?.request ?? null,
        };
      },
    },
    websiteReadback: {
      async observe() {
        if (!boundPreflight || preflightReads++) throw new Error("Select one observed publication target before reading its preflight evidence");
        const value = await boundPreflight.observe();
        observed = structuredClone(value);
        return value;
      },
    },
    publicationRevision: {
      async compare(id: string) {
        if (!boundRevision || revisionReads++) throw new Error("Select an observed destination and retained review before comparing revisions");
        const value = await boundRevision.services.publicationRevision.compare(id);
        compared = structuredClone(value);
        return value;
      },
    },
  };

  async function verify(value: unknown) {
    const wrapper = value as { status?: string; skill?: string; outcome?: unknown } | null;
    const report = wrapper?.status === "workspace-skill-reviewed" && wrapper.skill === "publication"
      ? wrapper.outcome as {
          status?: string; choice?: Choice;
          preflight?: { status?: string; blockers?: string[]; next?: string; evidence?: string[] } | null;
          revision?: { comparison?: Comparison; decision?: string; match?: string; impact?: unknown; reason?: string } | null;
        } : null;
    const [{ panel: latest, snapshot }, repackaged, state, fresh, journal] = await Promise.all([
      readPanel(), readPackage(), vcs.status({ contextId }), readLaunchFacts(input),
      Promise.all([...receipts.entries()].map(async ([id, receipt]) => ({ id, seeded: receipt.seeded, current: await begin(receipt.intent) }))),
    ]);
    const outcome = report?.preflight;
    const revision = report?.revision;
    const expectedPreflight = expected.preflight;
    const projected = observed && selected?.preflight ? disposition(observed, selected.preflight) : null;
    const projectedRevision = compared ? revisionOutcome(compared) : null;
    const checks = {
      discoveredLaunchRecord: !!discovery && isDeepStrictEqual(discovery.facts, fresh.facts) &&
        isDeepStrictEqual(discovery.facts, publicationGoalLaunchFacts(world)),
      choseExactReview: isDeepStrictEqual(selected, expected.choice) && report?.status === "reviewed" &&
        isDeepStrictEqual(report.choice, selected),
      boundWebsiteReadback: latest.panelId === panelId && snapshot.panelId === panelId && latest.attemptId === renderer.attemptId &&
        latest.buildKey === renderer.buildKey && snapshot.buildKey === latest.buildKey && snapshot.attemptId === latest.attemptId &&
        snapshot.runtimeEntityId === latest.runtimeEntityId && snapshot.document.text.includes(world.title) &&
        snapshot.document.text.includes(world.revisedCaption ?? world.caption) &&
        (world.labels ?? []).every(({ text, packageOnly }) => snapshot.document.text.includes(text) === !packageOnly),
      rereadCurrentAndRetainedPackage: repackaged.artifactDigest === current.artifactDigest &&
        repackaged.privateReceipt.sourceStateHash === current.privateReceipt.sourceStateHash &&
        prior.artifactDigest !== "" && (world.revisedCaption ? prior.artifactDigest !== current.artifactDigest : prior.artifactDigest === current.artifactDigest),
      exactPreflight: expectedPreflight ? preflightReads === 1 && !!projected &&
        projected.status === expectedPreflight.status && outcome?.status === projected.status &&
        projected.next === expectedPreflight.next && outcome.next === projected.next && Array.isArray(outcome.blockers) &&
        isDeepStrictEqual([...projected.blockers].sort(), [...expectedPreflight.blockers].sort()) &&
        isDeepStrictEqual([...outcome.blockers].sort(), [...projected.blockers].sort()) &&
        (projected.blockers.includes("different-request") ||
          outcome.evidence?.some(item => typeof item === "string" && item.includes(current.artifactDigest)) === true)
        : preflightReads === 0 && outcome === null,
      exactRevision: expected.decision ? revisionReads === 1 && !!projectedRevision && !!compared &&
        compared.reviewed.artifactDigest === prior.artifactDigest && compared.candidate.artifactDigest === current.artifactDigest &&
        projectedRevision.decision === expected.decision && revision?.decision === projectedRevision.decision &&
        revision.match === projectedRevision.match && isDeepStrictEqual(revision.impact, projectedRevision.impact) &&
        isDeepStrictEqual(revision.comparison, compared) && typeof revision.reason === "string" && revision.reason.trim().length > 0
        : revisionReads === 0 && revision === null,
      localJournalUnchanged: journal.every(({ current: retained, seeded }) => isDeepStrictEqual(retained, seeded)) &&
        journal.length === world.targets.filter(target => target.journal).length,
      protectedHeads: initial.mainEventId === state.mainEventId && isDeepStrictEqual(initial.workingHead, state.workingHead),
    };
    return { passed: Object.values(checks).every(Boolean), contextId, caseId, panelId, goal, source, checks,
      selected, observations: { preflight: observed ?? null, revision: compared ?? null },
      artifact: { current: current.artifactDigest, prior: prior.artifactDigest, sourceStateHash: current.privateReceipt.sourceStateHash },
      renderer: { attemptId: latest.attemptId, buildKey: latest.buildKey, snapshotAttemptId: snapshot.attemptId },
      journal, reads: { preflight: preflightReads, revision: revisionReads } };
  }

  async function qualify() {
    const available = await services.publicationGoal.discover();
    const choice = expected.choice;
    const request = await services.publicationGoal.bind(available.revision, choice);
    if (!request) throw new Error("The reference could not bind the current publication review");
    const comparison = request.revision ? await services.publicationRevision.compare(request.revision.operationId) : null;
    const observation = request.preflight ? await services.websiteReadback.observe() : null;
    const preflight = observation && choice.preflight ? { ...disposition(observation, choice.preflight),
      evidence: [observation.artifact.artifactDigest] } : null;
    return verify({ status: "workspace-skill-reviewed", skill: "publication", outcome: {
      status: "reviewed", choice, preflight, revision: comparison ? { ...revisionOutcome(comparison), comparison,
        reason: "Compare the exact package and destination receipts." } : null,
    } });
  }

  return { goal, services, verify, qualify };
}
