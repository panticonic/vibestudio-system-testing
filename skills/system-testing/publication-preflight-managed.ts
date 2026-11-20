import { isDeepStrictEqual } from "node:util";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type {
  PanelHandle,
  VcsClient,
  rpc as RuntimeRpc,
} from "@workspace/runtime";
import { packageWebsite } from "@workspace/integrations/website";
import { createWebsiteReadback, type PublicationNext } from "@workspace-skills/publish-preflight-bindings";
import { managedPublicationWorlds } from "./publication-preflight-worlds.js";

type Rpc = Pick<typeof RuntimeRpc, "call" | "stream">;
type Panel = Pick<PanelHandle, "observe" | "snapshot">;
type Report = {
  status: string;
  blockers: string[];
  evidence: string[];
  visual?: string;
  next?: PublicationNext;
};

function disposition(blockers: string[]) {
  if (!blockers.length) return "ready-for-review";
  return blockers.every((blocker) => blocker === "awaiting-provider" || blocker === "verify-public")
    ? "waiting"
    : "blocked";
}

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
    provider: world.journalPhase === "destination-ready" ? "cloudflare-pages" : "vercel",
    destination: "managed-review/preview",
    environment: "preview" as const,
  };
  const journalIntent = {
    ...intent,
    operationId: `managed-publication-${selected.contextId}`,
    artifactDigest: world.staleJournalArtifact ? `sha256:${"0".repeat(64)}` : artifact.artifactDigest,
  };
  const readJournal = () => rpc.call("main", mainRpcMethods["credentials.beginWebsitePublication"], [journalIntent]);
  let seededReceipt: Awaited<ReturnType<typeof readJournal>> | null = null;
  if (world.journalPhase) {
    // Seed historical receipts through the real host journal in this disposable
    // instance. No credential lookup, provider request or public fetch is used.
    seededReceipt = await readJournal();
    if (world.journalPhase !== "prepared") {
      seededReceipt = await rpc.call("main", mainRpcMethods["credentials.recordWebsitePublication"], [
        journalIntent,
        world.journalPhase === "submitted"
          ? { phase: "submitted", deploymentId: "disposable-deployment" }
          : { phase: world.journalPhase },
      ]);
    }
  }
  const request = {
    goal: selected.goal,
    audience: world.audience,
    action: world.checkExisting ? "check-existing" : "prepare",
    intendedDestination: intent,
  };
  const reviewedIntent = {
    provider:
      world.approvalMismatch === "provider"
        ? "other-provider"
        : intent.provider,
    destination: world.anotherDestination
      ? "managed-review/other"
      : intent.destination,
    environment:
      world.approvalMismatch === "environment"
        ? ("production" as const)
        : intent.environment,
  };
  // Deliver controlled packaging faults after the canonical build has been captured.
  const delivered = {
    ...artifact,
    files: artifact.files
      .filter(
        ({ path }) =>
          world.deliveredPackage !== "without-html" || path !== "index.html",
      )
      .map((file) =>
        world.deliveredPackage === "changed-manifest" &&
        file.path === "vibestudio-build.json"
          ? { ...file, bytes: new TextEncoder().encode("{}") }
          : file,
      ),
  };
  let reads = 0;
  const service = createWebsiteReadback(
    {
      reviewedSourceHash: build.sourceStateHash,
      requestedIntent: intent,
      reviewedIntent,
      panelId: reviewedPanel.panelId,
      panelRef: ref,
      panelBuildKey: reviewedPanel.buildKey,
      approvedPaths,
      presentationProbes: [
        { id: "caption", text: world.requiredCaption },
        ...(world.labels ?? []).map(({ id, text }) => ({ id, text })),
      ],
      operationId: world.checkExisting ? journalIntent.operationId : null,
    },
    {
      async readPackage() {
        reads++;
        return delivered;
      },
      async readPanel() {
        const snapshot = await panel.snapshot();
        return { snapshot, panel: await panel.observe() };
      },
      async readPublication() {
        return seededReceipt ? { receipt: await readJournal(), readyUrl: null, verified: null } : null;
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
    seededReceipt,
    readJournal,
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
  const journalReadback = prepared.seededReceipt ? await prepared.readJournal() : null;
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
        (world.caption === world.requiredCaption) &&
      (world.labels ?? []).every(
        ({ text, packageOnly }) =>
          capture.document.text.includes(text) === !packageOnly,
      ),
    localArtifactRepeatable:
      built.artifactDigest === artifact.artifactDigest &&
      built.privateReceipt.sourceStateHash ===
        artifact.privateReceipt.sourceStateHash &&
      built.files.some(({ path }) => path === built.entryArtifact) &&
      built.files.some(({ path }) => path === "index.html"),
    singleReadback: prepared.reads() === 1,
    exactJournalReadback:
      isDeepStrictEqual(journalReadback, prepared.seededReceipt) &&
      journalReadback?.phase === world.journalPhase,
    verifiedDisposition:
      report?.status === disposition(expected) &&
      Array.isArray(report.blockers) &&
      isDeepStrictEqual([...report.blockers].sort(), [...expected].sort()) &&
      report.next === world.expectedNext &&
      (!world.journalPhase || world.staleJournalArtifact ||
        report.evidence?.some((item) => item.includes(world.journalPhase!))) &&
      (!world.expectedVisual || report.visual === world.expectedVisual) &&
      (expected.includes("different-request") ||
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
    visual: report?.visual ?? null,
    next: report?.next ?? null,
    journalPhase: journalReadback?.phase ?? null,
  };
}

export async function qualifyManagedPublication(
  rpc: Rpc,
  vcs: Pick<VcsClient, "status">,
  panel: Panel,
  prepared: Prepared,
) {
  const observed = await prepared.service.observe();
  const { artifact, presentation, publication, matchesRequest } = observed;
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
        ...(prepared.world.checkExisting
          ? !publication ? ["missing-publication"]
            : !publication.matchesIntent || !publication.matchesOperation || !publication.matchesArtifact
              ? ["different-publication"] : ["awaiting-provider"]
          : []),
      ];
  const next = !prepared.world.checkExisting ? undefined
    : blockers.some((blocker) => blocker !== "missing-publication" && blocker !== "awaiting-provider")
      ? "hold-review"
      : !publication ? "recover-receipt"
      : publication.phase === "submitted" ? "watch-provider" : "resume-operation";
  const reference = {
    status: disposition(blockers),
    blockers,
    evidence: [artifact.artifactDigest, ...(publication ? [publication.phase] : [])],
    visual: prepared.world.expectedVisual,
    next,
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
