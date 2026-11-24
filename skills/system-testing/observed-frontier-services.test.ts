import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { matchUrlBoundCredentialCandidates, findCredentialBinding } from "@vibestudio/credential-client/urlBoundSelection";
import { findMatchingUrlAudience } from "@vibestudio/credential-client/urlAudience";
import { credentialLifecycle } from "@vibestudio/credential-client/credentialStatus";
import { prepareOpenImageCandidate } from "./open-goal-image-candidate-managed.js";
import { prepareOpenNewsEvidence } from "./open-goal-news-evidence-managed.js";
import { prepareOpenApiReadiness } from "./open-goal-api-readiness-managed.js";
import { prepareOpenPersonalWelcome } from "./open-goal-personal-welcome-managed.js";
import { personalWelcomeWorlds } from "./open-goal-personal-welcome-worlds.js";
vi.mock("@workspace/runtime",()=>({contextId:null,fs:{},rpc:{},vcs:{},images:{},credentials:{}}));
vi.mock("./session-replay-managed.js",()=>({createOwnedHeadlessChannel:vi.fn(),withOwnedChannelClient:vi.fn()}));
vi.mock("./scratch-handoff-managed.js",()=>({readWorkspaceBytes:vi.fn()}));
vi.mock("@workspace-skills/scratch-handoff-bindings",()=>({bindScratchHandoff:()=>({scratchHandoffWrite:{stage:vi.fn()}})}));
const digest=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
function nativePorts(){
 const rows:unknown[]=[];const files=new Map<string,string>();const blobs=new Map<string,string>();
 const assets=new Map<string,{asset:Record<string,unknown>;base64:string}>();
 return {
  contextId:"owned",fs:{mkdtemp:async()=>"/scratch",writeFile:async(path:string,text:string)=>{files.set(path,text);},readdir:async()=>[]},
  status:async()=>({mainEventId:"unchanged",workingHead:{kind:"event",id:"unchanged"}}),
  open:async()=>({key:"channel"}),
  append:async(_lane:unknown,_owner:string,records:unknown[])=>records.map(record=>{const seq=rows.length+1,id=`message-${seq}`;rows.push({id,messageId:id,envelopeId:`envelope-${seq}`,seq,record,selection:record});return id;}),
  read:async()=>({channelId:"channel",through:rows.length,rows:structuredClone(rows)}),
  readBytes:async(path:string)=>new TextEncoder().encode(files.get(path)??""),
  put:async(text:string)=>{const hash=digest(text);blobs.set(hash,text);return hash;},get:async(hash:string)=>blobs.get(hash)??null,
  images:{
   importAsset:async({base64}:{base64:string})=>{const bytes=Buffer.from(base64,"base64");const id=`asset-${assets.size+1}`;
    const mimeType=bytes[0]===0x89?"image/png":bytes[0]===0xff?"image/jpeg":"image/webp";
    const asset={id,digest:digest(bytes),mimeType,width:1,height:1,byteLength:bytes.length};assets.set(id,{asset,base64});return asset;},
   readAsset:async(id:string)=>{const item=assets.get(id);if(!item)throw new Error("unknown image asset");return structuredClone(item);},
   release:async({assetId}:{assetId:string})=>{assets.delete(assetId);},
  },
 };
}
const apiInstalled={match:matchUrlBoundCredentialCandidates,binding:findCredentialBinding,audience:findMatchingUrlAudience,lifecycle:credentialLifecycle};
const newsInstalled={canonicalizeUrl:(url:string)=>new URL(url).toString(),articleId:async(url:string)=>digest(url),capture:async(_assigned:unknown,_call:unknown,_goal:string,view:{kind:string})=>({view:view.kind,overview:{id:"overview",setup:"configured",enabledFeeds:1,failedFeeds:0,untriagedCount:0},pages:[]})};
const stable={image:"image-candidate-jpeg-extensions-normalized",news:"news-evidence-closure-not-mirrors",api:"api-readiness-api-versus-git-read",welcome:"welcome-connected-is-unverified"};
const changed={image:"image-candidate-held-glaze-local-rights-withdrawn",news:"news-evidence-held-late-reader-revocation",api:"api-readiness-held-foreign-selection-overrides",welcome:"welcome-unread-device-owner"};
type Family=keyof typeof stable;
async function prepare(family:Family,caseId:string){
 const input={contextId:"owned",caseId};const ports=nativePorts();
 if(family==="image"){
  const fixture=await prepareOpenImageCandidate(input,ports as never),s=fixture.services;
  const index=await s.imageCandidateBriefs.list();
  return {family:"image" as const,fixture,read:()=>s.imageCandidateJournal.read(index.channelId),proof:async()=>(await fixture.verify({})).observedChecks.exactImageFrontiers,index};
 }
 if(family==="news"){
  const fixture=await prepareOpenNewsEvidence(input,newsInstalled as never,ports as never),s=fixture.services;
  const index=await s.newsEvidenceIndex.list();
  return {family:"news" as const,fixture,read:()=>s.newsEvidenceJournal.read(index.scope.channelId),proof:async()=>(await fixture.verifyObserved()).observedChecks.exactNewsFrontiers,index};
 }
 if(family==="api"){
  const fixture=await prepareOpenApiReadiness(input,apiInstalled,ports as never),s=fixture.services;
  const index=await s.quietIntegrationIndex.list();
  return {family:"api" as const,fixture,read:()=>s.quietIntegrationJournal.read(index.scope.channelId),proof:async()=>(await fixture.verify({review:null,facts:[]})).observedChecks.exactIntegrationFrontiers,index};
 }
 const world=personalWelcomeWorlds.find(row=>row.id===caseId)!;
 const installed={catalog:world.resources.map(({id})=>({id,title:id,scope:"personal"})),deck:[],route:()=>null,bindProbe:vi.fn()};
 const fixture=await prepareOpenPersonalWelcome(input,installed,ports as never),s=fixture.services;
 const index=await s.welcomeResourceIndex.list();
 return {family:"welcome" as const,fixture,read:()=>s.welcomeReceiptStore.read(index.scope.channelId),proof:async()=>(await fixture.verify({})).observedChecks.exactWelcomeFrontiers,index};
}
it.each(Object.keys(stable) as Family[])("%s admits one stable observation and arbitrary redundant refreshes",async family=>{
 const p=await prepare(family,stable[family]);
 expect(await p.proof()).toBe(false);
 const first=await p.read();
 expect(await p.proof()).toBe(true);
 if(p.family==="image"){
  const candidate=first!.rows.find(row=>"record" in row&&row.record.kind==="candidate");
  if(!candidate||!("record" in candidate))throw new Error("Missing owned image candidate");
  expect((await p.fixture.services.imageCandidateOriginal.read(p.index.briefs[0].id,candidate.record.candidateId)).status).toBe("verified");
 }else if(p.family==="news"){
  expect(await p.fixture.services.newsEvidenceReader.read(p.index.scope.channelId,{kind:"saved"})).not.toBe(null);
 }else if(p.family==="welcome"){
  expect(await p.fixture.services.welcomeResourceResolution.resolve(p.index.resources[0].id)).not.toBe(null);
  expect(await p.fixture.services.onboardingRead.inspect()).not.toBe(null);
 }
 for(let i=0;i<4;i++)expect(await p.read()).toEqual(first);
 expect(await p.proof()).toBe(true);
});
it.each(Object.keys(changed) as Family[])("%s rejects an unrefreshed changed frontier and admits its observed current state",async family=>{
 const p=await prepare(family,changed[family]);
 const first=await p.read();
 expect(await p.proof()).toBe(false);
 const current=await p.read();
 expect(current!.through).toBeGreaterThan(first!.through);
 expect(await p.proof()).toBe(true);
});
it("keeps revoked image and News authority denied after refreshing",async()=>{
 const image=await prepare("image",changed.image);if(image.family!=="image")throw new Error("Expected image fixture");const first=await image.read();
 const candidate=first!.rows.find(row=>row.record.kind==="candidate")!.record.candidateId;
 expect((await image.fixture.services.imageCandidateOriginal.read(image.index.briefs[0].id,candidate)).status).toBe("refused");
 await image.read();
 expect((await image.fixture.services.imageCandidateOriginal.read(image.index.briefs[0].id,candidate)).status).toBe("refused");
 const news=await prepare("news",changed.news);if(news.family!=="news")throw new Error("Expected News fixture");await news.read();await news.read();
 expect(await news.fixture.services.newsEvidenceReader.read(news.index.scope.channelId,{kind:"saved"})).toBe(null);
});
it("keeps foreign API selection and stale Personal owner binding denied",async()=>{
 const api=await prepare("api",changed.api);if(api.family!=="api")throw new Error("Expected API fixture");await api.read();const current=await api.read();
 expect(await api.fixture.services.quietIntegrationProtocol.open(api.index.profiles[0].id,current!.rows.at(-1)!.messageId)).toBe(null);
 const welcome=await prepare("welcome",changed.welcome);if(welcome.family!=="welcome")throw new Error("Expected Personal fixture");await welcome.read();
 expect(await welcome.fixture.services.welcomeResourceResolution.resolve(welcome.index.resources[0].id)).toBe(null);
 await welcome.read();
 expect(await welcome.fixture.services.welcomeResourceResolution.resolve(welcome.index.resources[0].id)).not.toBe(null);
});
