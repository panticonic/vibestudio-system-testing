import {expect,it,vi} from "vitest";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {renderComponent} from "@workspace-skills/visualize/render";
import {selectedPresentationViews} from "./presentation-managed.js";
import {prepareOpenLocalPresentation} from "./open-goal-local-presentation-managed.js";
import {openLocalPresentationWorlds} from "./open-goal-local-presentation-worlds.js";
vi.mock("@workspace/runtime",()=>({contextId:null,fs:{},panelTree:{},vcs:{}}));
const owner="native-presentation-test",source="panels/owned-preview";
function fixture(){
 const files=new Map<string,string>();let state:{previewRevision?:string;views?:{id:string;mdx:string}[]}={};
 let panelAttempt="actual-panel",rendered=true;
 const binding=()=>({kind:"workspace",phase:"ready",contextId:owner,source,requestedRef:"ctx:"+owner,attemptId:panelAttempt,buildKey:"actual-build"});
 const observe=vi.fn(async(_panel:unknown,views:NonNullable<ReturnType<typeof selectedPresentationViews>>,_context:string,_source:string,_signal:AbortSignal,revision?:string)=>({
   passed:rendered,checks:{actualDom:rendered},panelAttempt,buildKey:"actual-build",mdxDigests:views.map(v=>sha256HexSyncText(v.mdx)),
   rendered:{revision:revision??null,ids:views.map(v=>v.id),texts:views.map(v=>v.mdx),rendered:views.map(()=>rendered),errors:0,interactions:[],
    controls:views.map(()=>[{tag:"button",role:"radio",label:"Cedar",disabled:false,checked:"false",type:null}])}}));
 const ports={contextId:owner,files:{mkdtemp:async()=>"/owned-fixture",writeFile:async(path:string,text:string)=>{files.set(path,text);},
   readFile:async(path:string)=>{if(!files.has(path))throw Error("Missing native file");return files.get(path)!;},rm:async()=>{files.clear();}},
   getPanel:()=>({observe:async()=>binding(),stateArgs:{get:async()=>structuredClone(state),patch:async(patch:typeof state)=>{state={...state,...patch};}}}),
   head:async()=>({mainEventId:"protected-main",workingHead:{kind:"event",eventId:"protected-head"}}),observe};
 return {ports:ports as unknown as NonNullable<Parameters<typeof prepareOpenLocalPresentation>[2]>,observe,
   breakDom:()=>{rendered=false;},replacePanel:()=>{panelAttempt="replaced-panel";},corruptState:()=>{state.views=[];}};
}
const world=()=>openLocalPresentationWorlds.find(v=>v.id==="present-local-studio-bex-booking")!;
function actualReport(id="room-choice"){
 return {views:[{id,status:"ready" as const,rendered:renderComponent({component:"Choices",props:{id:"confirmed-rooms",question:"Which confirmed room would you like?",options:["Cedar","Willow"],multiple:false}})}],omitted:[]};
}
it("observes the actual legitimate choices and binds their retained display for required meaning review",async()=>{
 const {ports,observe}=fixture(),w=world();
 const prepared=await prepareOpenLocalPresentation({contextId:owner,caseId:w.id,panelId:"preview",source},w,ports);
 try{
  const record=await prepared.services.presentationRecords.read("working-record"),report=actualReport("actual-layout");
  const shown=await prepared.services.presentationRecords.preview(record.id,record.revision,report);
  expect(shown.status).toBe("visible");
  const proof=await prepared.verify({status:"visible",receipt:shown.status==="visible"?shown.receipt:null,notes:[]});
  expect(proof.passed).toBe(true);expect(proof.checks.independentlyVerifiedPresentationDom).toBe(true);
  expect(proof.semanticReviewRequired).toBe(true);
  expect(proof.semanticReviewInput.actual.artifacts).toEqual({report,display:proof.display});
  expect(proof.semanticReviewInput.actual.observations["previewDisplay"]).toEqual(proof.previewDisplay);
  expect(proof.display?.rendered.controls?.[0]?.[0]?.disabled).toBe(false);
  expect(observe.mock.calls.every(call=>call[1].every(view=>!view.interaction))).toBe(true);
 }finally{await prepared.close();}
});
for(const mode of ["native-dom","current-state","panel-owner"] as const)it(`actual artifact checks retain ${mode} rejection`,async()=>{
 const f=fixture(),w=world(),prepared=await prepareOpenLocalPresentation({contextId:owner,caseId:w.id,panelId:"preview",source},w,f.ports);
 try{
  const record=await prepared.services.presentationRecords.read("working-record"),shown=await prepared.services.presentationRecords.preview(record.id,record.revision,actualReport());
  if(mode==="native-dom")f.breakDom();else if(mode==="current-state")f.corruptState();else f.replacePanel();
  if(mode==="panel-owner")expect((await prepared.verify({status:"visible",receipt:shown.status==="visible"?shown.receipt:null,notes:[]})).checks.protectedPresentationHeadUnchanged).toBe(false);
  else expect((await prepared.verify({status:"visible",receipt:shown.status==="visible"?shown.receipt:null,notes:[]})).checks.independentlyVerifiedPresentationDom).toBe(false);
 }finally{await prepared.close();}
});
it("actual projection still rejects forged MDX, invalid component props and duplicate view IDs",()=>{
 const report=actualReport();expect(selectedPresentationViews(report)).not.toBeNull();
 const mdx=structuredClone(report);mdx.views[0]!.rendered.mdx="<script>bad()</script>";expect(selectedPresentationViews(mdx)).toBeNull();
 const props=structuredClone(report);if(props.views[0]!.rendered.component!=="Choices")throw Error("Missing choices");props.views[0]!.rendered.props.options=[];expect(selectedPresentationViews(props)).toBeNull();
 expect(selectedPresentationViews({...report,views:[...report.views,...report.views]})).toBeNull();
});

