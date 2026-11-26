import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prepareOpenPublicationGoal } from "./open-goal-publication-managed.js";
import { publicationGoalLaunchFacts, publicationGoalWorlds } from "./open-goal-publication-worlds.js";

const state = vi.hoisted(() => ({
  facts: "",
  visible: "",
  candidate: {} as ReturnType<typeof website>,
  prior: {} as ReturnType<typeof website>,
  journal: new Map<string, Record<string, unknown>>(),
  head: "committed",
}));
const panel = {
  panelId: "review-panel", kind: "workspace", phase: "ready", contextId: "owned",
  source: "panels/disposable", requestedRef: "ctx:owned",
  buildKey: "review-build", attemptId: "attempt", runtimeEntityId: "runtime",
};
vi.mock("@workspace/runtime", () => ({
  contextId: "owned",
  panelTree: { get: () => ({
    observe: async () => panel,
    snapshot: async () => ({ ...panel, document: { text: state.visible } }),
  }) },
  vcs: {
    status: async () => ({ mainEventId: "main", workingHead: { kind: "event", eventId: state.head } }),
    resolveRepository: async () => ({ repositoryId: "repo" }),
    readFile: async () => ({ content: { kind: "text", text: state.facts }, contentHash: "facts" }),
  },
  rpc: {
    call: async (_target: string, _method: unknown, args: [string | Record<string, unknown>, Record<string, unknown>?]) => {
      const [input, progress] = args;
      if (typeof input === "string") return { sourceStateHash: state.candidate.privateReceipt.sourceStateHash };
      const operationId = String(input.operationId);
      const existing = state.journal.get(operationId) ?? { ...input, phase: "prepared" };
      const value = progress ? { ...existing, ...progress } : existing;
      state.journal.set(operationId, value);
      return value;
    },
  },
}));
vi.mock("@workspace/integrations/website", () => ({
  packageWebsite: async (_rpc: unknown, _source: string, ref: string) => ref === "state:prior" ? state.prior : state.candidate,
}));

function website(content: string, revision: string) {
  const bytes = (s: string) => new TextEncoder().encode(s);
  const sha256 = (input: Uint8Array | string) => createHash("sha256").update(input).digest("hex");
  const file = (path: string, contents: string) => ({ path, bytes: bytes(contents), sha256: sha256(contents),
    contentType: path.endsWith(".html") ? "text/html" : "application/octet-stream" });
  const buildId = sha256(content);
  const entryArtifact = "site.js";
  const publicFiles = [file("index.html", "<script src=\"./site.js\"></script>"), file(entryArtifact, content)];
  return {
    buildId, artifactDigest: `sha256:${buildId}`, entryArtifact, privateReceipt: { sourceStateHash: `state:${revision}` },
    files: [...publicFiles, file("vibestudio-build.json", JSON.stringify({
      version: 1, buildId, entry: entryArtifact,
      files: publicFiles.map(({ path, sha256, bytes }) => ({ path, sha256, size: bytes.byteLength })),
    }))],
  };
}

function prepare(caseId: string) {
  const world = publicationGoalWorlds.find(({ id }) => id === caseId)!;
  state.head = "committed";
  state.journal.clear();
  state.facts = JSON.stringify(publicationGoalLaunchFacts(world));
  state.visible = [world.title, world.revisedCaption ?? world.caption,
    ...(world.labels ?? []).filter(({ packageOnly }) => !packageOnly).map(({ text }) => text)].join("\n");
  state.candidate = website([state.visible, ...(world.labels ?? []).map(({ text }) => text)].join("\n"), "current");
  state.prior = world.revisedCaption ? website(world.title + world.caption, "prior") : state.candidate;
  return prepareOpenPublicationGoal({
    caseId, contextId: "owned", source: panel.source, panelId: panel.panelId,
    ...(world.revisedCaption ? { reviewedRef: "state:prior" } : {}),
  });
}

it("chooses the actual press target and withholds review when a warning is package-only", async () => {
  const prepared = await prepare("identify-station-press-package-only-warning");
  const proof = await prepared.qualify();
  expect(proof.passed).toBe(true);
  expect(proof.observations.preflight?.presentation.missedProbes).toEqual(["lift-closure"]);
  expect(proof.selected?.targetId).toBe("station-press");
  expect(proof.journal).toEqual([]);
});

