import { readFile, readdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import { beforeEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  contextId: "owned-unit-handoff",
  vcs: { status: vi.fn(), resolveRepository: vi.fn(), readFile: vi.fn(), edit: vi.fn() },
  fs: { readdir: vi.fn(), exists: vi.fn(), readFile: vi.fn() },
  extensions: { status: vi.fn() },
  rpc: { call: vi.fn() },
}));
vi.mock("@workspace/runtime", () => runtime);

import { prepareUnitHandoff } from "./open-goal-unit-handoff-managed.js";
import { openUnitHandoffWorlds, type OpenUnitHandoffWorld } from "./open-goal-unit-handoff-worlds.js";

const {requireDevelopmentTemplateCheckout}=createRequire(resolve(process.cwd(),"package.json"))("./src/dev/developmentTemplateConfig.cjs");
const base=pathToFileURL(`${requireDevelopmentTemplateCheckout(process.cwd(),"base")}/`);
const utf8 = (path: string) => readFile(new URL(path, base), "utf8");
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const protectedHead = { kind: "event", eventId: "protected-main" };
type Head = { kind: string; eventId?: string; applicationId?: string };
type Edit = { kind: string; repositoryId: string; path?: string; fileId?: string;
  content?: { kind: "text"; text: string }; edits?: { start: number; end: number; text: string }[] };
const revision = (head: Head) => head.eventId ?? head.applicationId!;

beforeEach(() => vi.resetAllMocks());

