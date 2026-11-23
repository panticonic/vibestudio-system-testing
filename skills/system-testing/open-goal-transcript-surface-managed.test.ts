import {describe,it,expect} from "vitest";
import {prepareTranscriptSurface} from "./open-goal-transcript-surface-managed.js";
import {openTranscriptSurfaceWorlds} from "./open-goal-transcript-surface-worlds.js";
import {assessSemanticOutcome} from "./semantic-outcome-contract.js";

describe("transcript application values with independent native projection",()=>{
  for(const world of openTranscriptSurfaceWorlds) it(world.id,async()=>{
    const context="current-context",owner="current-owner",files=new Map<string,Uint8Array>();
    const lane=(id:string)=>{const rows:any[]=[];return {id,
      async publish(payload:unknown,messageId:string){const row={id:rows.length+1,messageId,senderId:owner,type:"agentic.trajectory.v1/event",payload,createdAt:new Date().toISOString()};rows.push(row);return row;},
      async replay(){return {ready:{contextId:context,hasMoreAfter:false},logEvents:structuredClone(rows)};}};};
    const fixture=await prepareTranscriptSurface({contextId:context,caseId:world.id},world,{
      context,owner,primary:lane("primary"),other:lane("neighbor"),
      write:async(path,text)=>{files.set(path,new TextEncoder().encode(text));},
      read:async path=>{const value=files.get(path);if(!value)throw new Error("Missing native source");return value;},close:async()=>{},
    } as any);
    try {
      const native=await fixture.qualify();
      expect(native.checks).toEqual(Object.fromEntries(Object.keys(native.checks).map(key=>[key,true])));
      expect(assessSemanticOutcome(native).passed).toBe(true);
      expect(Object.keys(native.report).sort()).toEqual(["decision","receipt"]);
      const wrong=await fixture.verify({...native.report,decision:{effect:"invented",reason:"invented"}});
      expect(wrong.checks.matchedTranscriptSurfaceReport).toBe(false);
      expect(wrong.outcomeContract.effects.checks.every(key=>wrong.checks[key])).toBe(true);
      expect(wrong.incorrectReturnValues).toHaveLength(1);
      expect(assessSemanticOutcome(wrong).passed).toBe(!wrong.outcomeContract.returnedValue.required);
    } finally {await fixture.close();}
  });
});
