import {isDeepStrictEqual} from "node:util";
/** Discovery claims must be native observations; their call route is not an outcome. */
export function authenticDiscoveryEvidence(search:{queries:string[];hits:unknown[];described:{id:string}[]}|undefined,
 observations:readonly {query:string;hits:unknown}[],descriptions:ReadonlyMap<string,unknown>):boolean {
 if(!search||!Array.isArray(search.queries)||!Array.isArray(search.hits)||search.queries.length!==search.hits.length||!Array.isArray(search.described))return false;
 return search.queries.every((query,index)=>observations.some(row=>row.query===query&&isDeepStrictEqual(row.hits,search.hits[index])))&&
 search.described.every(value=>value!==null&&typeof value==="object"&&isDeepStrictEqual(value,descriptions.get(value.id)));
}
