import {sha256HexSyncText} from "@vibestudio/content-addressing";
import type {WorkspaceEditFixture} from "./open-goal-owned-research-worlds.js";

export type WorkspaceEditObservations = {
  contents: Record<string,string>;
  reads: readonly {path:string;version:string}[];
  attempts: readonly {path:string;version:string;text:string;status:string}[];
};

/** The authored example identifies editable lines, never the required prose. */
export function workspaceEditScope(world:WorkspaceEditFixture) {
  const original=world.files[world.destination]!;
  if(!original || !world.expected.endsWith(world.concurrentAddition))throw Error("Workspace edit lacks its original scope and concurrent addition");
  const reference=world.expected.slice(0,world.expected.length-world.concurrentAddition.length);
  const before=original.match(/.*(?:\n|$)/gu)!.filter(Boolean),after=reference.match(/.*(?:\n|$)/gu)!.filter(Boolean);
  let first=0,lastBefore=before.length,lastAfter=after.length;
  while(first<lastBefore&&first<lastAfter&&before[first]===after[first])first++;
  while(lastBefore>first&&lastAfter>first&&before[lastBefore-1]===after[lastAfter-1]){lastBefore--;lastAfter--;}
  if(first===lastBefore)throw Error("Workspace edit needs a nonempty authored change region");
  return {prefix:before.slice(0,first).join(""),original:before.slice(first,lastBefore).join(""),suffix:before.slice(lastBefore).join(""),reference:after.slice(first,lastAfter).join("")};
}

/** Pure checks over actual retained bytes and native revisions, suitable for offline reassessment. */
export function checkWorkspaceEditEvidence(world:WorkspaceEditFixture, observations:WorkspaceEditObservations) {
  const {contents,reads,attempts}=observations,scope=workspaceEditScope(world);
  const actual=contents[world.destination],suffix=scope.suffix+world.concurrentAddition;
  const scoped=typeof actual==="string"&&actual.startsWith(scope.prefix)&&actual.endsWith(suffix)&&actual.length>=scope.prefix.length+suffix.length;
  const replacement=scoped?actual.slice(scope.prefix.length,actual.length-suffix.length):null;
  const version=typeof actual==="string"?sha256HexSyncText(actual):null;
  const original=world.files[world.destination]!;
  let current=original,raced=false,written=false,valid=true;
  for(const attempt of attempts){
    if(attempt.path!==world.destination||attempt.status==="unavailable")continue;
    if(attempt.status==="changed"){
      if(!raced){current+=world.concurrentAddition;raced=true;}
      else if(attempt.version===sha256HexSyncText(current))valid=false;
    }else if(attempt.status==="written"){
      if(!raced||attempt.version!==sha256HexSyncText(current))valid=false;
      current=attempt.text;written=true;
    }else valid=false;
  }
  const exactNativeState=valid&&current===actual;
  const checks={
    discoveredWorkspace:reads.some(read=>read.path===world.source)&&reads.some(read=>read.path===world.destination),
    recoveredConcurrentEdit:raced&&written&&exactNativeState,
    exactDocumentReadback:version!==null&&reads.some(read=>read.path===world.destination&&read.version===version)&&
      written&&exactNativeState&&
      replacement!==null&&replacement.trim().length>0&&replacement!==scope.original,
    preservedOtherDocuments:Object.entries(world.files).every(([path,text])=>path===world.destination||contents[path]===text),
  };
  return {checks,scopePreserved:scoped,version,edit:{path:world.destination,originalText:original,originalSha256:sha256HexSyncText(original),retainedText:actual??null,retainedSha256:version,
    editableOriginal:scope.original,actualReplacement:replacement,protectedPrefix:scope.prefix,protectedSuffix:suffix,
    authority:{path:world.source,text:world.files[world.source]!,sha256:sha256HexSyncText(world.files[world.source]!)},concurrentAddition:world.concurrentAddition}};
}