import {prepareAudienceResponse} from "./open-goal-audience-response-managed.js";
import {openAudienceResponseWorlds} from "./open-goal-audience-response-worlds.js";
it("audience response admits valid actual props and binds the presentation alongside its answer",async()=>{
 const f=fixture(),w=openAudienceResponseWorlds.find(v=>v.mode==="catalog"&&v.expected?.some(e=>"labels"in e&&e.component.component==="Choices"))!;
 const input={contextId:owner,caseId:w.id,panelId:"preview",source};
 const ports={contextId:owner,fs:f.ports.files,head:f.ports.head,getPanel:f.ports.getPanel,observe:f.ports.observe,probe:async()=>null};
 const prepared=await prepareAudienceResponse(input,w,ports as unknown as NonNullable<Parameters<typeof prepareAudienceResponse>[2]>);
 try{
  const record=await prepared.services.nativeAudienceResponse.readRecord();
  const target=w.expected!.find(e=>"labels"in e&&e.component.component==="Choices")!;
  if(!("labels"in target)||target.component.component!=="Choices")throw Error("Missing fixture choices");
  const presentation={views:[{id:"actual-audience-view",status:"ready" as const,
   rendered:renderComponent({...target.component,props:{...target.component.props,id:"actual-choice-control",question:"Which option would you like?",multiple:false}})}],omitted:[]};
  const receipt=await prepared.services.nativeAudienceResponse.render(record.id,record.revision,{presentation,modelId:null});
  expect(receipt).not.toBeNull();
  const answer={facts:w.facts.filter(fact=>w.answer.includes(fact.id)),text:w.source};
  const proof=await prepared.verify({answer,receipt});
  expect(proof.checks.verifiedNativeAudienceRendering).toBe(true);
  expect(proof.semanticReviewRequired).toBe(true);
  expect(proof.semanticReviewInput.actual.artifacts["presentation"]).toEqual({presentation,modelId:null});
 }finally{await prepared.close();}
});
