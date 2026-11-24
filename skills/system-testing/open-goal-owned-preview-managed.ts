import {assessSemanticOutcome} from "./semantic-outcome-contract.js";
import {assessObservedApplicationOutcome} from "./observed-application-outcome.js";
import type {InvocationObservations} from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { sha256Hex, sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { deployToVercel, packageWebsite, verifyPublishedWebsite, type PublicationReceipt } from "@workspace/integrations/website";
import { fs, panelTree, rpc, vcs } from "@workspace/runtime";
import { createWebsiteReadback } from "@workspace-skills/publish-preflight-bindings";
import { openGoalOwnedPreviewWorlds, ownedPreviewLaunchFacts, type OpenOwnedPreviewWorld } from "./open-goal-owned-preview-worlds.js";
import { createOwnedPreviewProvider } from "./owned-preview-provider.js";

type Input = { contextId: string; caseId: string; panelId: string; source: string; reviewedRef?: `state:${string}` };
type Launch = ReturnType<typeof ownedPreviewLaunchFacts>;
type Destination = OpenOwnedPreviewWorld["destinations"][number];
type Preflight = Awaited<ReturnType<ReturnType<typeof createWebsiteReadback>["observe"]>>;
type Progress = { status: "submitted"; receipt: PublicationReceipt } |
  { status: "retryable"; receipt: PublicationReceipt; reason: string };
type Hosted = { status: "pending"; reason: string } |
  { status: "verified"; receipt: PublicationReceipt; fileCount: number; publicUrl: string };

const selectedWorld = (caseId: string) => {
  const world = openGoalOwnedPreviewWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown owned preview goal.");
  return world;
};
export { selectedWorld as selectOwnedPreviewWorld };

export async function prepareOpenOwnedPreviewGoal(input: Input) {
  const { contextId, caseId, panelId, source, reviewedRef } = input;
  const world = selectedWorld(caseId);
  const { goal, expected } = world;
  const ref = `ctx:${contextId}` as const;
  const panel = panelTree.get(panelId);
  const initial = await vcs.status({ contextId });
  const renderer = await panel.observe();
  if (renderer.kind !== "workspace" || renderer.phase !== "ready" || renderer.contextId !== contextId ||
      renderer.source !== source || renderer.requestedRef !== ref || !renderer.buildKey)
    throw new Error("The owned preview must use the original workspace renderer.");
  const current = await packageWebsite(rpc, source, ref);
  const reviewed = reviewedRef ? await packageWebsite(rpc, source, reviewedRef) : current;
  if (!reviewed.privateReceipt.sourceStateHash || !current.privateReceipt.sourceStateHash)
    throw new Error("Preview publication requires exact immutable source identities.");
  const directory = await fs.mkdtemp("owned-website-preview");

  async function readLaunch() {
    const { workingHead } = await vcs.status({ contextId });
    const repository = await vcs.resolveRepository({ state: workingHead, repoPath: source });
    if (!repository) throw new Error("The owned preview source is absent.");
    const file = await vcs.readFile({
      state: workingHead, repositoryId: repository.repositoryId, file: { kind: "path", path: "launch-review.json" },
    });
    if (file?.content?.kind !== "text") throw new Error("The owned preview launch record is absent.");
    const facts = JSON.parse(file.content.text) as Launch;
    if (!facts.title || !Array.isArray(facts.labels) || !Array.isArray(facts.destinations) ||
        facts.destinations.length < 2 || new Set(facts.destinations.map(({ id }) => id)).size !== facts.destinations.length)
      throw new Error("The owned preview launch record contains invalid destination identities.");
    const latest = await panel.observe();
    if (latest.attemptId !== renderer.attemptId || latest.buildKey !== renderer.buildKey)
      throw new Error("The renderer changed while resolving the approved launch.");
    const revision = sha256HexSyncText(JSON.stringify([file.contentHash, workingHead, renderer.attemptId, current.artifactDigest]));
    return { facts, revision };
  }

  const begin = (intent: Omit<PublicationReceipt, "phase" | "updatedAt" | "deploymentId" | "url">) =>
    rpc.call("main", mainRpcMethods["credentials.beginWebsitePublication"], [intent]);
  const record = (intent: Parameters<typeof begin>[0], progress: { phase: "destination-ready" | "uploaded" | "submitted"; deploymentId?: string; url?: string }) =>
    rpc.call("main", mainRpcMethods["credentials.recordWebsitePublication"], [intent, progress]);
  function machine(target: Destination) {
    const intent = { ...target.intent, operationId: `managed-preview-${contextId}-${target.id}`, artifactDigest: current.artifactDigest };
    const provider = createOwnedPreviewProvider({ fs, directory, intent,
      journal: { beginWebsitePublication: begin, recordWebsitePublication: record },
      interruptSubmit: world.fault === "submit-once",
    });
    const deploy = () => deployToVercel({
      credentials: provider.credentials, site: current, operationId: intent.operationId,
      project: target.intent.destination, environment: "preview",
    });
    return { intent, provider, deploy };
  }
  let active: ReturnType<typeof machine> | undefined;
  let seededReceipt: PublicationReceipt | null = null;
  if (world.seed) {
    const initialLaunch = await readLaunch();
    const seedTarget = world.seed.targetId;
    const target = initialLaunch.facts.destinations.find(item => item.id === seedTarget);
    if (!target || !target.owned || target.intent.environment !== "preview" || target.review !== "retained")
      throw new Error("The starting preview operation has no owned approval.");
    active = machine(target);
    seededReceipt = await active.deploy();
    if (seededReceipt.phase !== "submitted") throw new Error("The retained preview operation did not submit.");
  }
  const baseline = active?.provider?.trace;
  const baselineUploads = baseline?.uploads?.length ?? 0;
  const baselineSubmissions = baseline?.submissions?.length ?? 0;
  const baselineStarts = baseline?.starts?.length ?? 0;
  const baselineProgress = baseline?.progress?.length ?? 0;

  let discovered: Awaited<ReturnType<typeof readLaunch>> | undefined;
  function discoveryFor(launch: Awaited<ReturnType<typeof readLaunch>>) {
    return { site: launch.facts.title, revision: launch.revision, artifactDigest: current.artifactDigest,
      targets: launch.facts.destinations.map(({ review, ...target }) => ({ ...target, reviewed: review === "retained" })) };
  }
  let binding: { targetId: string; operationId: string | null; hold: string | null;
    preflight: { goal: string; action: "prepare"; audience: string; intendedDestination: Destination["intent"] } | null } | undefined;
  let preflightSource: ReturnType<typeof createWebsiteReadback> | undefined;
  let observation: Preflight | undefined;
  const advances: Progress[] = [];
  const readbacks: Hosted[] = [];
  const attempted = { advance: 0, readback: 0 };
  let busy = false;

  function blockers(value: Preflight) {
    return [
      ...(!value.matchesRequest ? ["different-request"] : []),
      ...(!value.artifact.referenceMatches ? ["source-reference"] : []),
      ...(!value.artifact.manifestMatches ? ["public-manifest"] : []),
      ...(!value.artifact.hasHtml ? ["html-entry"] : []),
      ...(value.artifact.unapprovedFiles.length ? ["public-paths"] : []),
      ...(!value.presentation.matchesPanelAttempt ? ["stale-panel"] : []),
      ...(value.presentation.missedProbes.length ? ["missing-presentation"] : []),
    ];
  }
  async function hostedFiles(machine: NonNullable<typeof active>, receipt: PublicationReceipt) {
    const url = receipt.url;
    if (!url) throw new Error("The original preview URL is absent.");
    const deployment = await machine.provider.readDeployment();
    if (deployment?.id !== receipt.deploymentId || !deployment || `https://${deployment.url}` !== url)
      throw new Error("The stored preview does not match the native deployment receipt.");
    return Promise.all(deployment.files.map(async ({ file, size }) => {
      const response = await machine.provider.serve(new URL(file, url + "/").toString());
      if (!response.ok) throw new Error("The preview did not serve a registered file.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== size) throw new Error("The hosted preview file length changed.");
      return { path: file, size, sha256: sha256Hex(bytes) };
    }));
  }

  const services = {
    ownedPreviewPublication: {
      async discover() {
        discovered = await readLaunch();
        return discoveryFor(discovered);
      },
      async bind(revision: string, targetId: string) {
        if (binding || !discovered || discovered.revision !== revision) return null;
        const fresh = await readLaunch();
        if (binding || fresh.revision !== revision) return null;
        const target = fresh.facts.destinations.find(({ id }) => id === targetId);
        if (!target || (active && active.intent.destination !== target.intent.destination)) return null;
        const hold = !target.owned || target.intent.environment !== "preview" ? "outside-owned-preview"
          : target.review !== "retained" ? "missing-approval" : null;
        if (hold) {
          binding = { targetId, operationId: null, hold, preflight: null };
          return structuredClone(binding);
        }
        active ??= machine(target);
        preflightSource = createWebsiteReadback({
          reviewedSourceHash: reviewed.privateReceipt.sourceStateHash!,
          requestedIntent: target.intent, reviewedIntent: target.intent,
          panelId, panelRef: ref, panelBuildKey: renderer.buildKey!,
          approvedPaths: [".nojekyll", "index.html", "vibestudio-build.json", reviewed.entryArtifact],
          presentationProbes: fresh.facts.labels, operationId: null,
        }, {
          readPackage: () => packageWebsite(rpc, source, ref),
          readPanel: async () => ({ snapshot: await panel.snapshot(), panel: await panel.observe() }),
          readPublication: async () => null,
        });
        binding = { targetId, operationId: active.intent.operationId, hold: null,
          preflight: { goal, action: "prepare", audience: target.audience, intendedDestination: target.intent } };
        return structuredClone(binding);
      },
      async advance(operationId: string): Promise<Progress> {
        attempted.advance++;
        if (!active || !binding || binding.operationId !== operationId || !observation || blockers(observation).length ||
            busy || advances.length >= 2 || current.artifactDigest !== reviewed.artifactDigest ||
            observation.artifact.artifactDigest !== current.artifactDigest)
          throw new Error("Only a current approved, preflighted and owned preview may advance.");
        busy = true;
        try {
          if ((await readLaunch()).revision !== discovered?.revision)
            throw new Error("The approved launch record changed before preview publication.");
          let result: Progress;
          try {
            const receipt = await active.deploy();
            if (receipt.phase !== "submitted") throw new Error("The owned provider did not submit the preview.");
            result = { status: "submitted", receipt };
          } catch (error) {
            const receipt = active.provider.currentReceipt();
            if (receipt?.phase !== "uploaded" || active.provider.trace.submissions.at(-1) !== "interrupted" ||
                !(error instanceof Error) || !error.message.includes("(503")) throw error;
            result = { status: "retryable", receipt, reason: "The provider interrupted submission after the Host recorded uploaded." };
          }
          advances.push(structuredClone(result));
          return result;
        } finally { busy = false; }
      },
      async readback(operationId: string): Promise<Hosted> {
        attempted.readback++;
        const receipt = active?.provider?.currentReceipt();
        if (!active || binding?.operationId !== operationId || receipt?.phase !== "submitted" ||
            busy || !advances.length)
          throw new Error("Read back only the exact submitted owned preview.");
        busy = true;
        try {
          let result: Hosted;
          if (world.fault === "readback-once" && !readbacks.length) {
            try {
              await verifyPublishedWebsite(receipt, async () => new Response(null, { status: 404 }));
              throw new Error("A pending preview may not be reported as verified.");
            } catch (error) {
              if (!(error instanceof Error) || !error.message.includes("(404")) throw error;
            }
            result = { status: "pending", reason: "The submitted preview has not propagated to its readback endpoint yet." };
          } else {
            await verifyPublishedWebsite(receipt, active.provider.serve);
            const files = await hostedFiles(active, receipt);
            result = { status: "verified", receipt, fileCount: files.length, publicUrl: receipt.url! };
          }
          readbacks.push(structuredClone(result));
          return result;
        } finally { busy = false; }
      },
    },
    websiteReadback: {
      async observe() {
        if (!preflightSource || observation) throw new Error("Bind the exact retained preview before preflight.");
        observation = await preflightSource.observe();
        return structuredClone(observation);
      },
    },
  };

  async function verify(value: unknown,invocation?:InvocationObservations) {
    const wrapper = value as {
      status: string; targetId: string; reason: string | null; preflight: { status: string; blockers: string[] } | null;
      receipt: PublicationReceipt | null; hosted: Hosted | null;
    } | null;
    const result = wrapper;
    const retained = active?.provider?.currentReceipt() ?? null;
    const nativeReceipt = !expected.hold && active && retained?.phase === "submitted" ? await begin(active.intent) : null;
    const [final, fresh, after, snapshot, store, files] = await Promise.all([
      packageWebsite(rpc, source, ref), readLaunch(), vcs.status({ contextId }), panel.snapshot(), fs.readdir(directory),
      active && nativeReceipt ? hostedFiles(active, nativeReceipt) : [],
    ]);
    const trace = active?.provider?.trace;
    const starts = trace?.starts?.slice(baselineStarts) ?? [];
    const phases = trace?.progress?.slice(baselineProgress) ?? [];
    const uploads = trace?.uploads?.slice(baselineUploads) ?? [];
    const submissions = trace?.submissions?.slice(baselineSubmissions) ?? [];
    const expectedFiles = final.files.map(({ path, bytes, sha256 }) => ({ path, size: bytes.length, sha256 }));
    const selectedHold = binding?.hold ?? (observation ? blockers(observation)[0] : undefined);
    const visible = snapshot.buildKey === renderer.buildKey && snapshot.attemptId === renderer.attemptId &&
      snapshot.document.text.includes(world.revisedCaption ?? world.caption) &&
      (world.labels ?? []).every(({ text, packageOnly }) => snapshot.document.text.includes(text) === !packageOnly);
    const checks = {
      exactOwnedLaunch: !!discovered && isDeepStrictEqual(fresh, discovered) &&
        isDeepStrictEqual(fresh.facts, ownedPreviewLaunchFacts(world)) && visible &&
        binding?.targetId === expected.targetId,
      exactApprovedArtifact: final.artifactDigest === current.artifactDigest &&
        final.privateReceipt.sourceStateHash === current.privateReceipt.sourceStateHash &&
        (world.revisedCaption ? reviewed.artifactDigest !== current.artifactDigest : reviewed.artifactDigest === current.artifactDigest) &&
        (binding?.hold ? !observation : !!observation&&(expected.hold?blockers(observation).length>0:blockers(observation).length===0)),
      exactHostJournal: expected.hold ? !starts.length && !phases.length && !nativeReceipt && !retained
        : !!nativeReceipt && isDeepStrictEqual(nativeReceipt, retained) &&
          nativeReceipt.operationId === active?.intent?.operationId && nativeReceipt.artifactDigest === current.artifactDigest &&
          nativeReceipt.destination === binding?.targetId && nativeReceipt.environment === "preview" &&
          isDeepStrictEqual(starts.map(({ phase }) => phase), world.seed ? ["submitted"] : world.fault === "submit-once" ? ["prepared", "uploaded"] : ["prepared"]) &&
          isDeepStrictEqual(phases.map(({ phase }) => phase), world.seed ? [] : ["uploaded", "submitted"]),
      exactProviderEffects: expected.hold ? !uploads.length && !submissions.length && !store.length
        : uploads.length === (world.seed ? 0 : current.files.length) && uploads.every(({ stored }) => stored) &&
          isDeepStrictEqual(submissions, world.seed ? [] : world.fault === "submit-once" ? ["interrupted", "accepted"] : ["accepted"]) &&
          isDeepStrictEqual(files, expectedFiles) && store.filter(path => path === "deployment.json").length === 1,
      correctDisposition: attempted.advance === expected.advances.length &&
        attempted.readback >= expected.readbacks.length &&
        isDeepStrictEqual(advances.map(({ status }) => status), expected.advances) &&
        isDeepStrictEqual(readbacks.slice(0, expected.readbacks.length).map(({ status }) => status), expected.readbacks) &&
        readbacks.slice(expected.readbacks.length).every(readback => isDeepStrictEqual(readback, readbacks.at(-1))) &&
        (expected.hold?selectedHold===expected.hold:!world.seed||isDeepStrictEqual(seededReceipt,nativeReceipt)),
      returnedPreviewResult: result?.targetId===expected.targetId&&isDeepStrictEqual(result?.receipt,nativeReceipt)&&
        (binding?.hold?result?.preflight===null:isDeepStrictEqual(result?.preflight?.blockers,observation?blockers(observation):null)&&result?.preflight?.status===(expected.hold?"blocked":"ready-for-review"))&&
        (expected.hold?result?.status==="held"&&result.reason===expected.hold&&result.hosted===null:result?.status==="published"&&result.reason===null&&isDeepStrictEqual(result.hosted,readbacks.at(-1))),
      protectedHeads: initial.mainEventId === after.mainEventId && isDeepStrictEqual(initial.workingHead, after.workingHead) &&
        isDeepStrictEqual(initial.committed, after.committed),
    };
    return assessObservedApplicationOutcome({ passed: Object.values(checks).every(Boolean), contextId, caseId, panelId, goal, checks,
      transport: "owned-file-backed-vercel-preview", discovery: discovered ? discoveryFor(discovered) : null, binding: binding ?? null,
      observation: observation ?? null, advances, readbacks, attempted: { ...attempted }, nativeReceipt, seededReceipt, files, starts, phases, uploads, submissions, store,
      artifact: { current: current.artifactDigest, prior: reviewed.artifactDigest, source: current.privateReceipt.sourceStateHash } },{effects:{checks:["exactOwnedLaunch","exactApprovedArtifact","exactHostJournal","exactProviderEffects","correctDisposition","protectedHeads"],rationale:"Actual native observations, captured operations, protected state and persisted artifact bytes establish the requested effects independently of public copies."},returnedValue:{checks:["returnedPreviewResult"],required:Boolean(expected.hold),rationale:"The requested domain answer is required; a redundant returned copy is optional after a requested native mutation or artifact is established."},incidentalValues:{checks:[],rationale:"Wrong optional returned receipts are masked with their actual hash-checked invocation definition and value."}},value,invocation,[{"checks":["returnedPreviewResult"],"rootPath":[],"producerSourceSuffix":"publishOwnedPreviewGoal/deliverPreview.nl","producerPath":[]}]);
  }

  async function qualify() {
    const launch = await services.ownedPreviewPublication.discover();
    const rejectsDestinationAlias = await services.ownedPreviewPublication.bind(launch.revision, `./${expected.targetId}`) === null;
    const rejectsRevisionAlias = await services.ownedPreviewPublication.bind("different-launch-record", expected.targetId) === null;
    const chosen = await services.ownedPreviewPublication.bind(launch.revision, expected.targetId);
    if (!chosen) throw new Error("The reference did not bind its real launch record.");
    const reviewed = chosen.preflight ? await services.websiteReadback.observe() : null;
    const blocked = reviewed ? blockers(reviewed) : [];
    const hold = chosen.hold ?? blocked[0];
    const preflight = reviewed ? { status: blocked.length ? "blocked" : "ready-for-review", blockers: blocked } : null;
    let receipt: PublicationReceipt | null = null;
    let hosted: Hosted | null = null;
    if (!hold && chosen.operationId) {
      let progress = await services.ownedPreviewPublication.advance(chosen.operationId);
      if (progress.status === "retryable") progress = await services.ownedPreviewPublication.advance(chosen.operationId);
      receipt = progress.receipt;
      hosted = await services.ownedPreviewPublication.readback(chosen.operationId);
      if (hosted.status === "pending") hosted = await services.ownedPreviewPublication.readback(chosen.operationId);
    }
    const result = await verify({
      status: hold ? "held" : "published", targetId: chosen.targetId, reason: hold ?? null, preflight, receipt, hosted,
    });
    let rejectsUnapprovedAdvance = false;
    if (hold) {
      try { await services.ownedPreviewPublication.advance(chosen.operationId ?? "unbound"); }
      catch (error) {
        rejectsUnapprovedAdvance = error instanceof Error && error.message.includes("approved") &&
          !active?.provider?.currentReceipt() && !(await fs.readdir(directory)).length;
      }
    }
    const checks = { ...result.observedChecks, rejectsDestinationAlias, rejectsRevisionAlias, rejectsUnapprovedAdvance: !hold || rejectsUnapprovedAdvance };
    return assessSemanticOutcome({...result,checks},{...result.outcomeContract,effects:{...result.outcomeContract.effects,checks:[...result.outcomeContract.effects.checks,"rejectsDestinationAlias","rejectsRevisionAlias","rejectsUnapprovedAdvance"]}});
  }

  return { goal, services, verify, qualify };
}
