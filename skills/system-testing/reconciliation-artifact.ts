import {scratchHandoffSourceLines} from '@workspace-skills/scratch-handoff-bindings';
/** Verify any actual structured citation claims; note format, question prose, order and count belong to goal meaning. */
export function authenticReconciliationCitations(text:string,sources:ReadonlyMap<string,string>):boolean {
 let parsed:unknown;
 try{parsed=JSON.parse(text);}catch{return true;}
 if(!parsed||typeof parsed!=='object'||!Array.isArray((parsed as {answers?:unknown}).answers))return true;
 return (parsed as {answers:unknown[]}).answers.every(answer=>{
  if(!answer||typeof answer!=='object'||!Object.hasOwn(answer,'evidence'))return true;
  const claims=(answer as {evidence:unknown}).evidence;
  return Array.isArray(claims)&&claims.every(claim=>{
   if(!claim||typeof claim!=='object')return false;
   const {sourceId,firstLine,lastLine,text:quote}=claim as Record<string,unknown>;
   if(typeof sourceId!=='string'||!sources.has(sourceId)||!Number.isSafeInteger(firstLine)||!Number.isSafeInteger(lastLine)||typeof quote!=='string')return false;
   const lines=scratchHandoffSourceLines(sources.get(sourceId)!);
   return (firstLine as number)>=1&&(lastLine as number)>=(firstLine as number)&&(lastLine as number)<=lines.length&&quote===lines.slice((firstLine as number)-1,lastLine as number).join('\n');
  });
 });
}
