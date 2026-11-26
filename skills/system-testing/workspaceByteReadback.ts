import{READ_BYTES_MAX_LIMIT}from"@vibestudio/shared/fsReadLimits";
import {mainRpcMethods} from "@vibestudio/service-schemas/mainRpc";
import type {rpc as RuntimeRpc} from "@workspace/runtime";

/** Read a complete Native file through the real bounded-range protocol. No fixture-only artifact ceiling. */
export async function readCompleteWorkspaceBytes(rpc:Pick<typeof RuntimeRpc,"call">,path:string,{maxBytes}:{maxBytes?:number}={}):Promise<Uint8Array>{
 if(maxBytes!==undefined&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError("Explicit file byte bound must be a non-negative safe integer");
 const limit=Math.max(1,Math.min(READ_BYTES_MAX_LIMIT,maxBytes??READ_BYTES_MAX_LIMIT));
 const chunks:Uint8Array[]=[];let offset=0,total:number|undefined,hash:string|undefined;
 for(;;){
  const slice=await rpc.call("main",mainRpcMethods["fs.readBytes"],[path,{offset,limit}]);
  const binary=atob(slice.base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(btoa(binary)!==slice.base64||!Number.isSafeInteger(slice.totalBytes)||slice.totalBytes<0||
    !/^[a-f0-9]{64}$/u.test(slice.contentHash)||slice.start!==offset||slice.end!==offset+bytes.length||
    bytes.length>limit||slice.end>slice.totalBytes||
    (total!==undefined&&(slice.totalBytes!==total||slice.contentHash!==hash))||
    slice.truncated!==(slice.end<slice.totalBytes)||
    (slice.truncated&&(slice.nextOffset!==slice.end||slice.end<=offset)))
   throw new Error("Native file readback changed identity or returned an invalid byte range");
  if(maxBytes!==undefined&&slice.totalBytes>maxBytes)throw new Error("Native file readback exceeds its explicit byte bound");
  total=slice.totalBytes;hash=slice.contentHash;chunks.push(bytes);offset=slice.end;
  if(!slice.truncated)break;
 }
 const result=new Uint8Array(offset);let written=0;for(const chunk of chunks){result.set(chunk,written);written+=chunk.length;}
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",result)),b=>b.toString(16).padStart(2,"0")).join("");
 if(digest!==hash)throw new Error("Native file readback bytes do not match the complete content hash");
 return result;
}
