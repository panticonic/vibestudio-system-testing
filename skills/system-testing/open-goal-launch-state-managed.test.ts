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


function liveNativePorts(){
 const contextId="owned-observed-launch",states=new Map<string,any>(),files=new Map<string,string>(),directories=new Set<string>();
 const submitted:unknown[]=[];let serial=0;
 const ports={contextId,status:async()=>({workingHead:{kind:"event",eventId:"native-head"},mainEventId:"native-head"}),
  fs:{mkdtemp:async(prefix:string)=>{const name=prefix+"-"+(++serial);directories.add(name);return "/.tmp/"+name;},
   readdir:async()=>[...directories],writeFile:async(path:string,value:string)=>{files.set(path,value);},
   rename:async(from:string,to:string)=>{files.set(to,files.get(from)!);files.delete(from);},rm:async()=>{}},
  readBytes:async(path:string)=>new TextEncoder().encode(files.get(path)!),
  bindAuthority:(request:any)=>({request,services:{assignedAuthorityRead:{preflight:async(operationId:string)=>({operationId,decision:"allowed",leaves:[]})}}}),
  async open(owner:string,state:unknown){const id="observed-panel-"+states.size;states.set(id,{panelId:id,entryKey:"entry-"+id,entityId:"entity-"+id,contextId:owner,buildKey:"native-build",state:structuredClone(state)});
   return {id,stateArgs:{get:async()=>structuredClone(states.get(id).state),patch:async(patch:any)=>{submitted.push(structuredClone(patch));const row=states.get(id);row.state={...row.state,...patch,...(patch.settings?{settings:{...row.state.settings,...patch.settings}}:{})};return structuredClone(row.state);}},archive:async()=>{},navigate:vi.fn()};},
  state:async(id:string)=>structuredClone(states.get(id)??null)};
 return {ports,states,submitted};
}
it("fresh reads report later native state instead of replaying the second observation",async()=>{
 const {ports,states}=liveNativePorts();const fixture=await prepareLaunchState({contextId:ports.contextId,caseId:"launch-state-count-current-value-readonly"},ports as never);
 try{const active=(await fixture.services.launchStateRead.enumerate()).find(row=>row.purpose==="active")!;
  await fixture.services.launchStateRead.read(active.panelId);states.get(active.panelId).state.count=41;
  expect((await fixture.services.launchStateRead.read(active.panelId))?.state.count).toBe(41);states.get(active.panelId).state.count=57;
  expect((await fixture.services.launchStateRead.read(active.panelId))?.state.count).toBe(57);
 }finally{await fixture.close();}
});
it("binds the actual candidate operation, while the independent goal check still rejects a wrong committed change",async()=>{
 const {ports,submitted}=liveNativePorts();const fixture=await prepareLaunchState({contextId:ports.contextId,caseId:"launch-state-sort-queue-only"},ports as never);
 try{const active=(await fixture.services.launchStateRead.enumerate()).find(row=>row.purpose==="active")!;
  await fixture.services.launchStateRead.read(active.panelId);const current=(await fixture.services.launchStateRead.read(active.panelId))!;
  const candidate={label:"a different candidate change"};const request=await fixture.services.launchStateRead.bind(active.panelId,current.digest,candidate);
  expect(request?.operations[0].args).toEqual([active.panelId,candidate]);await fixture.services.assignedAuthorityRead.preflight(request!.operations[0].id);
  expect((await fixture.services.launchStateWrite.patch(active.panelId,current.digest,candidate))?.kind).toBe("saved");expect(submitted).toEqual([candidate]);
  const readback=await fixture.services.launchStateRead.seal(active.panelId);const proof=await fixture.verify({readback,result:{status:"applied",summary:"Candidate saved"},handoff:null});
  expect(proof.checks.exactNativePatchResult).toBe(false);expect(proof.checks.independentLaunchReadback).toBe(false);expect(proof.passed).toBe(false);
  expect(proof.operations).toHaveLength(1);expect(proof.operations[0].result.kind).toBe("saved");
 }finally{await fixture.close();}
});
it("private verification does not invent a required retained note, while native goal meaning review stays mandatory",async()=>{
 const {ports}=liveNativePorts();const fixture=await prepareLaunchState({contextId:ports.contextId,caseId:"launch-state-preserve-late-badge-while-replacing-pins"},ports as never);
 try{const active=(await fixture.services.launchStateRead.enumerate()).find(row=>row.purpose==="active")!;
  await fixture.services.launchStateRead.read(active.panelId);const current=(await fixture.services.launchStateRead.read(active.panelId))!;
  const patch={settings:{pins:["north","east"]}},request=(await fixture.services.launchStateRead.bind(active.panelId,current.digest,patch))!;
  await fixture.services.assignedAuthorityRead.preflight(request.operations[0].id);await fixture.services.launchStateWrite.patch(active.panelId,current.digest,patch);
  const readback=await fixture.services.launchStateRead.seal(active.panelId);const proof=await fixture.verify({readback,result:{status:"applied",summary:"Pins and operator label independently verified"},handoff:null});
  expect(proof.checks.exactPrivateLaunchNote).toBe(true);expect(proof.checks.exactNativePatchResult).toBe(true);expect(proof.checks.independentLaunchReadback).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 }finally{await fixture.close();}
});
it("an owned private writer persists the actual candidate report without requiring the reference outcome",async()=>{
 const {ports}=liveNativePorts();const fixture=await prepareLaunchState({contextId:ports.contextId,caseId:"launch-state-remove-obsolete-lane-label"},ports as never);
 try{const active=(await fixture.services.launchStateRead.enumerate()).find(row=>row.purpose==="active")!;
  const opening=(await fixture.services.launchStateRead.read(active.panelId))!,current=(await fixture.services.launchStateRead.read(active.panelId))!,readback=(await fixture.services.launchStateRead.seal(active.panelId))!;
  const report={plan:{panelId:active.panelId,direction:"read",patch:{},retain:true},opening,current,decision:{attempt:false,reason:"A candidate hold"},preflight:null,effect:null,readback,result:{status:"held",summary:"A candidate report, not a reference verdict"},handoff:null};
  const handoff=await fixture.services.launchStateWrite.stage(report as never);expect(handoff).not.toBeNull();
  const proof=await fixture.verify({readback,result:report.result,handoff});expect(proof.checks.exactPrivateLaunchNote).toBe(true);expect(proof.passed).toBe(false);expect(proof.semanticReviewRequired).toBe(true);
 }finally{await fixture.close();}
});
