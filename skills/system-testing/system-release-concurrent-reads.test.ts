import {describe,it,expect} from "vitest";
import {openSystemReleaseWorlds} from "./open-goal-system-release-worlds.js";
import {releaseFixture} from "./system-release-test-support.js";

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}

describe("independent retained System release reads",()=>{
 it("accepts the actual failed Promise.all completion/witness composition and joins duplicate reads",async()=>{
  const world=openSystemReleaseWorlds.find(w=>w.id==="system-release-desk-review-only")!,gates=new Map(world.required.map(name=>[name,deferred()]));
  const {f,seed,reads}=await releaseFixture(world,name=>gates.get(name)!.promise);
  const a=await f.services.systemReleaseEvidence.discover();await f.services.systemReleaseEvidence.compare(a.id);
  const first=f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,world.required[0]!);
  const duplicate=f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,world.required[0]!);
  const second=f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,world.required[1]!);
  await expect.poll(()=>[...reads]).toEqual(world.required);gates.get(world.required[1]!)!.resolve();const witness=await second;expect(witness.name).toBe(world.required[1]);
  gates.get(world.required[0]!)!.resolve();const [completion,again]=await Promise.all([first,duplicate]);expect(again).toEqual(completion);
  const proof=await f.verify("The actual two retained checks support this exact release.");expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 });
 it("refuses a handoff until every read settles and keeps foreign/case/header guards",async()=>{
  const world=openSystemReleaseWorlds.find(w=>w.id==="system-release-bulletin-current-verifies-exact-edition")!,gate=deferred();
  const {f,seed,headers,files}=await releaseFixture(world,name=>name===world.required[1]?gate.promise:Promise.resolve());
  const a=await f.services.systemReleaseEvidence.discover();await f.services.systemReleaseEvidence.compare(a.id);
  const complete=await f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,world.required[0]!);
  const pending=f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,world.required[1]!);
  await expect(f.services.systemReleaseHandoff.stage(a.id,seed.current,"stage-acceptance",[complete])).rejects.toThrow();expect(files.size).toBe(0);
  await expect(f.services.systemReleaseEvidence.inspectCase("foreign",seed.current,world.required[0]!)).rejects.toThrow();
  await expect(f.services.systemReleaseEvidence.inspectCase(a.id,"foreign",world.required[0]!)).rejects.toThrow();
  await expect(f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,"unassigned-case")).rejects.toThrow();
  gate.resolve();const witness=await pending;headers.get(seed.current).provenance.systemTestingBuild.buildKeys.production="changed-current-build";
  await expect(f.services.systemReleaseHandoff.stage(a.id,seed.current,"stage-acceptance",[complete,witness])).rejects.toThrow(/changed/);expect(files.size).toBe(0);
 });
 for(const world of openSystemReleaseWorlds)it("keeps native reference guards for "+world.id,async()=>{
  const {f}=await releaseFixture(world);const result=await f.qualify();expect(result.passed).toBe(true);
 });
});
