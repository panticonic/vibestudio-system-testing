import {createHash} from "node:crypto";
import {observeInvocation} from "@workspace/application-outcomes/observed-invocation";
import {describe,it,expect} from "vitest";
import {prepareTranscriptSurface} from "./open-goal-transcript-surface-managed.js";
import {openTranscriptSurfaceWorlds} from "./open-goal-transcript-surface-worlds.js";
import {assessSemanticOutcome} from "@workspace/application-outcomes/semantic-outcome-contract";

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
      // No trace was supplied: never invent a source definition for a rejected value.
      expect(wrong.incorrectReturnValues).toHaveLength(0);
      expect(assessSemanticOutcome(wrong).passed).toBe(!wrong.outcomeContract.returnedValue.required);
      if(world===openTranscriptSurfaceWorlds[0]){
        const actualValue={...native.report,decision:{effect:"invented",reason:"invented"}},texts=new Map<string,string>();
        const captured=[{id:"root",parent:null,source:"reviewTranscriptSurface.ts",kind:"crisp",value:actualValue},
          {id:"actual-decision",parent:"root",source:"reviewTranscriptSurface/decideTranscriptEffect.nl",kind:"agent",value:actualValue.decision},
          {id:"unrelated-equal",parent:"root",source:"other/decideTranscriptEffect.nl",kind:"agent",value:actualValue.decision}];
        const calls=captured.map(row=>{const text=JSON.stringify(row.value),hash=createHash("sha256").update(text).digest("hex");texts.set(hash,text);return {callId:row.id,summary:{run_id:"run",owner_key:owner,owner_kind:"eval"},record:{call_id:row.id,parent_call_id:row.parent,definition:{name:row.id,source:row.source},executor:{kind:row.kind,model_id:row.kind==="agent"?"teacher":null},cost:{model_requests:row.kind==="agent"?1:0},outcome:"done",output:{complete:true,hash}}};});
        const invocation=observeInvocation({evalRunId:"run",rootCallIds:["root"],captureErrors:[],calls},async hash=>texts.get(hash)??null);
        const bound=await fixture.verify(actualValue,invocation);
        expect(bound.outcomeDimensions.effects.passed).toBe(true);
        expect(bound.outcomeDimensions.returnedValue.passed).toBe(false);
        expect(bound.incorrectReturnValues.some(row=>row.definition.name==="actual-decision"&&row.valueJson===JSON.stringify(actualValue.decision))).toBe(true);
        expect(bound.incorrectReturnValues.some(row=>row.definition.name==="unrelated-equal")).toBe(false);
      }

    } finally {await fixture.close();}
  });
});
