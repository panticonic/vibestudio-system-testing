import type {SourceAttributionConclusion,SourceAttributionEvidence,SourceAttributionFile} from "@workspace-skills/open-user-goal/reviewSourceAttribution/types";

/** Validate actual native source/trace frames, independently of a reference route. */
export function groundedSourceEvidence(files:readonly SourceAttributionFile[],evidence:readonly SourceAttributionEvidence[]):boolean {
 return evidence.every(item=>{
  const file=files.find(file=>file.candidate.id===item.selected.candidate);
  const fragment=file?.fragments.find(fragment=>fragment.id===item.selected.fragment);
  if(!file||!fragment||item.trace.file!==file.file||item.trace.state!==file.state||item.trace.fragment!==fragment.id)return false;
  const spans=item.trace.spans;
  if(spans.some((span,index)=>span.start<fragment.start||span.end>fragment.end||span.end<span.start||index>0&&span.start<spans[index-1]!.end))return false;
  if(!item.trace.truncated&&spans.length>0&&(spans[0]!.start!==fragment.start||spans.at(-1)!.end!==fragment.end||spans.some((span,index)=>index>0&&span.start!==spans[index-1]!.end)))return false;
  const refs=new Set(spans.flatMap(span=>[span.work,span.command].filter((ref):ref is string=>ref!==null)));
  return item.roots.every(root=>refs.has(root.ref));
 });
}

/** Claim references and boundary identity are crisp; requested meaning is reviewed. */
export function groundedSourceConclusion(value:unknown,evidence:readonly SourceAttributionEvidence[]):value is SourceAttributionConclusion {
 if(value===null||typeof value!=="object")return false;
 const conclusion=value as SourceAttributionConclusion;
 if(typeof conclusion.explanation!=="string"||!conclusion.explanation.trim()||!["supported","partial","unverifiable"].includes(conclusion.disposition)||!Array.isArray(conclusion.claims))return false;
 return conclusion.claims.every(claim=>{
  if(!claim||typeof claim!=="object"||!Array.isArray(claim.refs)||!claim.refs.length||!(claim.intent===null||typeof claim.intent==="string"))return false;
  return evidence.some(item=>{
   const span=item.trace.spans.find(span=>span.id===claim.span);
   if(!span||claim.fragment!==item.selected.fragment||claim.origin!==(span.boundary==="authored"?"native":"external"))return false;
   const allowed=new Set([span.work,span.command].filter((ref):ref is string=>ref!==null));
   return claim.refs.every(ref=>typeof ref==="string"&&allowed.has(ref)&&item.roots.some(root=>root.ref===ref));
  });
 });
}
