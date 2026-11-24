import {expect,it} from "vitest";
import {createHash} from "node:crypto";
import {checkWorkspaceEditEvidence,workspaceEditScope} from "./workspace-edit-evidence.js";
import {openGoalWorlds} from "./open-goal-worlds.js";
import {openOwnedResearchWorlds,type WorkspaceEditFixture} from "./open-goal-owned-research-worlds.js";
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
const worlds:WorkspaceEditFixture[]=[...openGoalWorlds.filter(world=>world.kind==="workspace-edit"||world.kind==="research-and-edit"),...openOwnedResearchWorlds.flatMap(world=>world.edit?[world.edit]:[])];
function observed(world:WorkspaceEditFixture,text=world.expected){
 const original=world.files[world.destination]!,changed=original+world.concurrentAddition;
 return {contents:{...world.files,[world.destination]:text},reads:[{path:world.source,version:sha(world.files[world.source]!)},{path:world.destination,version:sha(original)},{path:world.destination,version:sha(text)}],attempts:[
  {path:world.destination,version:sha(original),text,status:"changed"},{path:world.destination,version:sha(changed),text,status:"written"}]};
}
it.each(worlds.map((world,index)=>({world,index})))("checks actual native revisions and protected scope for authored edit $index",({world})=>{
 const proof=checkWorkspaceEditEvidence(world,observed(world));
 expect(Object.values(proof.checks).every(Boolean)).toBe(true);expect(proof.scopePreserved).toBe(true);
 const scope=workspaceEditScope(world),alternative=scope.prefix+scope.reference.trimEnd()+" (confirmed in the authoritative decision).\n"+scope.suffix+world.concurrentAddition;
 expect(checkWorkspaceEditEvidence(world,observed(world,alternative)).checks.exactDocumentReadback).toBe(true);
 const missingConcurrent=observed(world,world.expected.slice(0,-world.concurrentAddition.length));
 expect(checkWorkspaceEditEvidence(world,missingConcurrent).checks.exactDocumentReadback).toBe(false);
 const alteredNeighbor=observed(world);alteredNeighbor.contents[world.source]+=" changed";
 expect(checkWorkspaceEditEvidence(world,alteredNeighbor).checks.preservedOtherDocuments).toBe(false);
 const unread=observed(world);unread.reads=unread.reads.filter(read=>read.version!==sha(world.expected));
 expect(checkWorkspaceEditEvidence(world,unread).checks.exactDocumentReadback).toBe(false);
});
it("accepts the actual wave0047 citation-enriched tutorial while retaining exact original bytes",()=>{
 const world=worlds.find(world=>world.destination==="tutorial-draft.md")!;
 const actual="# DNS tutorial\n\nThe reserved example domains are not available for registration or transfer (IANA, https://www.iana.org/help/example-domains). They include example.com, example.net, and example.org (RFC 2606, https://www.rfc-editor.org/info/rfc2606/).\n\nSet up the rest of the tutorial in a local environment.\n\nThe exercises are intended for beginners.\n";
 const proof=checkWorkspaceEditEvidence(world,observed(world,actual));expect(Object.values(proof.checks).every(Boolean)).toBe(true);
 expect(proof.edit.retainedText).toBe(actual);expect(proof.edit.retainedSha256).toBe(sha(actual));
 expect(actual).not.toBe(world.expected);
 const wrongProtected=actual.replace("local environment","production environment");
 expect(checkWorkspaceEditEvidence(world,observed(world,wrongProtected)).checks.exactDocumentReadback).toBe(false);
 const stale=observed(world,actual);stale.attempts[1]!.version="0".repeat(64);
 expect(checkWorkspaceEditEvidence(world,stale).checks.recoveredConcurrentEdit).toBe(false);
});
it("accepts several genuine revisions after recovery without requiring a prescribed intermediate read",()=>{
 const world=worlds[0]!,data=observed(world),scope=workspaceEditScope(world);
 const refined=scope.prefix+scope.reference.trimEnd()+" (approved).\n"+scope.suffix+world.concurrentAddition;
 data.attempts.push({path:world.destination,version:sha(world.expected),text:refined,status:"written"});
 data.contents[world.destination]=refined;data.reads.push({path:world.destination,version:sha(refined)});
 expect(Object.values(checkWorkspaceEditEvidence(world,data).checks).every(Boolean)).toBe(true);
});
