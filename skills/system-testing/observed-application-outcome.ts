import {isDeepStrictEqual} from "node:util";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {assessSemanticOutcome,type SemanticOutcomeContract} from "./semantic-outcome-contract.js";
import type {InvocationObservations,ObservedCall,ObservedReturn} from "./observed-invocation.js";
export type ReturnPath=readonly (string|number)[];
/** Authored against the actual domain composition, never a fabricated returned definition. */
export type ApplicationReturnContribution={checks:readonly string[];rootPath:ReturnPath;producerSourceSuffix:string;producerPath?:ReturnPath};
export type ApplicationReturnWitness={schema:"natlang.application-return-contribution/1";kind:"root"|"forwarded"|"projection"|"uncertain-projection";root_call_id:string;producer_call_id:string;root_value_json:string;root_sha256:string;root_path:ReturnPath;producer_path:ReturnPath;checks:readonly string[];lineage:readonly string[];producer_source_suffix?:string;candidates?:readonly {call_id:string;value_json:string;sha256:string}[];uncertainty?:"ambiguous-actual-producer"|"no-verified-actual-producer"};
function project(value:unknown,path:ReturnPath):{found:boolean;value:unknown}{
 let current=value;
 for(const key of path){
  if(Array.isArray(current)){if(typeof key!=="number"||!Number.isSafeInteger(key)||key<0||key>=current.length)return {found:false,value:undefined};current=current[key];}
  else{if(!current||typeof current!=="object"||typeof key!=="string"||!Object.hasOwn(current,key))return {found:false,value:undefined};current=(current as Record<string,unknown>)[key];}
 }
 return {found:true,value:current};
}
function sampled(call:ObservedCall){return (call.execution?.kind==="agent"||call.execution?.kind==="crisp-agent")&&!!call.execution.modelId&&call.execution.modelRequests>0&&typeof call.definition.source==="string"&&call.definition.source.endsWith(".nl");}
/** Native observations establish effects; only actual source-bound return producers are masked. */
export async function assessObservedApplicationOutcome<T extends {passed:boolean;checks:Record<string,boolean>}>(
 verification:T,contract:SemanticOutcomeContract,actualValue:unknown,invocation?:InvocationObservations,
 contributions:readonly ApplicationReturnContribution[]=[],
){
 const failed=[...contract.returnedValue.checks,...contract.incidentalValues?.checks??[]].filter(name=>verification.checks[name]!==true);
 const required=(checks:readonly string[])=>contract.returnedValue.required&&checks.some(name=>contract.returnedValue.checks.includes(name));
 const incorrectReturnValues:{definition:{name:string;source:string};value:unknown;valueJson:string;required:boolean;contribution:ApplicationReturnWitness}[]=[];
 const unboundReturnContributions:{checks:readonly string[];reason:string}[]=[];
 if(failed.length&&invocation){
  const calls=new Map(invocation.calls.map(call=>[call.callId,call]));
  const roots=await invocation.returns(call=>call.parentCallId===null);
  const root=roots.length===1&&isDeepStrictEqual(roots[0]!.value,actualValue)?roots[0]:undefined;
  if(root){
   const values=new Map<string,ObservedReturn>([[root.callId,root]]);
   const read=async(call:ObservedCall)=>{if(!values.has(call.callId)){const rows=await invocation.returns(row=>row.callId===call.callId);if(rows[0])values.set(call.callId,rows[0]);}return values.get(call.callId);};
   const lineage=(producer:ObservedCall):ObservedCall[]|null=>{
    const chain:ObservedCall[]=[];let current:ObservedCall|undefined=producer;
    while(current){chain.unshift(current);if(current.callId===root.callId)return chain;current=current.parentCallId?calls.get(current.parentCallId):undefined;}
    return null;
   };
   const add=(producer:ObservedReturn,kind:ApplicationReturnWitness["kind"],checks:readonly string[],rootPath:ReturnPath=[],producerPath:ReturnPath=[],chain:readonly ObservedCall[]=[root],extra:Partial<Pick<ApplicationReturnWitness,"producer_source_suffix"|"candidates"|"uncertainty">>={})=>{
    const contribution:ApplicationReturnWitness={schema:"natlang.application-return-contribution/1",kind,root_call_id:root.callId,producer_call_id:producer.callId,root_value_json:root.valueJson,root_sha256:sha256HexSyncText(root.valueJson),root_path:rootPath,producer_path:producerPath,checks,lineage:chain.map(call=>call.callId),...extra};
    const previous=incorrectReturnValues.find(row=>row.contribution.producer_call_id===producer.callId);
    if(previous){previous.required ||= required(checks);return;}
    incorrectReturnValues.push({definition:producer.definition,value:producer.value,valueJson:producer.valueJson,required:required(checks),contribution});
   };
   add(root,"root",failed);
   // One child at every crisp step is a genuine unambiguous forwarding chain;
   // equal values in siblings or other branches are never an implicit witness.
   let current=root;
   while(current.execution?.kind==="crisp"){
    const children=invocation.calls.filter(call=>call.parentCallId===current.callId);
    if(children.length!==1||children[0]!.outcome!=="done")break;
    const child=await read(children[0]!);
    if(!child||child.valueJson!==current.valueJson)break;
    if(sampled(child)){add(child,"forwarded",failed,[],[],lineage(child)!);break;}
    current=child;
   }
   for(const binding of contributions){
    const checks=binding.checks.filter(name=>failed.includes(name));if(!checks.length)continue;
    const rootPart=project(root.value,binding.rootPath),candidates:ObservedReturn[]=[],eligible:ObservedReturn[]=[];
    for(const call of invocation.calls){
     if(call.callId===root.callId||call.outcome!=="done"||!sampled(call)||typeof call.definition.source!=="string"||!call.definition.source.endsWith(binding.producerSourceSuffix))continue;
     const chain=lineage(call);if(!chain||chain.slice(0,-1).some(owner=>owner.execution?.kind!=="crisp"))continue;
     const producer=await read(call);if(!producer)continue;eligible.push(producer);
     const part=project(producer.value,binding.producerPath??[]);
     if(rootPart.found&&part.found&&isDeepStrictEqual(rootPart.value,part.value))candidates.push(producer);
    }
    const extra={producer_source_suffix:binding.producerSourceSuffix,candidates:eligible.map(row=>({call_id:row.callId,value_json:row.valueJson,sha256:sha256HexSyncText(row.valueJson)}))};
    if(candidates.length===1)add(candidates[0]!,"projection",checks,binding.rootPath,binding.producerPath??[],lineage(candidates[0]!)!,extra);
    else{
     const reason=candidates.length?"ambiguous-actual-producer":"no-verified-actual-producer";
     unboundReturnContributions.push({checks,reason});
     for(const producer of candidates.length?candidates:eligible)add(producer,"uncertain-projection",checks,binding.rootPath,binding.producerPath??[],lineage(producer)!,{...extra,uncertainty:reason});
    }
   }
  }else unboundReturnContributions.push({checks:failed,reason:"application-value-does-not-match-recorded-root"});
 }
 return assessSemanticOutcome({...verification,incorrectReturnValues,unboundReturnContributions},contract);
}
