import {expect,it,vi} from "vitest";
vi.mock("@workspace/runtime",()=>({fs:{},vcs:{},rpc:{},contextId:null}));
vi.mock("./scratch-handoff-managed.js",()=>({readWorkspaceBytes:()=>{throw Error("Use assigned native bytes");}}));
import {prepareLaunchState} from "./open-goal-launch-state-managed.js";
it("allows actual assigned companion reads while all mutation and sealing authority stays with the active slot",async()=>{
 const contextId="owned-launch";
 const states=new Map<string,any>();const text=new Map<string,string>();let patches=0,archives=0;
 const binding={request:{operations:[{id:"native-operation"}]},services:{assignedAuthorityRead:{preflight:async()=>({decision:"allowed",operationId:"native-operation",leaves:[]})}}};
 const ports={contextId,fs:{mkdtemp:async()=>"/.tmp/launch-owned",writeFile:async(path:string,data:string)=>{text.set(path,data);},readdir:async()=>[]},status:async()=>({workingHead:{kind:"event",eventId:"native-head"},mainEventId:"native-head"}),readBytes:async(path:string)=>new TextEncoder().encode(text.get(path)!),bindAuthority:()=>binding,
  async open(owner:string,state:unknown){const id="panel-"+states.size;states.set(id,{panelId:id,entryKey:"entry-"+id,entityId:"entity-"+id,contextId:owner,buildKey:"native-build",state:structuredClone(state)});return {id,stateArgs:{get:async()=>structuredClone(states.get(id).state),patch:async()=>{patches++;throw Error("No mutation is expected");}},archive:async()=>{archives++;},navigate:vi.fn()};},state:async(id:string)=>structuredClone(states.get(id)??null)};
 const fixture=await prepareLaunchState({contextId,caseId:"launch-state-replace-order-without-copying-archive"},ports as never);
 try{
  const index=await fixture.services.launchStateRead.enumerate();
  const active=index.find(row=>row.purpose==="active")!,companion=index.find(row=>row.purpose==="archive")!;
  const before=await fixture.services.launchStateRead.read(companion.panelId);
  expect(before).toMatchObject({panelId:companion.panelId,state:{owner:"archive-operator"}});
  await fixture.services.launchStateRead.read(active.panelId);
  const current=await fixture.services.launchStateRead.read(active.panelId);
  const patch={settings:{pins:["captain","supplies"]}};
  await fixture.services.launchStateRead.bind(active.panelId,current!.digest,patch);
  await fixture.services.assignedAuthorityRead.preflight("native-operation");
  expect(await fixture.services.launchStateRead.read("foreign-panel")).toBeNull();
  expect(await fixture.services.launchStateRead.bind(companion.panelId,before!.digest,patch)).toBeNull();
  expect(await fixture.services.launchStateRead.seal(companion.panelId)).toBeNull();
  expect(await fixture.services.launchStateWrite.patch(companion.panelId,before!.digest,patch)).toBeNull();
  expect(await fixture.services.launchStateWrite.patch("foreign-panel",current!.digest,patch)).toBeNull();
  expect(patches).toBe(0);
  expect(await fixture.services.launchStateRead.read(companion.panelId)).toEqual(before);
  const proof=await fixture.verify(null);
  expect(proof.checks.protectedLaunchSiblings).toBe(true);
  expect(proof.checks.rejectedLaunchRetarget).toBe(true);
  expect(proof.companionReadbacks).toHaveLength(2);
  expect(proof.semanticReviewInput.expected.observations.companionReadbacks).toEqual(proof.companionReadbacks);
  expect(proof.semanticReviewInput.expected.observations.protectedCompanion).toEqual({initial:before,current:before});
  states.get(companion.panelId).contextId="foreign-context";
  await expect(fixture.services.launchStateRead.read(companion.panelId)).rejects.toThrow("escaped the assigned context");
 }finally{await fixture.close();}
 expect(archives).toBe(2);
});
