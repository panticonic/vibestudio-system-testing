import {it,expect} from "vitest";
import {exactReceiptReplay} from "./exact-receipt-replay.js";
it("recovers the exact native receipt after a caller loses the committed response without repeating an effect",async()=>{
 const run=exactReceiptReplay<{id:string;body:string},{path:string;hash:string}>();let writes=0,authorized=true;
 const request={id:"owned",body:"original"},receipt={path:"owned-note",hash:"native"};
 const perform=async()=>{writes++;return receipt;};
 await expect((async()=>{await run(request,async()=>authorized,perform);throw Error("caller lost response");})()).rejects.toThrow("lost response");
 expect(await run(request,async()=>authorized,perform)).toEqual(receipt);expect(writes).toBe(1);
 await expect(run({...request,id:"foreign"},async()=>true,perform)).rejects.toThrow(/another exact request/);
 await expect(run({...request,body:"changed"},async()=>true,perform)).rejects.toThrow(/another exact request/);
 authorized=false;await expect(run(request,async()=>authorized,perform)).rejects.toThrow(/no longer current/);expect(writes).toBe(1);
});
it("coalesces concurrent exact requests and does not memorize failures or unavailable results",async()=>{
 const run=exactReceiptReplay<string,string|null>();let writes=0;
 let finish!:(value:string)=>void;const pending=new Promise<string>(resolve=>{finish=resolve;});
 const first=run("owned",async()=>true,async()=>{writes++;return pending;});
 const second=run("owned",async()=>true,async()=>{writes++;return "duplicate";});finish("actual");
 expect(await Promise.all([first,second])).toEqual(["actual","actual"]);expect(writes).toBe(1);
 const retry=exactReceiptReplay<string,string|null>();
 await expect(retry("owned",async()=>true,async()=>{throw Error("pre-commit");})).rejects.toThrow("pre-commit");
 expect(await retry("owned",async()=>true,async()=>null)).toBeNull();
 expect(await retry("owned",async()=>true,async()=>"actual")).toBe("actual");
});
