import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { assessSemanticOutcome } from "@workspace/application-outcomes/semantic-outcome-contract";
import { prepareOpenGoal } from "./open-goal-managed.js";
import { openGoalWorlds } from "./open-goal-worlds.js";

vi.mock("./open-goal-suite-managed.js", () => ({ prepareOpenGoalSuite: vi.fn() }));

const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("@workspace/runtime", () => ({
  credentials:{resolveCredential:async()=>null},
  fs: {
    readFile, readdir, writeFile:vi.fn(writeFile),
    async mkdtemp(prefix: string) {
      fixture.directory = await mkdtemp(join(tmpdir(), prefix));
      return fixture.directory;
    },
  },
  web: {
    search:vi.fn(async({queries}:{queries:string[]})=>({provider:"duckduckgo",elapsedMs:1,results:queries.map(query=>({query,text:"provider unavailable",sources:[],error:"Actual upstream search refused"}))})),
    async fetch({url}:{url:string}) {
      const text="They are not available for registration or transfer.";
      return {url,title:"Example domains",digest:createHash("sha256").update(text).digest("hex"),size:Buffer.byteLength(text),head:text,headBytes:Buffer.byteLength(text),session:"public",truncated:false};
    },
    async read({digest,offset=0,limit=8000}:{digest:string;offset?:number;limit?:number}) {
      const text="They are not available for registration or transfer.".slice(offset,offset+limit);
      return {digest,offset,text,bytes:Buffer.byteLength(text),nextOffset:offset+Buffer.byteLength(text)};
    },
  },
}));

afterEach(async () => {
  if (fixture.directory) await rm(fixture.directory, { recursive: true, force: true });
  fixture.directory = "";
});

it("composes the tutorial's real research and revision requirements without stale observations",async()=>{
  const world=openGoalWorlds.find(({id})=>id==="verify-and-correct-tutorial");
  if(world?.kind!=="research-and-edit")throw Error("Expected the combined tutorial task");
  const prepared=await prepareOpenGoal({contextId:"owned-context",caseId:world.id});
  if(!("goalWorkspace"in prepared.services))throw Error("Expected combined workspace bindings");
  const services=prepared.services;
  const page=await services.web.fetch({url:"https://www.iana.org/help/example-domains"});
  const research={status:"answered",question:world.goal,statements:[{text:world.referenceAnswer,cites:[{
    url:page.url,quote:"not available for registration or transfer",retrieved:new Date(services.goalDiscovery.snapshotTime()).toISOString().slice(0,10),
  }]}]};
  await services.goalWorkspace.read(world.source);
  const original=await services.goalWorkspace.read(world.destination);
  const blocked=await prepared.verify({research,revision:{status:"blocked",reason:"No edit selected"}});
  expect(()=>assessSemanticOutcome(blocked)).not.toThrow();
  expect(blocked.passed).toBe(false);
  expect(blocked.checks.exactDocumentReadback).toBe(false);
  expect((await services.goalWorkspace.revise(world.destination,original!.version,world.expected)).status).toBe("changed");
  const fresh=await services.goalWorkspace.read(world.destination);
  await services.goalWorkspace.revise(world.destination,fresh!.version,world.expected);
  await services.goalWorkspace.read(world.destination);
  const complete=await prepared.verify({research,revision:null});
  expect(assessSemanticOutcome(complete).passed).toBe(true);
  expect(complete.semanticReviewRequired).toBe(true);
  expect(complete.semanticReviewInput.actual.documentEdits[0]?.retainedText).toBe(world.expected);
  expect(complete.observedChecks.reportedStoredRevision).toBe(false);
  expect(complete.outcomeDimensions.incidentalValues?.checks.reportedStoredRevision).toBe(false);
  const unsupported=await prepared.verify({research:{...research,statements:[]},revision:null});
  expect(assessSemanticOutcome(unsupported).passed).toBe(false);
});

it("requires fresh observations and independently reads back a recovered revision", async () => {
  const world = openGoalWorlds.find(({ id }) => id === "reconcile-workshop-update");
  if (world?.kind !== "workspace-edit") throw new Error("Expected the workshop fixture");
  const files: Readonly<Record<string, string>> = world.files;
  const prepared = await prepareOpenGoal({ contextId: "owned-context", caseId: world.id });
  if (!("goalWorkspace" in prepared.services)) throw new Error("Expected the document workspace binding");
  const workspace = prepared.services.goalWorkspace;
  expect(await workspace.list()).toEqual(Object.keys(files).sort());
  const earlier = await workspace.read(world.destination);
  expect(earlier?.text).toBe(files[world.destination]);
  expect(await workspace.read(world.source)).toBeTruthy();
  expect(await workspace.revise(world.destination, earlier!.version, world.expected)).toEqual({ status: "changed" });
  expect((await prepared.verify({ status: "edited" })).passed).toBe(false);
  const latest = await workspace.read(world.destination);
  expect(latest?.text).toContain(world.concurrentAddition);
  const write = await workspace.revise(world.destination, latest!.version, world.expected);
  expect(write.status).toBe("written");
  if (!("version" in write)) throw new Error("Missing stored document version");
  await workspace.read(world.destination);
  const report = { status: "edited", path: world.destination, version: write.version };
  expect((await prepared.verify(report)).passed).toBe(true);
  await writeFile(join(fixture.directory, world.source), "changed source");
  expect((await prepared.verify(report)).passed).toBe(false);
});

it("accepts a correct recovered edit after extra stale retries without requiring a list route", async () => {
  const world = openGoalWorlds.find(({ id }) => id === "reconcile-workshop-update");
  if (world?.kind !== "workspace-edit") throw new Error("Expected the workshop fixture");
  const prepared = await prepareOpenGoal({ contextId: "owned-context", caseId: world.id });
  if (!("goalWorkspace" in prepared.services)) throw new Error("Expected document bindings");
  const workspace = prepared.services.goalWorkspace;
  await workspace.read(world.source);
  const original = await workspace.read(world.destination);
  expect((await workspace.revise(world.destination, original!.version, world.expected)).status).toBe("changed");
  expect((await workspace.revise(world.destination, original!.version, world.expected)).status).toBe("changed");
  const fresh = await workspace.read(world.destination);
  const result = await workspace.revise(world.destination, fresh!.version, world.expected);
  if (!("version" in result)) throw new Error("Expected stored revision");
  await workspace.read(world.destination);
  expect((await prepared.verify({ status: "edited", path: world.destination, version: result.version })).passed).toBe(true);
});


it("preserves failed public acquisition receipts before attempting a combined document edit",async()=>{
  const {serializeRpcFailure}=await import("@vibestudio/rpc");
  const world=openGoalWorlds.find(({id})=>id==="verify-and-correct-tutorial");
  if(world?.kind!=="research-and-edit")throw Error("Expected combined research and edit");
  const prepared=await prepareOpenGoal({contextId:"owned",caseId:world.id});
  const {fs}=await import("@workspace/runtime");
  const initializedWrites=vi.mocked(fs.writeFile).mock.calls.length;
  const error=await prepared.qualify().then(()=>{throw Error("Expected acquisition failure");},error=>error);
  expect(serializeRpcFailure(error)).toMatchObject({message:expect.stringContaining("Actual upstream search refused"),
    errorData:{publicReferenceAcquisition:{phase:"search-provider",caseId:world.id}}});
  expect(vi.mocked(fs.writeFile)).toHaveBeenCalledTimes(initializedWrites);
  expect(await readFile(join(fixture.directory,world.destination),"utf8")).toBe(world.files[world.destination]);
});
