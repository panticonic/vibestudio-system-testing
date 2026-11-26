import {expect,it,vi} from "vitest";
vi.mock("@workspace/runtime",()=>({contextId:null,fs:{},panelTree:{},rpc:{},vcs:{}}));
vi.mock("./session-replay-managed.js",()=>({createOwnedHeadlessChannel:()=>{throw Error("No live channel in component test");}}));
vi.mock("./scratch-handoff-managed.js",()=>({readWorkspaceBytes:()=>{throw Error("No live read in component test");}}));
vi.mock("./regency-fixture-player.js",()=>({bindRegencyFixturePlayer:()=>{throw Error("No live player in component test");}}));
vi.mock("@workspace-skills/scratch-handoff-bindings",()=>({bindScratchHandoff:(fs:any)=>({scratchHandoffWrite:{stage:async(text:string)=>{const path="/.tmp/evidence-handoff-test/handoff.json";await fs.writeFile(path,text);return{path};}}})}));
import {prepareOpenRegency} from "./open-goal-regency-managed.js";
async function fixture(caseId:string,readCount=2){
 let month=0,pending:any=null;const files=new Map<string,string>();
 const view=()=>({game:{world:{month},programs:{}},pending,painting:false});
 const store={read:async()=>view(),preview:async(months:number)=>({basis:{month},forecast:{month:month+months}})};
 const accounts=(id:string,world:any)=>({id,month:world.month,treasury:100,debt:0,income:1,spending:1,serviceCost:0,worksCost:0,routes:[{id:"east-crossing",subsidy:0,condition:.12,progress:0,workers:0,cargo:0,capacity:2}],regions:[],borderTension:0});
 const installed={owner:()=>store,readback:accounts,review:(request:any)=>({decision:"contradicted",finding:"works-progress",evidenceIds:request.kind==="compare"?[request.before.id,request.after.id]:[request.current.id]})};
 const fs={mkdtemp:async()=>"/.tmp/regency-review-test",writeFile:async(path:string,text:string)=>{files.set(path,text);},readdir:async()=>files.has("/.tmp/evidence-handoff-test/handoff.json")?["regency-review-test","evidence-handoff-test"]:["regency-review-test"]};
 const ports={contextId:"ctx",fs,status:async()=>({mainEventId:"main",workingHead:{id:"working"}}),open:async()=>"owned-channel",player:{seat:async()=>{},advance:async(id:string,months:number)=>{month+=months;pending={id};},cancel:async()=>{pending=null;}},readBytes:async(path:string)=>new TextEncoder().encode(files.get(path)??"")};
 const prepared=await prepareOpenRegency({contextId:"ctx",caseId,regencyFixture:{realm:"realm"} as never},installed as never,ports as never);
 const index=await prepared.services.regencyAssignment.list();const opening=await prepared.services.regencySaved.read(index.realm),current=readCount===1?opening:await prepared.services.regencySaved.read(index.realm);
 return{prepared,index,opening:opening!,current:current!};
}
it("verifies an alternative claim decomposition against actual native accounts instead of the reference plan",async()=>{
 const {prepared,index,opening,current}=await fixture("regency-briefing-works-progress-versus-route-flow");
 const forecast=(await prepared.services.regencyForecast.preview(index.realm,current.revision,2))!;
 const claim={kind:"compare" as const,from:"opening" as const,to:2 as const,check:{kind:"route-works-progressed" as const,route:"east-crossing"},assertCommitted:false};
 const finding={claim,review:{decision:"contradicted",finding:"Actual repair progress remains zero; the crossing remains at 0.12 and is not fully reopened.",evidenceIds:[opening.accounts.id,forecast.accounts.id]}};
 const report={forecasts:[forecast],findings:[finding],decision:{action:"hold",explanation:"No repair progress and no full reopening."},advance:null,note:null};
 expect(await prepared.services.regencyNote.stage({...report,plan:{horizons:[2],claims:[claim],localNote:true,advance:null,treasuryFloor:null},opening,current} as never)).toBeNull();
 const proof=await prepared.verify(report);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.semanticReviewInput?.actual.requestedReturn).toEqual(report);
 expect((await prepared.verify({...report,forecasts:[{...forecast,accounts:{...forecast.accounts,treasury:999}}]})).passed).toBe(false);
 expect((await prepared.verify({...report,findings:[{...finding,review:{...finding.review,decision:"supported"}}]})).passed).toBe(false);
 expect((await prepared.verify({...report,findings:[{...finding,review:{...finding.review,evidenceIds:["foreign"]}}]})).passed).toBe(false);
});
it("retains a native-grounded requested note without requiring the private reference plan or token wording",async()=>{
 const {prepared,opening,current}=await fixture("regency-briefing-ledger-still-solvent-though-loss");
 const claim={kind:"settlement" as const,source:"current" as const,check:{kind:"net-positive" as const}};
 const findings=[{claim,review:{decision:"contradicted",finding:"The actual saved month does not show a positive operating result.",evidenceIds:[current.accounts.id]}}];
 const report={plan:{horizons:[],claims:[claim],localNote:true,advance:null,treasuryFloor:null},opening,current,forecasts:[],findings,decision:{action:"report",explanation:"The saved result and booked debt are distinct; this is the actual private note."},advance:null,note:null};
 expect(await prepared.services.regencyNote.stage({...report,findings:[{...findings[0],review:{...findings[0]!.review,decision:"supported"}}]} as never)).toBeNull();
 expect(await prepared.services.regencyNote.stage({...report,findings:[{...findings[0],review:{...findings[0]!.review,evidenceIds:["foreign"]}}]} as never)).toBeNull();
 const note=await prepared.services.regencyNote.stage(report as never);expect(note).not.toBeNull();
 const proof=await prepared.verify({...report,note});expect(proof.passed).toBe(true);expect(proof.artifact).toContain(findings[0].review.finding);expect(proof.semanticReviewRequired).toBe(true);
 const withoutRoot=await prepared.verify(undefined);expect(withoutRoot.passed).toBe(true);expect(withoutRoot.semanticReviewInput?.actual.requestedReturn).toBeNull();
});
it("keeps the separately requested mixed conditional-execution finding required",async()=>{
 const {prepared}=await fixture("regency-briefing-capital-threshold-protects-two-month-advance");
 const proof=await prepared.verify(undefined);
 expect(proof.outcomeContract.returnedValue.required).toBe(true);
 expect(proof.passed).toBe(false);expect(proof.semanticReviewRequired).toBe(true);
});

