import {observedContentReviewInput} from '/home/werg/vibe-native-recovery-review-bindings/scripts/lib/observed-content-admission.mjs';
/** Reference-call projection supplies its actual reference return at the existing capture boundary. This is not a teacher Root witness.
 * Component native port executes actual authored notebook code and emits execution-derived receipts/events.
 * No model, network or physical EvalDO qualification is involved. */
import {expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
vi.mock('@workspace/runtime',()=>({contextId:'agent-owner',rpc:{},vcs:{}}));
import {prepareAgentCapability} from './open-goal-agent-capability-managed.js';
import {openAgentCapabilityWorlds} from './open-goal-agent-capability-worlds.js';
function ports(){
 const scopes=new Map<string,Record<string,unknown>>(),runs=new Map<string,any>();let count=0,closed=false;const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const native={allocateScope:()=>{const id='native-scope-'+(++count);scopes.set(id,{});return id;},
 run:async(scopeKey:string,code:string,cancel=false)=>{const scope=scopes.get(scopeKey);if(!scope)throw Error('No owned native scope');const runId='native-run-'+(++count),console:string[]=[];let result:any;
  if(cancel)result={success:false,console:'',failureKind:'cancelled',failureCode:'eval_cancelled',error:{errorKind:'application',name:'Error',message:'Native action cancelled before admission'}};
  else try{const log=(...args:unknown[])=>console.push(args.map(String).join(' '));const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;const value=await new AsyncFunction('scope','console',code)(scope,{log,info:log,warn:log,error:log});result={success:true,console:console.join('\n'),returnValue:value};}catch(error){result={success:false,console:console.join('\n'),error:{errorKind:'application',name:error instanceof Error?error.name:'Error',message:error instanceof Error?error.message:'Native action failed'}};}
  const receipt={runId,runDigest:hash({scopeKey,runId,code}),resultDigest:hash(result),result,acknowledged:false};const states=cancel?['cancelled-before-admission']:['accepted','running',result.success?'succeeded':'failed'];const events=states.map((status,i)=>({sequence:i+1,kind:'state',payload:{status}}));if(result.console)events.push({sequence:events.length+1,kind:'console',payload:{text:result.console}} as any);const run={runId,scopeKey,code,receipt};runs.set(runId,{run,events});return run;},
 observe:async(run:any)=>{const value=runs.get(run.runId);if(!value||value.run.scopeKey!==run.scopeKey)throw Error('Unknown native run');return structuredClone(value.run.receipt);},
 events:async(run:any)=>({events:structuredClone(runs.get(run.runId).events),complete:true}),
 text:async(scopeKey:string,key:string)=>{const value=scopes.get(scopeKey)?.[key];if(typeof value!=='string')throw Error('No actual retained text');return value;},
 close:async()=>{scopes.clear();closed=true;}};
 return {contextId:'agent-owner',vcs:{status:async()=>({mainEventId:'protected-main',workingHead:{kind:'event',eventId:'unchanged'}})},native,isClosed:()=>closed};
}
for(const world of openAgentCapabilityWorlds)it('checks native action, current authority and literal answer obligation: '+world.id,async()=>{
 const p=ports(),fixture=await prepareAgentCapability({contextId:'agent-owner',caseId:world.id},world,p as never);try{const proof=await fixture.qualify();expect(proof.passed,JSON.stringify(proof.checks)).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(observedContentReviewInput({...proof,actualResult:proof.report},world)).toEqual(proof.semanticReviewInput);expect(proof.outcomeContract.returnedValue.required).toBe(world.requestedReturnRequired);if(world.requestedReturnRequired)expect((await fixture.verify(undefined)).passed).toBe(false);}finally{await fixture.close();}expect(p.isClosed()).toBe(true);
});
it('does not demand a predecessor read or continuation effect to answer a current-action question',async()=>{
 const world=openAgentCapabilityWorlds[0],p=ports(),fixture=await prepareAgentCapability({contextId:'agent-owner',caseId:world.id},world,p as never);try{const s=fixture.services,a=await s.agentCapabilityEvidence.discover(),current=a.attempts.find(row=>row.notebook===a.notebook&&row.revision===a.revision)!;const e=await s.agentCapabilityEvidence.inspect(current.id);expect(e.notebook.saved).toBe(true);const proof=await fixture.verify({explanation:'The exact current cell failed after saving the reviewed value. It can be reused without a second copy; no new continuation has been performed.',continuation:null});expect(proof.passed,JSON.stringify(proof.checks)).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.continuation).toBeNull();expect(proof.effects.filter(e=>e.service==='agentCapabilityEvidence'&&e.method==='inspect')).toHaveLength(1);}finally{await fixture.close();}
});
