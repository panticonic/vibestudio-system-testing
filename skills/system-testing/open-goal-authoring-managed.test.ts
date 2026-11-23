import {assessSemanticOutcome} from "./semantic-outcome-contract.js";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, rename, access } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { prepareOpenAuthoringGoal } from "./open-goal-authoring-managed.js";
import { reviewCompilerReadbacks } from "./authoring-managed.js";

it("joins compiler evidence by role, permits replay and preserves unchanged issued receipts across reinspection", async () => {
  const temp = await mkdtemp("/home/werg/data/vibestudio-open-goal-live/full-luna-campaign-yci2LB1N/rejection-audit/authoring-guard-test-");
  try {
    const description = { functions: [{ source: "review.nl", params: ["text"], returns: "string" }, { source: "review/checkNotes.nl", params: ["text"], returns: "string" }], services: [], serviceScopes: {} };
    const describe = vi.fn(async () => structuredClone(description));
    const tree = (label: string) => ({ "review.nl": `---\ndescription: ${label}\nargs:\n  text: string\nreturns: string\n---\nReview the supplied text.\n`, "review/checkNotes.nl": "---\ndescription: Exact helper\nargs:\n  text: string\nreturns: string\n---\nReview the supplied text.\n" });
    const world = { id: "owned-review", goal: "Compare the current candidate with the approved release. Leave both unchanged.", records: [
      { key: "candidate", label: "Candidate", product: "Owned review", state: "candidate", files: tree("candidate source"),
        contract: { entry: "review.nl", expectedParameters: null, expectedReturn: null, declaredServices: null, requiredHelpers: ["review/checkNotes.nl"], preserveBaseline: true } },
      { key: "release", label: "Approved", product: "Owned review", state: "released", files: tree("released source") },
    ], expected: { candidate: "candidate", baseline: "release", status: "ready", markers: [], stage: false, unresolvedReason: null }, canStage: false };
    const prepared = await prepareOpenAuthoringGoal({ contextId: "owned", caseId: world.id }, world as never, {
      contextId: "owned", describe, vcs: { status: async () => ({ mainEventId: "main", workingHead: { kind: "event", eventId: "main" } }) },
      fs: { mkdtemp: async () => temp, mkdir, readFile, writeFile, readdir, rename, exists: async (p: string) => access(p).then(() => true, () => false) },
    } as never);
    const s = prepared.services;
    const cards = await s.authoringDiscovery.list();
    await s.authoringDiscovery.list();
    const selection = { candidateId: cards.find(row => row.state === "candidate")!.id, baselineId: cards.find(row => row.state === "released")!.id };
    const opened = (await s.authoringDiscovery.open(world.goal, selection))!;
    const baseline = await s.authoringCompiler.inspect("baseline");
    expect(await s.authoringCompiler.inspect("baseline")).toEqual(baseline);
    const candidate = await s.authoringCompiler.inspect("candidate");
    expect(describe).toHaveBeenCalledTimes(2);
    const report = reviewCompilerReadbacks({ request: opened.request, reads: [baseline, candidate] });
    expect(report).toMatchObject({ candidateRevision: candidate.revision, baselineRevision: baseline.revision });
    const receipt = { selection, review: report };
    expect(await s.authoringReviewControl.confirm(receipt)).toBe("current");
    await s.authoringDiscovery.open(world.goal, selection);
    expect(await s.authoringReviewControl.confirm(receipt)).toBe("current");
    const correct = await prepared.verify({status:"reviewed",receipt,artifact:null});
    expect(assessSemanticOutcome(correct).passed).toBe(true);
    const wrong = await prepared.verify({status:"reviewed",receipt:{...receipt,review:{...receipt.review,candidateRevision:"invented-source"}},artifact:null});
    expect(wrong.checks.returnedAuthoringArtifacts).toBe(false);
    expect(wrong.outcomeContract.effects.checks.every(key=>wrong.checks[key])).toBe(true);
    expect(assessSemanticOutcome(wrong).passed).toBe(false);
    // No trace was supplied: never invent a source definition for a rejected value.
      expect(wrong.incorrectReturnValues).toHaveLength(0);
    expect(await s.authoringReviewControl.confirm({ ...receipt, selection: { ...selection, candidateId: "foreign" } })).toBe("changed");
    const source = path.join(temp, "programs", selection.candidateId, "source", "review.nl");
    await writeFile(source, "concurrently changed source");
    expect(await s.authoringReviewControl.confirm(receipt)).toBe("changed");
    expect((await prepared.verify({ status: "reviewed", receipt, artifact: null })).passed).toBe(false);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
