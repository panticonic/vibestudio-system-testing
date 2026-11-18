import { isDeepStrictEqual } from "node:util";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type {
  PanelHandle,
  VcsClient,
  rpc as RuntimeRpc,
} from "@workspace/runtime";
import { packageWebsite } from "@workspace/integrations/website";
import { createWebsiteReadback } from "@workspace-skills/publish-preflight-bindings";
import { managedPublicationWorlds } from "./publication-preflight-worlds.js";

type Rpc = Pick<typeof RuntimeRpc, "call" | "stream">;
type Panel = Pick<PanelHandle, "observe" | "snapshot">;
type Report = { status: string; blockers: string[]; evidence: string[] };

export async function prepareManagedPublication(
  rpc: Rpc,
  vcs: Pick<VcsClient, "status">,
  panel: Panel,
  selected: {
    contextId: string;
    panelSource: string;
    caseId: string;
    goal: string;
  },
) {
  const world = managedPublicationWorlds.find(
    ({ id }) => id === selected.caseId,
  );
  if (!world) throw new Error("Unknown publication preflight case");
  const before = await vcs.status();
  const reviewedPanel = await panel.observe();
  const ref = `ctx:${selected.contextId}` as const;
  if (
    reviewedPanel.kind !== "workspace" ||
    reviewedPanel.phase !== "ready" ||
    reviewedPanel.contextId !== selected.contextId ||
    reviewedPanel.source !== selected.panelSource ||
    reviewedPanel.requestedRef !== ref ||
    !reviewedPanel.buildKey
  )
    throw new Error(
      "The opened panel is outside the assigned preflight context or unavailable",
    );
  const build = await rpc.call(
    "main",
    mainRpcMethods["build.getBuildMetadata"],
    [reviewedPanel.buildKey],
  );
  if (!build?.sourceStateHash)
    throw new Error("The assigned panel has no sealed workspace source state");
  const artifact = await packageWebsite(rpc, selected.panelSource, ref);
  const approvedPaths = [".nojekyll", "index.html", "vibestudio-build.json"];
  if (!world.denyEntry) approvedPaths.push(artifact.entryArtifact);
  const intent = {
    provider: "vercel",
    destination: "managed-review/preview",
    environment: "preview" as const,
  };
  const request = {
    goal: selected.goal,
    audience: world.audience,
    action: world.checkExisting ? "check-existing" : "prepare",
    intendedDestination: intent,
  };
  let reads = 0;
  const service = createWebsiteReadback(
    {
      reviewedSourceHash: build.sourceStateHash,
      requestedIntent: intent,
      reviewedIntent: world.anotherDestination
        ? { ...intent, destination: "managed-review/other" }
        : intent,
      panelId: reviewedPanel.panelId,
      panelRef: ref,
      panelBuildKey: reviewedPanel.buildKey,
      approvedPaths,
      presentationProbes: [{ id: "caption", text: world.requiredCaption }],
      operationId: world.checkExisting ? "unissued-managed-review" : null,
    },
    {
      async readPackage() {
        reads++;
        return artifact;
      },
      async readPanel() {
        const snapshot = await panel.snapshot();
        return { snapshot, panel: await panel.observe() };
      },
      async readPublication() {
        return null;
      },
    },
  );
  return {
    world,
    artifact,
    before,
    reviewedPanel,
    ref,
    request,
    service,
    reads: () => reads,
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedPublication>>;

export async function verifyManagedPublication(
  rpc: Rpc,
  vcs: Pick<VcsClient, "status">,
  panel: Panel,
  prepared: Prepared,
  value: unknown,
) {
  const { before, world, artifact, reviewedPanel } = prepared;
  const current = await vcs.status();
  const capture = await panel.snapshot();
  const latest = await panel.observe();
  const built = await packageWebsite(rpc, latest.source, prepared.ref);
  const report = value as Report | null;
  const expected = world.expectedBlockers;
  const checks = {
    protectedHeadUnchanged:
      before.mainEventId === current.mainEventId &&
      isDeepStrictEqual(before.workingHead, current.workingHead),
    exactPanelCapture:
      latest.attemptId === reviewedPanel.attemptId &&
      capture.attemptId === latest.attemptId &&
      capture.runtimeEntityId === latest.runtimeEntityId &&
      capture.buildKey === latest.buildKey &&
      capture.document.text.includes(world.title) &&
      capture.document.text.includes(world.requiredCaption) ===
        (world.caption === world.requiredCaption),
    localArtifactRepeatable:
      built.artifactDigest === artifact.artifactDigest &&
      built.privateReceipt.sourceStateHash ===
        artifact.privateReceipt.sourceStateHash &&
      built.files.some(({ path }) => path === built.entryArtifact) &&
      built.files.some(({ path }) => path === "index.html"),
    singleReadback: prepared.reads() === 1,
    verifiedDisposition:
      report?.status === (expected.length ? "blocked" : "ready-for-review") &&
      Array.isArray(report.blockers) &&
      isDeepStrictEqual([...report.blockers].sort(), [...expected].sort()) &&
      (world.anotherDestination ||
        report.evidence?.some((item) =>
          item.includes(artifact.artifactDigest),
        )),
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    caseId: world.id,
    seedRevision: JSON.stringify(before.workingHead),
    artifactDigest: artifact.artifactDigest,
    publicPaths: artifact.files.map(({ path }) => path),
    panelAttempt: latest.attemptId,
  };
}

export async function qualifyManagedPublication(
  rpc: Rpc,
  vcs: Pick<VcsClient, "status">,
  panel: Panel,
  prepared: Prepared,
) {
  const observed = await prepared.service.observe();
  const { artifact, presentation, matchesRequest } = observed;
  const blockers = !matchesRequest
    ? ["different-request"]
    : [
        ...(!artifact.referenceMatches ? ["source-reference"] : []),
        ...(!artifact.hasHtml ? ["html-entry"] : []),
        ...(!artifact.manifestMatches ? ["public-manifest"] : []),
        ...(artifact.unapprovedFiles.length ? ["public-paths"] : []),
        ...(!presentation.matchesPanelAttempt
          ? ["stale-panel"]
          : presentation.missedProbes.length
            ? ["missing-presentation"]
            : []),
        ...(prepared.world.checkExisting ? ["missing-publication"] : []),
      ];
  const reference = {
    status: blockers.length ? "blocked" : "ready-for-review",
    blockers,
    evidence: [artifact.artifactDigest],
  };
  const accepted = await verifyManagedPublication(
    rpc,
    vcs,
    panel,
    prepared,
    reference,
  );
  const forged = await verifyManagedPublication(rpc, vcs, panel, prepared, {
    ...reference,
    status: "verified",
  });
  return { accepted, rejectedUnpublishedClaim: !forged.passed };
}
