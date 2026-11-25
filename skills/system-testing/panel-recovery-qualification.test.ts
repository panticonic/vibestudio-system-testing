import {expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({panels:new Map<string,any>()}));
vi.mock("@workspace/runtime",()=>({panelTree:{get:(id:string)=>state.panels.get(id)},vcs:{status:async()=>({mainEventId:"main",workingHead:{id:"working"},committed:[]})}}));
vi.mock("@workspace-skills/panel-health-runtime",()=>({bindPanelHealth:(panel:any)=>({panelHealth:{observe:()=>panel.health(),observeAfter:()=>panel.health()}})}));
import {prepareOpenPanelRecovery} from "./open-goal-panel-recovery-managed.js";
import {openGoalPanelRecoveryWorlds} from "./open-goal-panel-recovery-worlds.js";
async function fixture(caseId:string){
 state.panels.clear();const world=openGoalPanelRecoveryWorlds.find(row=>row.id===caseId)!;
 for(const surface of world.surfaces){
  const panelId="panel-"+surface.id,frame=surface.frames[surface.initial]!;
  const generation={panelId,attemptId:"attempt",buildKey:"build",runtimeEntityId:"runtime-"+surface.id};
  const dom={stage:surface.initial,title:surface.title,audience:surface.audience,instance:"renderer-"+surface.id,markers:Object.entries(frame.markers).map(([id,values])=>({id,values})),controls:frame.controls.map(({id,label})=>({id,label}))};
  const identity={...generation,kind:"workspace",contextId:"ctx",source:"source",requestedRef:"ctx:ctx"};
  let observations=0;
  const panel={id:panelId,observe:async()=>identity,stateArgs:{get:async()=>({scene:surface})},
   cdp:{session:async()=>({receipt:{generation},page:{waitForSelector:async()=>{},evaluate:async()=>structuredClone(dom)},close:async()=>{}})},
   snapshot:async()=>({...generation,document:{text:[surface.title,surface.audience,...Object.values(frame.markers).flat()].join(" ")}}),
   health:async()=>({...generation,id:`health-${surface.id}-${++observations}`,markers:dom.markers,diagnostics:frame.logs.map((row,sequence)=>({...row,sequence})),phase:"ready",dropped:0})};
  state.panels.set(panelId,panel);
 }
 return prepareOpenPanelRecovery({contextId:"ctx",caseId,source:"source",recoveryPanels:world.surfaces.map(surface=>({surfaceId:surface.id,panelId:"panel-"+surface.id}))});
}
it("does not publish a hold-denial positive when an authorized healthy renderer needs no recovery",async()=>{
 const proof=await(await fixture("verify-healthy-shuttle-screen-without-restarting-it")).qualify();
 expect(proof.passed).toBe(true);expect(Object.hasOwn(proof.checks,"enforcesHold")).toBe(false);
 expect(proof.outcomeContract.effects.checks).not.toContain("enforcesHold");
 expect(proof.outcomeDimensions.effects.checks.rejectsCatalogAlias).toBe(true);
});
it("retains an actually exercised denial and its native outcome role",async()=>{
 const proof=await(await fixture("inspect-copy-of-signed-screen-without-bypassing-approval")).qualify();
 expect(proof.passed).toBe(true);expect(proof.checks.enforcesHold).toBe(true);
 expect(proof.outcomeDimensions.effects.checks.enforcesHold).toBe(true);
});
