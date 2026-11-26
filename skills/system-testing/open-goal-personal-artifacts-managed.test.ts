import {beforeEach,it,expect,vi} from "vitest";
const native=vi.hoisted(()=>({bookmarks:[] as any[],visits:[] as any[],nodes:new Map<string,any>(),order:[] as string[],sequence:0,revision:0}));
vi.mock("@workspace/runtime",()=>{
 const handle=(id:string)=>({id,stateArgs:{get:async()=>structuredClone(native.nodes.get(id).args),patch:async(data:any)=>{const node=native.nodes.get(id);node.args={...node.args,...data,...(data.notes?{notes:{...node.args.notes,...data.notes}}:{})};native.revision++;return structuredClone(node.args);}},archive:async()=>{const remove=(key:string)=>{for(const n of [...native.nodes.values()])if(n.parentSlotId===key)remove(n.slotId);native.nodes.delete(key);native.order=native.order.filter(row=>row!==key);};remove(id);native.revision++;},setTitle:async(title:string)=>{native.nodes.get(id).title=title;native.revision++;},movePanel:async(parent:string,opts:any={})=>{native.nodes.get(id).parentSlotId=parent;native.order=native.order.filter(row=>row!==id);const index=opts.beforeSlotId?native.order.indexOf(opts.beforeSlotId)+1:native.order.length;native.order.splice(index,0,id);native.revision++;}});
 return {contextId:"owned-artifacts",browserData:{
  addBookmark:async(data:any)=>{const id=++native.sequence;native.bookmarks.push({id,folder_path:data.folderPath,title:data.title,url:data.url,position:data.position,keyword:data.keyword,tags:data.tags,date_added:100});return id;},
  getBookmarks:async(folder:string)=>structuredClone(native.bookmarks.filter(row=>row.folder_path===folder)),
  updateBookmark:async(id:number,data:any)=>{const row=native.bookmarks.find(row=>row.id===id);if(data.folderPath)row.folder_path=data.folderPath;if(data.title)row.title=data.title;},
  deleteBookmark:async(id:number)=>{native.bookmarks=native.bookmarks.filter(row=>row.id!==id);},
  recordHistoryVisit:async(data:any)=>{const id=++native.sequence;native.visits.push({id,url:data.url,title:data.title,last_visit:data.visitTime});return id;},
  getHistory:async({search}:any)=>structuredClone(native.visits.filter(row=>row.url.includes(search))),
  deleteHistoryEntry:async(id:number)=>{native.visits=native.visits.filter(row=>row.id!==id);},
 },createPanelSlot:async(source:string,data:any)=>{const id="panel-"+(++native.sequence);native.nodes.set(id,{slotId:id,parentSlotId:data.parentId,title:data.title,source,contextId:data.contextId,args:{notes:{}}});native.order.push(id);native.revision++;return handle(id);},
 panelTree:{get:handle,path:async(id:string)=>{const rows=[];for(let row=native.nodes.get(id);row;row=native.nodes.get(row.parentSlotId))rows.unshift({node:structuredClone(row)});return {revision:native.revision,entries:rows};},walk:async function*(root:string){const descendants=(parent:string):any[]=>native.order.flatMap(id=>{const row=native.nodes.get(id);return row?.parentSlotId===parent?[row,...descendants(id)]:[];});for(const node of descendants(root))yield {node:structuredClone(node)};}},};
});
import {prepareOpenPersonalArtifacts} from "@workspace-skills/open-personal-artifacts-runtime";
import {openPersonalArtifactWorlds} from "./open-goal-personal-artifacts-worlds.js";
beforeEach(()=>{native.bookmarks=[];native.visits=[];native.nodes.clear();native.order=[];native.sequence=0;native.revision=0;});
it.each(openPersonalArtifactWorlds)("$id binds actual artifacts and the literal return obligation",async world=>{
 const fixture=await prepareOpenPersonalArtifacts({contextId:"owned-artifacts",caseId:world.id},world);
 try{const proof=await fixture.qualify();expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.outcomeDimensions.returnedValue.required).toBe(world.outcomeContract.returnedValue.required);expect(proof.semanticReviewInput.expected.observations.independentCollection).toEqual(proof.independentCollection);}finally{await fixture.close();}
});
it("allows an additional authorized idempotent link while preserving final native state",async()=>{
 const world=openPersonalArtifactWorlds.find(row=>row.id==="preserve-safety-note-during-handoff-replan")!;
 const fixture=await prepareOpenPersonalArtifacts({contextId:"owned-artifacts",caseId:world.id},world);
 try{
  expect((await fixture.qualify()).passed).toBe(true);
  const library=await fixture.services.artifactLibrary.observe();
  const collection=await fixture.services.artifactCollection.observe();
  const panel=collection.nodes.find(row=>row.title==="Handover")!;
  const bookmark=library.bookmarks.find(row=>row.title==="Route confirmation")!;
  expect((await fixture.services.artifactCollection.link(collection.id,panel.id,library.id,bookmark.id,"Confirmed route")).status).toBe("applied");
  const proof=await fixture.verify(null);
  expect(proof.passed).toBe(true);
  expect(proof.links).toHaveLength(2);
  expect(proof.outcomeDimensions.returnedValue.required).toBe(false);
  expect(proof.semanticReviewInput.actual.requestedReturn).toBeNull();
 }finally{await fixture.close();}
});
