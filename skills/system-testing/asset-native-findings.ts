/** Mechanical facts from retained native snapshots, independent of reference trajectories. */
export type NativeAssetFile={id:string;path:string;digest:string;mode:number};
export type NativeAssetClaim={key:string;path:string;digest:string;mode:number};
export function nativeAssetFindings(claims:readonly NativeAssetClaim[],approved:readonly NativeAssetFile[],working:readonly NativeAssetFile[]){
 return claims.map(claim=>{
  const retained=approved.find(file=>file.path===claim.path)??null;
  const current=retained?working.find(file=>file.id===retained.id)??null:null;
  const replacement=retained&&!current?working.find(file=>file.path===retained.path)??null:null;
  const differences:string[]=[];
  if(retained){
   if(current){if(current.path!==retained.path)differences.push("moved");if(current.digest!==retained.digest)differences.push("bytes");if(current.mode!==retained.mode)differences.push("mode");}
   else differences.push(replacement?"replaced":"missing");
  }
  if(!retained||retained.digest!==claim.digest||retained.mode!==claim.mode)differences.push("manifest");
  if(!differences.length)differences.push("same");
  return {key:claim.key,retained:retained?.id??null,working:current?.id??replacement?.id??null,differences};
 });
}
