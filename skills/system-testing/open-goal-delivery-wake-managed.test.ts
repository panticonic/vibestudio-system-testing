import { expect, it, vi } from "vitest";
const lifecycle=vi.hoisted(()=>({closeError:null as Error|null}));
vi.mock("@workspace/runtime", () => ({ contextId: "owned", rpc: {}, runtime: {} }));
vi.mock("@workspace/pubsub", () => ({ connectViaRpc(options: any) {
  return { contextId: options.contextId, onError: () => () => {}, close: async () => {if(lifecycle.closeError)throw lifecycle.closeError;},
    async ready() {
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await options.rpc.streamReadable(options.channelTargetId, { name: "subscribe" }, {}); return; }
        catch (error) { if (attempt === 3) throw error; }
      }
    } };
} }));
import { recoverOwnedSubscription } from "./open-goal-delivery-wake-managed.js";
it("retains owned subscription authority across more than two openings", async () => {
  let actual = 0;
  const port: any = { selfId: "client:owned", call: async () => null,
    async streamReadable() {
      if (++actual === 1) throw Object.assign(new Error("native transport reset"), { code: "ECONNRESET" });
      return { status: 200 };
    } };
  const result = await recoverOwnedSubscription(port, "channel", "target", "context", "recover");
  expect(result).toEqual({ channel: "channel", context: "context", attempts: 3,
    firstRejected: true, ready: true, admittedSurfaces: 1 });
});

it("preserves original subscription failure alongside an owned cleanup failure",async()=>{
 const primary=new Error("native subscription unavailable"),cleanup=new Error("owned close rejected");lifecycle.closeError=cleanup;
 try {await expect(recoverOwnedSubscription({selfId:"client:owned",call:async()=>null,streamReadable:async()=>{throw primary;}} as any,"channel","target","context","clean")).rejects.toMatchObject({name:"AggregateError",errors:[{cause:primary},cleanup]});}
 finally{lifecycle.closeError=null;}
});
it("does not invent a subscription failure when only cleanup fails",async()=>{
 const cleanup=new Error("owned close rejected");lifecycle.closeError=cleanup;
 try{await expect(recoverOwnedSubscription({selfId:"client:owned",call:async()=>null,streamReadable:async()=>({status:200})} as any,"channel","target","context","clean")).rejects.toBe(cleanup);}
 finally{lifecycle.closeError=null;}
});
