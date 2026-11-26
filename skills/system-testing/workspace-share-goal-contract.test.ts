import {it,expect} from "vitest";
import {channelInviteNotification} from "@vibestudio/shared/userNotifications";
import {prepareWorkspaceShare} from "./open-goal-workspace-share-managed.js";
import {openWorkspaceShareWorlds} from "./open-goal-workspace-share-worlds.js";
async function fixture(suffix:string){
 const world=openWorkspaceShareWorlds.find(row=>row.id==="workspace-share-"+suffix)!;expect(world).toBeDefined();
 const files=new Map<string,string>(),directories=new Set<string>();let writes=0;
 const fs={async mkdtemp(prefix:string){const p="/.tmp/"+prefix+"-"+crypto.randomUUID().replaceAll("-","");directories.add(p);return p;},async writeFile(p:string,s:string){if(p.endsWith("/.pending"))writes++;files.set(p,s);},async rename(a:string,b:string){files.set(b,files.get(a)!);files.delete(a);},async readdir(){return [...directories].map(p=>p.slice(6));},async rm(p:string){directories.delete(p);for(const k of files.keys())if(k.startsWith(p+"/"))files.delete(k);}};
 const head={mainEventId:"owned-main",workingHead:{kind:"event",eventId:"owned-state"}};
 const ports={contextId:"owned",fs,vcs:{async status(){return structuredClone(head);}},async session(){return {admitted:true,accountRole:"member"};},async project({invite,state}:any){const revision=state==="pending"?2:1;const retained=channelInviteNotification(invite,revision);return {retained,pending:retained,currentRevision:revision,member:true,action:"put",inbox:"pending"};},async readBytes(p:string,n:number){if(!files.has(p))throw Error("Missing native bytes");return new TextEncoder().encode(files.get(p)!).slice(0,n);}};
 const prepared=await prepareWorkspaceShare({contextId:"owned",caseId:world.id},world,ports as any);return {world,prepared,writes:()=>writes};
}
it("a permission question requires its answer and does not require an allowed write",async()=>{
 const f=await fixture("pending-channel-notice-with-object-consent");const proof=await f.prepared.qualify();
 expect(proof.decision).toBe("stage-reader");expect(f.world.requestedPrivateHandoff).toBe(false);expect(f.writes()).toBe(0);expect(proof.handoff).toBeNull();expect(proof.passed).toBe(true);expect(proof.outcomeContract.returnedValue.required).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 const wrong=await f.prepared.verify({finding:{decision:"hold-role",reason:"No reader permission"},handoff:null});expect(wrong.outcomeDimensions.effects.passed).toBe(true);expect(wrong.outcomeDimensions.returnedValue.passed).toBe(false);expect(wrong.passed).toBe(false);
});
it("an actually requested private handoff still requires authentic retained bytes",async()=>{
 const f=await fixture("author-approved-shift-brief");const a=await f.prepared.services.workspaceShareEvidence.discover();const o=await f.prepared.services.workspaceShareEvidence.inspect(a.document);
 const missing=await f.prepared.verify({finding:{decision:"stage-author",reason:"Exact current author permission"},handoff:null});expect(missing.checks.verifiedPrivateHandoff).toBe(false);expect(missing.passed).toBe(false);
 const proof=await f.prepared.qualify();expect(proof.passed).toBe(true);expect(proof.handoff).not.toBeNull();expect(f.writes()).toBe(1);expect(proof.outcomeContract.returnedValue.required).toBe(false);
 await expect(f.prepared.services.workspaceShareHandoff.stage({...o,object:{...o.object,id:"foreign"}},"stage-author")).rejects.toThrow();
});
it("an optional receipt echo does not falsify a separately grounded scope answer",async()=>{
 const f=await fixture("pending-channel-notice-with-object-consent");const p=await f.prepared.qualify();
 const proof=await f.prepared.verify({finding:{decision:p.decision,reason:"The exact approved reader role is current."},handoff:{path:"invented",bytes:0,sha256:"invented"}});
 expect(proof.checks.returnedHandoffMatchesActual).toBe(false);expect(proof.outcomeContract.incidentalValues.checks).toContain("returnedHandoffMatchesActual");expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.outcomeDimensions.returnedValue.passed).toBe(true);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
});
