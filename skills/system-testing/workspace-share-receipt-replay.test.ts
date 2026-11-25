import {it,expect} from "vitest";
import {channelInviteNotification} from "@vibestudio/shared/userNotifications";
import {prepareWorkspaceShare} from "./open-goal-workspace-share-managed.js";
import {openWorkspaceShareWorlds} from "./open-goal-workspace-share-worlds.js";
it("replays the actual native private handoff after lost response and preserves one artifact",async()=>{
 const world=openWorkspaceShareWorlds.find(row=>row.role==="author"&&row.purpose==="author-note"&&row.change==="current"&&row.state==="joined")!;
 expect(world).toBeDefined();
 const files=new Map<string,string>(),directories=new Set<string>();let writes=0,admitted=true;
 const fs={async mkdtemp(prefix:string){const path="/.tmp/"+prefix+"-"+crypto.randomUUID().replaceAll("-","");directories.add(path);return path;},
  async writeFile(path:string,text:string){if(path.endsWith("/.pending"))writes++;files.set(path,text);},
  async rename(from:string,to:string){files.set(to,files.get(from)!);files.delete(from);},
  async readdir(_path:string){return [...directories].map(path=>path.slice("/.tmp/".length));},
  async rm(path:string){directories.delete(path);for(const key of files.keys())if(key.startsWith(path+"/"))files.delete(key);}};
 const head={mainEventId:"owned-main",workingHead:{kind:"event",eventId:"owned-state"}};
 const ports={contextId:"owned",fs,vcs:{async status(){return structuredClone(head);}},async session(){return {admitted,accountRole:"member"};},
  async project({invite}:any){const retained=channelInviteNotification(invite,1);return {retained,pending:retained,currentRevision:1,member:true,action:"put",inbox:"pending"};},
  async readBytes(path:string,limit:number){if(!files.has(path))throw Error("Missing native file");return new TextEncoder().encode(files.get(path)!).slice(0,limit);}};
 const prepared=await prepareWorkspaceShare({contextId:"owned",caseId:world.id},world,ports as any);
 const first=await prepared.qualify();expect(first.passed).toBe(true);expect(first.handoff).not.toBeNull();
 expect(first.outcomeDimensions.effects.checks).toEqual(Object.fromEntries(first.outcomeContract.effects.checks.map(name=>[name,first.checks[name]])));
 const request=first.observation,decision=first.decision;
 // An interrupted caller retries exactly the already-committed request.
 expect(await prepared.services.workspaceShareHandoff.stage(request,decision)).toEqual(first.handoff);
 expect(writes).toBe(1);
 expect((await prepared.verify({assignment:first.assignment,observation:request,finding:{decision,reason:"Current owned authority"},handoff:first.handoff})).passed).toBe(true);
 await expect(prepared.services.workspaceShareHandoff.stage({...request,object:{...request.object,id:"foreign"}},decision)).rejects.toThrow(/another exact request/);
 admitted=false;await expect(prepared.services.workspaceShareHandoff.stage(request,decision)).rejects.toThrow(/no longer current/);
 admitted=true;files.set(first.handoff!.path,"corrupt");await expect(prepared.services.workspaceShareHandoff.stage(request,decision)).rejects.toThrow(/no longer current/);expect(writes).toBe(1);
});
