import {expect,it,vi} from "vitest";
vi.mock("@workspace/runtime",()=>({blobstore:{},contextId:"owned",fs:{},rpc:{},vcs:{}}));
import {prepareSourceAttribution} from "./open-goal-source-attribution-managed.js";
import type {SourceAttributionWorld} from "./open-goal-source-attribution-worlds.js";

function ports(){
 let state={kind:"event",eventId:"initial"};const blobs=new Map<string,string>(),files=new Map<string,string>(),notes=new Map<string,string>();
 const bytes=(text:string)=>new TextEncoder().encode(text);
 const vcs={status:async()=>({clean:true,workingHead:state}),mainState:async()=>({kind:"event",eventId:"main"}),
  importSnapshot:async(input:any)=>{for(const file of input.repositories[0].files)files.set(file.path,blobs.get(file.contentHash)!);state={kind:"event",eventId:"imported"};return {eventId:state.eventId,importedRepositoryIds:["owned-repository"]};},
  resolveRepository:async()=>({repositoryId:"owned-repository"}),
  readFile:async(input:any)=>{const text=files.get(input.file.path);return text===undefined?null:{repositoryId:"owned-repository",path:input.file.path,fileId:"file:"+input.file.path,content:{kind:"text",text}};},
 };
 return {contextId:"owned",vcs,upload:async(text:string)=>{const id="blob:"+blobs.size;blobs.set(id,text);return id;},dir:async()=>"owned-review",entries:async()=>[...notes.keys()].map(path=>path.slice(path.lastIndexOf("/")+1)),write:async(path:string,text:string)=>{notes.set(path,text);},read:async(path:string)=>bytes(notes.get(path)??"")};
}
const world:SourceAttributionWorld={id:"meaning",kind:"source-attribution",workspace:"system",sourceGroup:"unit:meaning",goal:"Explain where the cap came from, using the native source history. Do not save a note.",mayRetain:false,requestedReturnRequired:true,gates:"open",files:[{path:"cap.txt",text:"cap=3\n"},{path:"notes.txt",text:"Current cap is documented\n"}],actions:[],questions:[{path:"cap.txt",text:"cap=3",origin:"external"}],complete:"partial"};

it("separates actual native source custody from semantic completeness and binds mandatory review to the real requested value",async()=>{
 const fixture=await prepareSourceAttribution({caseId:world.id,contextId:"owned"},world,ports() as never);
 const assignment=await fixture.services.sourceOriginEvidence.discover();
 const other=assignment.candidates.find(candidate=>candidate.path==="notes.txt")!;
 await fixture.services.sourceOriginEvidence.read(assignment.id,other.id);
 const result={conclusion:{explanation:"The inspected evidence does not establish the requested origin.",disposition:"unverifiable" as const,claims:[]},receipt:null};
 const proof=await fixture.verify(result);
 expect(proof.checks.readExactCurrentSource).toBe(true);
 expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(result);
 expect(proof.actualResult).toEqual(result);
 expect(proof.semanticReviewInput.actual.observations.files[0].candidate.path).toBe("notes.txt");
 expect(proof.semanticReviewInput.expected).toEqual({goal:world.goal,requestedReturnRequired:true});
 // Native validity alone does not certify the absent requested origin answer.
 // A genuine semantic review is still mandatory; no author/answer is seeded.
 expect(JSON.stringify(proof.semanticReviewInput)).not.toContain("questions");
});

it("does not let verifier reads supply missing actor evidence or accept an invented span/receipt",async()=>{
 const fixture=await prepareSourceAttribution({caseId:world.id,contextId:"owned"},world,ports() as never);
 const result={conclusion:{explanation:"The inspected native roots establish the recorded origin.",disposition:"supported" as const,claims:[{fragment:"value",span:"unseen",origin:"native" as const,intent:"Invented",refs:["foreign"]}]},receipt:null};
 const proof=await fixture.verify(result);
 expect(proof.checks.readExactCurrentSource).toBe(false);
 expect(proof.checks.matchedSourceAttributionReport).toBe(false);
 expect(proof.passed).toBe(false);
 expect(proof.semanticReviewRequired).toBe(true);
});

it("retains an authorized uncertainty finding with its actual disposition and binds independently read bytes for review",async()=>{
 const noteWorld={...world,mayRetain:true,goal:world.goal+" Leave an accurate local note describing the limits."};
 const fixture=await prepareSourceAttribution({caseId:world.id,contextId:"owned"},noteWorld,ports() as never);
 const assignment=await fixture.services.sourceOriginEvidence.discover();
 const file=await fixture.services.sourceOriginEvidence.read(assignment.id,assignment.candidates[0]!.id);
 const conclusion={explanation:"The inspected evidence does not establish the requested origin.",disposition:"unverifiable" as const,claims:[]};
 const receipt=await fixture.services.sourceOriginReceipt.retain(assignment.id,file!.state,conclusion);
 const proof=await fixture.verify({conclusion,receipt});
 expect(proof.checks.verifiedOwnedSourceReceipt).toBe(true);
 expect(proof.semanticReviewRequired).toBe(true);
 expect(JSON.parse(proof.retainedText!).conclusion).toEqual(conclusion);
 expect(proof.semanticReviewInput.actual.artifacts.retainedText).toBe(proof.retainedText);
 // This establishes exact authorized persistence, not the requested answer's
 // adequacy. Mandatory semantic review still decides that from native facts.
});

it("does not demand a redundant root result after a requested note is natively retained",async()=>{
 const noteWorld={...world,mayRetain:true,requestedReturnRequired:false,goal:"Keep an accurate private note of the available source evidence and its limits."};
 const fixture=await prepareSourceAttribution({caseId:world.id,contextId:"owned"},noteWorld,ports() as never);
 const assignment=await fixture.services.sourceOriginEvidence.discover();
 const file=await fixture.services.sourceOriginEvidence.read(assignment.id,assignment.candidates[0]!.id);
 await fixture.services.sourceOriginReceipt.retain(assignment.id,file!.state,{explanation:"The inspected evidence does not establish the requested origin.",disposition:"unverifiable",claims:[]});
 const proof=await fixture.verify(undefined);
 expect(proof.checks.verifiedOwnedSourceReceipt).toBe(true);
 expect(proof.outcomeDimensions.returnedValue.required).toBe(false);
 expect(proof.semanticReviewInput.actual.requestedReturn).toBeNull();
 expect(proof.semanticReviewInput.expected.requestedReturnRequired).toBe(false);
 expect(proof.semanticReviewInput.actual.artifacts.retainedText).toBe(proof.retainedText);
 expect(proof.passed).toBe(true);
 expect(proof.semanticReviewRequired).toBe(true);
});

it("qualifies a missing-source reference using a genuinely unissued-lineage negative, not a private disposition",async()=>{
 const missingWorld={...world,goal:"Can you establish the missing guide's origin? Leave it unresolved if no exact source remains.",candidates:["missing-guide.txt"],questions:[],complete:"unverifiable" as const};
 const fixture=await prepareSourceAttribution({caseId:world.id,contextId:"owned"},missingWorld,ports() as never);
 const proof=await fixture.qualify();
 expect(proof.checks.rejectedWrongLineage).toBe(true);
 expect(proof.checks.readExactCurrentSource).toBe(true);
 expect(proof.passed).toBe(true);
 expect(proof.semanticReviewRequired).toBe(true);
});
