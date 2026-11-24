import {expect,it,vi} from "vitest";
import {TestRunner} from "./test-runner.js";
import type {HeadlessRunner} from "./runner.js";
import type {TestCase} from "./types.js";
import {PANEL_AUTOMATION_RESOURCE as panelResource} from "./panel-authority.js";

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
function runner(){return {
  forTest:vi.fn(()=>({closeOwnedDevelopmentSessions:async()=>[],collectDiagnostics:async()=>({})})),
} as unknown as HeadlessRunner;}
function test(name:string,run:NonNullable<TestCase["orchestrate"]>,mode:"shared"|"exclusive"|"none"="shared"):TestCase{
  return {name,category:"fixture-resources",description:name,prompt:name,validation:"harness",
    ...(mode==="shared"?{sharedResources:[panelResource]}:mode==="exclusive"?{resources:[panelResource]}:{}),
    orchestrate:run,validate:()=>({passed:true})};
}
const complete=()=>({messages:[],duration:1});

it("overlaps owned fixtures but holds their panel lease through cleanup and retained capture",async()=>{
  const both=deferred(),release=deferred(),retaining=deferred(),retain=deferred();
  const panels=new Map<string,{contextId:string;text:string}>();
  let maxPanels=0,exclusiveStarted=false,disjointOverlap=false;
  const owned=(name:string)=>test(name,async()=>{
    const contextId=`context-${name}`,panelId=`panel-${name}`;
    panels.set(panelId,{contextId,text:name});maxPanels=Math.max(maxPanels,panels.size);
    if(panels.size===2)both.resolve();
    try{await release.promise;expect(panels.get(panelId)).toEqual({contextId,text:name});return complete();}
    finally{panels.delete(panelId);}
  });
  const tester=new TestRunner(runner(),{onTestResult:async entry=>{
    if(entry.test.name==="first"){retaining.resolve();await retain.promise;}
  }});
  const suite=tester.runSuite([owned("first"),owned("second"),
    test("global-tree",async()=>{exclusiveStarted=true;expect(panels.size).toBe(0);return complete();},"exclusive"),
    test("disjoint",async()=>{await both.promise;disjointOverlap=panels.size===2;release.resolve();return complete();},"none"),
  ],{concurrency:4});
  await retaining.promise;
  expect(exclusiveStarted).toBe(false);
  retain.resolve();
  expect((await suite).passed).toBe(4);
  expect(maxPanels).toBe(2);expect(disjointOverlap).toBe(true);expect(exclusiveStarted).toBe(true);expect(panels.size).toBe(0);
});

it("lets a waiting global-tree owner run before later shared fixtures while disjoint work proceeds",async()=>{
  const started=deferred(),release=deferred(),writer=deferred(),finishWriter=deferred();
  const order:string[]=[];
  const suite=new TestRunner(runner()).runSuite([
    test("first",async()=>{order.push("first");started.resolve();await release.promise;return complete();}),
    test("writer",async()=>{order.push("writer");writer.resolve();await finishWriter.promise;return complete();},"exclusive"),
    test("later",async()=>{order.push("later");return complete();}),
    test("disjoint",async()=>{await started.promise;order.push("disjoint");release.resolve();return complete();},"none"),
  ],{concurrency:4});
  await writer.promise;expect(order).toEqual(["first","disjoint","writer"]);finishWriter.resolve();
  expect((await suite).passed).toBe(4);expect(order.at(-1)).toBe("later");
});

it("uses the existing concurrency-one opt out and exclusive declarations override shared participation",async()=>{
  for(const exclusive of [false,true]){
    let active=0,max=0;
    const cases=Array.from({length:3},(_,i)=>({...test(`owned-${i}`,async()=>{
      active++;max=Math.max(max,active);await Promise.resolve();active--;return complete();
    }),...(exclusive?{resources:[panelResource]}:{})}));
    expect((await new TestRunner(runner()).runSuite(cases,{concurrency:exclusive?3:1})).passed).toBe(3);
    expect(max).toBe(1);
  }
});

it("cancels queued owners and joins both admitted fixture cleanup paths before settling",async()=>{
  const both=deferred(),cleaning=deferred(),cleanup=deferred();let started=0,closed=0,waitingRan=false;
  const owned=(name:string)=>test(name,async({signal})=>{
    if(++started===2)both.resolve();
    try{await new Promise<void>(resolve=>signal.addEventListener("abort",()=>resolve(),{once:true}));signal.throwIfAborted();return complete();}
    finally{if(++closed===2)cleaning.resolve();await cleanup.promise;}
  });
  const tester=new TestRunner(runner());let settled=false;
  const suite=tester.runSuite([owned("first"),owned("second"),test("waiting",async()=>{waitingRan=true;return complete();},"exclusive")],{concurrency:3}).finally(()=>{settled=true;});
  await both.promise;tester.cancel(new Error("Owned fixture checkpoint"));await cleaning.promise;
  expect(settled).toBe(false);expect(waitingRan).toBe(false);cleanup.resolve();await suite;
  expect(closed).toBe(2);expect(waitingRan).toBe(false);
});
