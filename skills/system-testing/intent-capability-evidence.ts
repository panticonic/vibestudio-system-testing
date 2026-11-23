import {isDeepStrictEqual} from "node:util";
/** Join semantic selections to exact native contract values, independent of search route. */
export function selectedCapabilityEvidence(report:{selection:{methodIds:string[]};capabilities:{id:string}[]}|undefined,
 descriptions:ReadonlyMap<string,unknown>):boolean {
 if(!report||!Array.isArray(report.selection?.methodIds)||!Array.isArray(report.capabilities))return false;
 return report.selection.methodIds.every(id=>typeof id==="string"&&report.capabilities.some(value=>value.id===id))&&
 report.capabilities.every(value=>value!==null&&typeof value==="object"&&report.selection.methodIds.includes(value.id)&&isDeepStrictEqual(value,descriptions.get(value.id)));
}
