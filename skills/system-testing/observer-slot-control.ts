import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {observeInvocation} from "@workspace/application-outcomes/observed-invocation";
/** Synthetic transport metadata for native qualification only: never an attested application execution. */
export function referenceObserver(value:unknown) {
 const text=JSON.stringify(value),hash=sha256HexSyncText(text),id="observer-slot-control";
 return observeInvocation({evalRunId:id,rootCallIds:[id],captureErrors:[],calls:[{callId:id,summary:{run_id:id,owner_key:id,owner_kind:"qualification-control"},record:{call_id:id,parent_call_id:null,definition:{name:id,source:"qualification://observer-slot-control"},outcome:"done",output:{complete:true,hash}}}]},async reference=>reference===hash?text:null);
}