it("binds only observed destination IDs at the revision returned by discovery", async () => {
  const prepared = await prepare("review-photo-desk-caption");
  const { publicationGoal } = prepared.services;
  const choice = { targetId: "preview", preflight: "prepare" as const, compareRevision: false };
  const observation = await publicationGoal.discover();
  expect(await publicationGoal.bind(observation.revision, { ...choice, targetId: "Photo desk preview" })).toBeNull();
  state.head = "new-revision";
  expect(await publicationGoal.bind(observation.revision, choice)).toBeNull();
  const next = await publicationGoal.discover();
  expect(next.revision).not.toBe(observation.revision);
  expect((await publicationGoal.bind(next.revision, choice))?.preflight?.intendedDestination.destination)
    .toBe("photo-desk/review");
});

it("recovers the requested upload without treating a separate submitted receipt as proof", async () => {
  const prepared = await prepare("recover-library-partner-upload");
  const proof = await prepared.qualify();
  expect(proof.passed).toBe(true);
  expect(proof.observations.preflight?.publication?.phase).toBe("uploaded");
  expect(proof.journal.map(({ current }) => current.phase)).toEqual(["submitted", "uploaded"]);
  const verification = await prepared.verify({
      status: "reviewed", choice: proof.selected, revision: null, preflight: {
        status: "verified", blockers: [], evidence: [proof.artifact.current],
      },
    });
  expect(verification.checks.exactPreflight).toBe(false);
});

it("uses both the current preview and the immutable older package for a compound review", async () => {
  const prepared = await prepare("reassess-trail-preview-after-correction");
  const proof = await prepared.qualify();
  expect(proof.passed).toBe(true);
  expect(proof.reads).toEqual({ preflight: 1, revision: 1 });
  expect(proof.observations.revision?.candidate.artifactDigest).toBe(proof.artifact.current);
  expect(proof.observations.revision?.reviewed.artifactDigest).toBe(proof.artifact.prior);
  expect(proof.artifact.prior).not.toBe(proof.artifact.current);
});


it.each(publicationGoalWorlds.map(({ id }) => id))("checks the reference outcome for %s", async (caseId) => {
  const prepared = await prepare(caseId);
  const proof = await prepared.qualify();
  expect(proof.checks).toEqual(expect.objectContaining({
    choseExactReview: true, boundWebsiteReadback: true, exactPreflight: true, exactRevision: true,
    localJournalUnchanged: true, protectedHeads: true,
  }));
  expect(proof.passed).toBe(true);
});

// The reference route is not the public goal. Additional accurately bound native
// evidence is allowed, and an absent requested answer still cannot pass.
it("accepts additional truthful evidence without accepting a missing answer or forged comparison",async()=>{
 const prepared=await prepare("review-photo-desk-caption");
 const available=await prepared.services.publicationGoal.discover();
 const choice={targetId:"preview",preflight:"prepare" as const,compareRevision:true};
 const bound=await prepared.services.publicationGoal.bind(available.revision,choice);
 expect(bound?.revision).toBeTruthy();
 await prepared.services.websiteReadback.observe();
 const comparison=await prepared.services.publicationRevision.compare(bound!.revision!.operationId);
 const proof=await prepared.verify({status:"reviewed",choice,preflight:null,revision:null});
 expect(proof.checks.choseExactReview).toBe(true);
 expect(proof.checks.exactPreflight).toBe(true);
 expect(proof.checks.exactRevision).toBe(true);
 expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.semanticReviewInput.actual.observations.observations.revision).toEqual(comparison);
 const absent=await prepared.verify(undefined);
 expect(absent.checks.returnedPublicationScope).toBe(false);
 expect(absent.outcomeContract.returnedValue.required).toBe(true);
 const forged=await prepared.verify({status:"reviewed",choice,preflight:null,revision:{comparison:{...comparison,candidate:{...comparison.candidate,artifactDigest:"forged"}},decision:"keep-review",match:"same",impact:null,reason:"Unobserved comparison"}});
 expect(forged.checks.exactRevision).toBe(false);
});
