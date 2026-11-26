import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {observedContentReviewInput}=await import(pathToFileURL(resolve(process.env.VIBE_HOST_SOURCE??process.cwd(),'scripts/lib/observed-content-admission.mjs')).href);
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

it('reads exact retained output through the admitted port without continuation or foreign scope access',async()=>{
 const world=openAgentCapabilityWorlds.find(w=>w.id.endsWith('permit-digest-readable-without-write-grant'))!,p=ports(),fixture=await prepareAgentCapability({contextId:'agent-owner',caseId:world.id},world,p as never);try{
  const s=fixture.services,a=await s.agentCapabilityEvidence.discover(),current=a.attempts.find(row=>row.notebook===a.notebook&&row.revision===a.revision)!,foreign=a.attempts.find(row=>row.notebook!==a.notebook)!;
  await expect(s.agentCapabilityEvidence.readRetainedValues(current.id,'unissued',current.revision)).rejects.toThrow('Inspect');
  const e=await s.agentCapabilityEvidence.inspect(current.id);await s.agentCapabilityEvidence.inspect(foreign.id);
  await expect(s.agentCapabilityEvidence.readRetainedValues(foreign.id,e.resultDigest,foreign.revision)).rejects.toThrow('owned');
  expect(await s.agentCapabilityEvidence.readRetainedValues(current.id,'unissued',e.notebook.revision)).toBeNull();
  expect(await s.agentCapabilityEvidence.readRetainedValues(current.id,e.resultDigest,'another-revision')).toBeNull();
  const values=await s.agentCapabilityEvidence.readRetainedValues(current.id,e.resultDigest,e.notebook.revision);expect(values).not.toBeNull();const output=values!.find(v=>v.key==='ownedLargeResult')!;
  expect(output.content).toContain('🖨');expect(output.content.endsWith('final approved entry')).toBe(true);expect(createHash('sha256').update(output.content).digest('hex')).toBe(output.digest);expect(output.attempt).toEqual(current);expect(output.runId).toBe(e.runId);expect(output.observedAfterContinuation).toBeNull();expect(values!.some(v=>['retainedOwnerNote','retainedWindow','neighborPlan'].includes(v.key))).toBe(false);
  const proof=await fixture.verify({explanation:'The actual retained output belongs to this current action; its exact bytes are included. This read-only review did not continue it.',continuation:null,retainedValues:values});expect(proof.passed,JSON.stringify(proof.checks)).toBe(true);expect(proof.retainedValueReads.some(r=>r.values?.some(v=>v.content===output.content))).toBe(true);expect(proof.continuation).toBeNull();expect(proof.effects.some(r=>r.service==='agentCapabilityContinue')).toBe(false);expect(proof.semanticReviewRequired).toBe(true);
  const forged=structuredClone(values!);forged.find(v=>v.key===output.key)!.content='Invented output';expect((await fixture.verify({explanation:'A claimed value',continuation:null,retainedValues:forged})).checks.authenticReturnedValues).toBe(false);
 }finally{await fixture.close();}
});
it('qualifies value access through the same admitted service and preserves later continuation provenance',async()=>{
 const world=openAgentCapabilityWorlds.find(w=>w.mode==='retry-gate'&&w.task==='retry'&&!w.unready&&!w.amended&&w.approval!=='read-only')??openAgentCapabilityWorlds.find(w=>w.task==='continue'&&w.approval!=='read-only')!,p=ports(),fixture=await prepareAgentCapability({contextId:'agent-owner',caseId:world.id},world,p as never);try{
  const before=await fixture.qualify();expect(before.passed,JSON.stringify(before.checks)).toBe(true);expect(before.checks.referenceRetainedValueAdmission).toBe(true);expect(before.effects.some(e=>e.service==='agentCapabilityEvidence'&&e.method==='readRetainedValues')).toBe(true);
  if(before.continuation){const s=fixture.services,a=before.assignment,current=a.attempts.find(row=>row.notebook===a.notebook&&row.revision===a.revision)!,fresh=await s.agentCapabilityEvidence.inspect(current.id);const values=await s.agentCapabilityEvidence.readRetainedValues(current.id,fresh.resultDigest,fresh.notebook.revision);expect(values).not.toBeNull();expect(values!.every(v=>v.observedAfterContinuation===before.continuation!.runId)).toBe(true);const proof=await fixture.verify({explanation:'The current owned value was read after the actual admitted continuation.',continuation:before.continuation,retainedValues:values});expect(proof.passed,JSON.stringify(proof.checks)).toBe(true);}
 }finally{await fixture.close();}
});
