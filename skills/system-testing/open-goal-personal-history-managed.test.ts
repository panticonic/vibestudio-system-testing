import {beforeEach,it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
const native=vi.hoisted(()=>({path:"",head:"main",events:new Map<string,{files:Map<string,string>,message:string}>(),blobs:new Map<string,string>()}));
vi.mock("@workspace/runtime",()=>({contextId:"owned-history",blobstore:{putText:async(text:string)=>{const digest=createHash("sha256").update(text).digest("hex");native.blobs.set(digest,text);return {digest};}},memory:{recall:async({query}:any)=>({results:[...native.events].filter(([,row])=>row.message.includes(query)).map(([eventId,row])=>({kind:"commit",eventId,snippet:row.message}))})},vcs:{
 status:async()=>({mainEventId:"main",workingHead:{kind:"event",eventId:native.head}}),
 importSnapshot:async(input:any)=>{native.path=input.repositories[0].repoPath;const eventId="event-"+(native.events.size+1);native.events.set(eventId,{files:new Map(input.repositories[0].files.map((file:any)=>[file.path,native.blobs.get(file.contentHash)])),message:input.message});native.head=eventId;return {eventId,importedRepositoryIds:["repository"]};},
 readFile:async(input:any)=>{const text=native.events.get(input.state.eventId)?.files.get(input.file.path);return text===undefined?null:{repositoryId:"repository",repoPath:native.path,path:input.file.path,contentHash:createHash("sha256").update(text).digest("hex"),content:{kind:"text",text}};},
 listFiles:async(input:any)=>({repositoryId:"repository",state:input.state,nextCursor:null,files:[...native.events.get(input.state.eventId)!.files.keys()].map(path=>({path}))}),
}}));
import {prepareOpenPersonalHistory} from "@workspace-skills/open-personal-history-runtime";
import {openPersonalHistoryWorlds} from "./open-goal-personal-history-worlds.js";
beforeEach(()=>{native.path="";native.head="main";native.events.clear();native.blobs.clear();});
it.each(openPersonalHistoryWorlds)("$id keeps immutable native history and independently reviewed requested findings",async world=>{
 const fixture=await prepareOpenPersonalHistory({contextId:"owned-history",caseId:world.id},world);
 try{const proof=await fixture.qualify();expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.outcomeDimensions.returnedValue.required).toBe(true);expect(proof.semanticReviewInput.actual.observations.reads).toEqual(proof.reads);}finally{await fixture.close();}
});
it("accepts an alternative actual supporting line without private file-read or exact semantic-label gates",async()=>{
 const world={id:"alternative",goal:"Tell us the recorded receiving bay at Loading approval",revisions:[{label:"Loading approval",note:"Signed",files:[{path:"plan.md",text:"Receiving bay: Cedar\nReceiving area is Cedar\n"},{path:"draft.md",text:"Draft says Blue\n"}]}],expected:{findings:[{label:"Loading approval",status:"verified" as const,reads:["plan.md","draft.md"],citations:[{path:"plan.md",line:1,quote:"Receiving bay: Cedar"}]}],relation:"single" as const,action:"clear" as const}};
 const fixture=await prepareOpenPersonalHistory({contextId:"owned-history",caseId:world.id},world);
 try{
  const scope=await fixture.services.archiveTimeline.discover();const source=(await fixture.services.archiveTimeline.read(scope.milestones[0]!.eventId,"plan.md"))!;
  const citation={eventId:source.eventId,path:source.path,contentHash:source.contentHash,line:2,quote:"Receiving area is Cedar"};
  const report={findings:[{label:"Loading approval",status:"conflicting",citations:[citation]}],relation:"unresolved",action:"hold"};
  const proof=await fixture.verify(report);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(report);
  const forged=await fixture.verify({...report,findings:[{...report.findings[0],citations:[{...citation,contentHash:"invented"}]}]});expect(forged.passed).toBe(false);
  native.head="foreign";expect((await fixture.verify(report)).passed).toBe(false);
 }finally{await fixture.close();}
});