async function setup(world: OpenUnitHandoffWorld) {
  const files = new Map<string, string>();
  for (const unit of world.inventory) {
    const path = unit.path + "/package.json";
    const text = await utf8(path);
    files.set(path, text);
    const { icon, entry } = JSON.parse(text).vibestudio;
    if (typeof icon === "string" && icon.startsWith("./"))
      files.set(unit.path + "/" + icon.slice(2), await utf8(unit.path + "/" + icon.slice(2)));
    if (world.change === "code-only" && unit.path === world.target?.path)
      files.set(unit.path + "/" + (entry ?? "index.ts"), await utf8(unit.path + "/" + (entry ?? "index.ts")));
  }
  const versions = new Map([[revision(protectedHead), files]]);
  const state = (head: Head) => {
    const storage = versions.get(revision(head));
    if (!storage) throw new Error("Unexpected VCS revision");
    return storage;
  };
  let head: Head = protectedHead;
  runtime.vcs.status.mockImplementation(async ({ contextId }) => {
    expect(contextId).toBe(runtime.contextId);
    return { mainEventId: protectedHead.eventId, workingHead: head, clean: head === protectedHead };
  });
  runtime.vcs.resolveRepository.mockImplementation(async ({ state: at, repoPath }) =>
    state(at).has(repoPath + "/package.json") ? { repositoryId: repoPath } : null);
  runtime.vcs.readFile.mockImplementation(async ({ state: at, repositoryId, file }) => {
    expect(file.kind).toBe("path");
    const key = repositoryId + "/" + file.path;
    const text = state(at).get(key);
    return text === undefined ? null : { repositoryId, path: file.path, fileId: key,
      contentHash: digest(text), content: { kind: "text", text } };
  });
  runtime.vcs.edit.mockImplementation(async ({ contextId, expectedWorkingHead, changes }) => {
    expect(contextId).toBe(runtime.contextId);
    expect(expectedWorkingHead).toEqual(head);
    const next = new Map(state(head));
    for (const change of changes as Edit[]) {
      expect(change.repositoryId).toBe(world.target?.path);
      const key = change.fileId ?? change.repositoryId + "/" + change.path;
      if (change.kind === "text-edit") {
        const [edit] = change.edits ?? [];
        if (!edit) throw new Error("Expected an exact icon manifest edit");
        const previous = next.get(key);
        expect(edit.start).toBe(0);
        expect(edit.end).toBe(previous?.length);
        next.set(key, edit.text);
      } else {
        expect(["content-replace", "file-create"]).toContain(change.kind);
        expect(change.content?.kind).toBe("text");
        next.set(key, change.content!.text);
      }
    }
    head = { kind: "application", applicationId: "draft-" + versions.size };
    versions.set(revision(head), next);
    return { contextId, workingHead: head };
  });
  runtime.fs.readdir.mockImplementation(path => readdir(new URL(path, base)));
  runtime.fs.readFile.mockImplementation(utf8);
  runtime.fs.exists.mockImplementation(async path => {
    try { await access(new URL(path, base)); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  });
  const name = "@workspace-extensions/" + world.target?.name;
  const source = world.target?.path;
  const hasBuild = world.target?.name !== "speech";
  runtime.extensions.status.mockImplementation(async (requested) => {
    expect(requested).toBe(name);
    return { name, source, status: hasBuild ? "available" : "pending-approval", activeEv: hasBuild ? "ev1" : null,
      activeBundleKey: hasBuild ? "retained-build" : null, pendingApproval: hasBuild ? null : { kind: "extension.install" } };
  });
  runtime.rpc.call.mockImplementation(async (caller, _method, args) => {
    expect(caller).toBe("main");
    expect(args).toEqual(["retained-build"]);
    return { kind: "extension", buildKey: "retained-build", name, sourcePath: source, sourceState: protectedHead, ev: "ev1" };
  });
}

it.each(openUnitHandoffWorlds)("$id uses exact native design and icon checks", async world => {
  await setup(world);
  const candidate = await prepareUnitHandoff(world);
  const result = await candidate.qualify();
  expect(result.checks).toEqual(Object.fromEntries(Object.keys(result.checks).map(check => [check, true])));
  const altered = structuredClone(result.unitHandoff.report);
  if (!altered) throw new Error("Expected an actual verified report");
  altered.unit = {path:"extensions/other",name:"other",kind:"extension",description:"Unobserved unit"};
  expect((await candidate.verify(altered)).outcomeDimensions.incidentalValues!.checks.authenticUnitValue).toBe(false);
});

it("rejects an edit with retained inspection authority even when the real catalog resolves", async () => {
  const world = openUnitHandoffWorlds.find(world => world.id === "unit-handoff-model-settings-queuing-readonly")!;
  await setup(world);
  const fixture = await prepareUnitHandoff(world);
  await fixture.services.unitHandoff.discover();
  const scope = await fixture.services.unitHandoff.begin(world.target!.path);
  const id = scope.identityRequest.operationId;
  const observed = await fixture.services.unitIdentity.observe(id);
  const icon = await fixture.services.unitIdentity.resolve(id, world.icon!);
  expect(icon?.choice.id).toBe("lucide:settings-2");
  await expect(fixture.services.unitIdentity.stage(id, observed.revision, icon!.choice.id)).rejects.toThrow(/assigned revision/);
  expect(runtime.vcs.edit).not.toHaveBeenCalled();
});

it("binds actual requested findings without a private report tree or repeated lifecycle limit",async()=>{
 const world=openUnitHandoffWorlds.find(row=>row.id==="unit-handoff-shell-build-after-comment")!;
 await setup(world);const fixture=await prepareUnitHandoff(world),original=await fixture.qualify(),report=structuredClone(original.unitHandoff.report)!;
 const proof=await fixture.verify(report);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(report);expect(proof.nativeReviewEvidence).not.toHaveProperty("expect");expect(proof.nativeReviewEvidence).not.toHaveProperty("target");
 const scope=await fixture.services.unitHandoff.begin(world.target!.path);await fixture.services.unitHandoff.lifecycle(scope.unit.path);await fixture.services.unitHandoff.lifecycle(scope.unit.path);expect((await fixture.verify(report)).passed).toBe(true);
});
it("does not require a redundant installed report after authentic manifest anchor reads",async()=>{
 const world=openUnitHandoffWorlds.find(row=>row.id==="unit-handoff-file-tools-dependency-regression")!;
 await setup(world);const fixture=await prepareUnitHandoff(world);await fixture.services.unitHandoff.discover();const observation=await fixture.services.unitHandoff.begin(world.target!.path);expect(observation.manifest!.working.validationError).not.toBeNull();
 const proof=await fixture.verify({explanation:"The working manifest has a native validation error; protected main is a separate reading. Both copies were left alone.",unit:observation.unit,draft:null});expect(proof.passed,JSON.stringify(proof.checks)).toBe(true);expect(proof.nativeReviewEvidence.nativeDesign).toBeNull();expect(proof.semanticReviewRequired).toBe(true);
});
it("accepts fresh actual observations after a native draft while retaining original CAS authority",async()=>{
 const world=openUnitHandoffWorlds.find(row=>row.id==="unit-handoff-terminal-visible-separate-shell")!;
 await setup(world);const fixture=await prepareUnitHandoff(world),reference=await fixture.qualify();expect(reference.passed).toBe(true);const before=reference.nativeReviewEvidence.scope!;
 const current=await fixture.services.unitHandoff.begin(before.unit.path),identity=await fixture.services.unitIdentity.observe(current.identityRequest.operationId);expect(current.revision).not.toBe(before.revision);expect(identity.revision).toBe(current.revision);
 const proof=await fixture.verify(reference.unitHandoff.report);expect(proof.passed,JSON.stringify(proof.checks)).toBe(true);expect(proof.outcomeContract.returnedValue.required).toBe(false);expect(proof.nativeReviewEvidence.observations.length).toBeGreaterThan(1);
});
it("rejects a related icon draft when the literal user requested a different exact symbol",async()=>{
 const world=openUnitHandoffWorlds.find(row=>row.id==="unit-handoff-terminal-visible-separate-shell")!;
 await setup(world);const fixture=await prepareUnitHandoff(world);await fixture.services.unitHandoff.discover();const scope=await fixture.services.unitHandoff.begin(world.target!.path),id=scope.identityRequest.operationId,observed=await fixture.services.unitIdentity.observe(id);const wrong=await fixture.services.unitIdentity.resolve(id,{family:"lucide",term:"terminal"});expect(wrong).not.toBeNull();const change=await fixture.services.unitIdentity.stage(id,observed.revision,wrong!.choice.id);
 const proof=await fixture.verify({explanation:"A different draft was prepared.",unit:scope.unit,draft:change});expect(proof.checks.localEffectAndProtectedState).toBe(false);
});
it("reference qualification fails when its chosen native artifact was not created",async()=>{
 const world=openUnitHandoffWorlds.find(row=>row.id==="unit-handoff-terminal-visible-separate-shell")!;
 await setup(world);const fixture=await prepareUnitHandoff(world);fixture.services.unitIdentity.stage=async()=>null as never;const proof=await fixture.qualify();expect(proof.passed).toBe(false);expect(proof.checks.referenceRequestedArtifact).toBe(false);
});
