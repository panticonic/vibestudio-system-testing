/** Exact protected copy and field placement, independent of example field prose. */
export function editorialEditScope(before:string,after:string,fields:readonly {label:string;before:string|null;after:string|null}[],literalApprovedWording=false){
 const lines=(text:string)=>text.match(/.*(?:\n|$)/gu)?.filter(Boolean)??[];
 const original=lines(before),candidate=lines(after);
 const named=(line:string,label:string)=>line.startsWith(`- ${label}: `);
 const protectedLines=(all:string[])=>all.filter(line=>!fields.some(field=>named(line,field.label))).join("");
 if(protectedLines(original)!==protectedLines(candidate))return false;
 for(const field of fields){
  const matched=candidate.filter(line=>named(line,field.label));
  if(field.after===null){if(matched.length)return false;continue;}
  if(matched.length!==1)return false;
  const value=matched[0]!.slice(`- ${field.label}: `.length).replace(/\n$/u,"");
  if(!value.trim()||literalApprovedWording&&value!==field.after)return false;
 }
 return true;
}

/** Authority for one private working-copy edit, separate from final requested values. */
export function editorialWriteScope(before:string,after:string,fields:readonly {label:string}[]):boolean {
 const lines=(text:string)=>text.match(/.*(?:\n|$)/gu)?.filter(Boolean)??[];
 const original=lines(before),candidate=lines(after);
 const named=(line:string,label:string)=>line.startsWith(`- ${label}: `);
 const protectedLines=(all:string[])=>all.filter(line=>!fields.some(field=>named(line,field.label))).join("");
 return protectedLines(original)===protectedLines(candidate)&&fields.every(field=>{
  const matched=candidate.filter(line=>named(line,field.label));
  return matched.length<=1&&matched.every(line=>!!line.slice(`- ${field.label}: `.length).trim());
 });
}