it("returns fresh saved observations after an authorized advance and authenticates historical forecast subsets",async()=>{
 const {prepared,index,opening,current}=await fixture("regency-briefing-month-advance-and-observed-handoff");
 const extra=await prepared.services.regencySaved.read(index.realm);expect(extra).toEqual(current);
 const first=await prepared.services.regencyForecast.preview(index.realm,current.revision,3);
 expect(first).not.toBeNull();
 expect(await prepared.services.regencyForecast.preview(index.realm,current.revision,3)).toEqual(first);
 const advance=await prepared.services.regencyAdvance.commit(index.realm,current.revision,3);expect(advance).not.toBeNull();
 const fresh=await prepared.services.regencySaved.read(index.realm);expect(fresh).toEqual(advance!.committed);expect(fresh!.accounts.month).toBe(current.accounts.month+3);
 expect(await prepared.services.regencyForecast.preview(index.realm,current.revision,1)).toBeNull();
 const next=await prepared.services.regencyForecast.preview(index.realm,fresh!.revision,1);expect(next!.basis).toBe(fresh!.revision);
 expect(await prepared.services.regencyForecast.preview("foreign",fresh!.revision,1)).toBeNull();
 expect(await prepared.services.regencyForecast.preview(index.realm,fresh!.revision,4 as never)).toBeNull();
 expect(await prepared.services.regencyAdvance.commit(index.realm,fresh!.revision,3)).toBeNull();
 const report={plan:{horizons:[3],claims:[],localNote:true,advance:3,treasuryFloor:75},opening,current,forecasts:[first],findings:[],decision:{action:"advance",explanation:"The authorized three months actually committed; retain the resulting ledger."},advance,note:null};
 expect(await prepared.services.regencyNote.stage({...report,forecasts:[{...first!,basis:"foreign"}]} as never)).toBeNull();
 const note=await prepared.services.regencyNote.stage(report as never);expect(note).not.toBeNull();
 const proof=await prepared.verify({...report,note});expect(proof.checks.exactSavedRegencyFrontiers).toBe(true);expect(proof.passed).toBe(true);
 const forged=await prepared.verify({...report,note,forecasts:[{...first!,accounts:{...first!.accounts,treasury:999}}]});expect(forged.observedChecks.returnedRegencyForecasts).toBe(false);expect(forged.passed).toBe(true); // Optional root echoes cannot invalidate the independently retained real note.
});
it("allows independent readonly forecasts to overlap without treating the second as a mutation",async()=>{
 const {prepared,index,current}=await fixture("regency-briefing-works-progress-versus-route-flow");
 const results=await Promise.all([1,2,3].map(months=>prepared.services.regencyForecast.preview(index.realm,current.revision,months as 1|2|3)));
 expect(results.map(row=>row?.months)).toEqual([1,2,3]);
 expect(await prepared.services.regencyForecast.preview(index.realm,current.revision,1)).toEqual(results[0]);
});

it("accepts one authentic current observation when no historical change requires another read",async()=>{
 const {prepared}=await fixture("regency-briefing-works-progress-versus-route-flow",1);
 const proof=await prepared.verify({forecasts:[],findings:[],decision:{action:"report",explanation:"This is the current saved receipt."},advance:null,note:null});
 expect(proof.observedChecks.exactSavedRegencyFrontiers).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
});

it("uses the real scratch artifact byte bound rather than a private shorter finding ceiling",async()=>{
 const {prepared,opening,current}=await fixture("regency-briefing-ledger-still-solvent-though-loss");
 const claim={kind:"settlement" as const,source:"current" as const,check:{kind:"net-positive" as const}};
 const report={plan:{horizons:[],claims:[claim],localNote:true,advance:null,treasuryFloor:null},opening,current,forecasts:[],findings:[{claim,review:{decision:"contradicted",finding:"The observed saved accounts are the source for this private diagnostic. ".repeat(250),evidenceIds:[current.accounts.id]}}],decision:{action:"stage",explanation:"Retain the requested actual private account analysis."},advance:null,note:null};
 expect(await prepared.services.regencyNote.stage({...report,decision:{...report.decision,explanation:"x".repeat(65536)}} as never)).toBeNull();
 const note=await prepared.services.regencyNote.stage(report as never);expect(note).not.toBeNull();
 const proof=await prepared.verify({...report,note});expect(proof.passed).toBe(true);expect(new TextEncoder().encode(proof.artifact!).byteLength).toBeGreaterThan(12*1024);expect(proof.semanticReviewRequired).toBe(true);
});
