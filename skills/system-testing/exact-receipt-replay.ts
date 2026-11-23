import {isDeepStrictEqual} from "node:util";
/** Replay a completed receipt, never the mutation, for its exact still-authorized request. */
export function exactReceiptReplay<Input,Receipt>() {
 let completed:{input:Input;receipt:Receipt}|undefined;
 let pending:{input:Input;promise:Promise<Receipt>}|undefined;
 return async(input:Input,authorized:()=>Promise<boolean>,perform:()=>Promise<Receipt>):Promise<Receipt>=>{
  const previous=completed??pending;
  if(previous&&!isDeepStrictEqual(previous.input,input))throw new Error("Committed operation belongs to another exact request");
  if(completed){
   if(!await authorized())throw new Error("Original receipt is no longer current or authorized");
   return structuredClone(completed.receipt);
  }
  if(pending)return structuredClone(await pending.promise);
  const original=structuredClone(input);
  const promise=perform().then(receipt=>{
   if(receipt!==null)completed={input:original,receipt:structuredClone(receipt)};
   return receipt;
  });
  pending={input:original,promise};
  try{return await promise;}finally{pending=undefined;}
 };
}
