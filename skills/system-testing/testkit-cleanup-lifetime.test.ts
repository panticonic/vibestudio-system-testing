import { beforeEach, expect, it, vi } from "vitest";
const live = vi.hoisted(() => ({ files: new Map<string,string>(), panel: false, session: false, events: [] as string[], count: 0 }));
vi.mock("@workspace/runtime", () => ({
  contextId: "owned-context", rpc: {}, panelTree: { path: async () => live.panel ? ["panel"] : null },
  fs: {
    mkdtemp: async () => "scratch-" + ++live.count,
    writeFile: async (p:string,v:string) => { live.files.set(p,v); },
    readFile: async (p:string) => live.files.get(p),
    exists: async (p:string) => [...live.files.keys()].some(key=>key===p||key.startsWith(p+"/")),
    rm: async (p:string) => { for (const key of live.files.keys()) if(key===p||key.startsWith(p+"/"))live.files.delete(key); },
  },
}));
vi.mock("@workspace/testkit", async () => {
  const run = await import("@workspace/testkit/run");
  const assertion = await import("@workspace/testkit/expect");
  return { ...run, ...assertion, openPanel: async () => {
    await new Promise(resolve=>setTimeout(resolve,5));
    live.panel = true;
    return { id: "editor", archive: async () => { live.events.push("panel-archive"); live.panel=false; }, cdp: { session: async () => {
      live.session = true;
      return { page: { isClosed: () => !live.session, close: async()=> { throw new Error("Must close session, not native target"); } }, close: async()=> {live.events.push("session-close");live.session=false;} };
    } } };
  } };
});
import { exerciseTestkitCleanup } from "./testkit-cleanup-managed";
beforeEach(()=> { live.files.clear();live.panel=false;live.session=false;live.events=[];live.count=0; });
it("joins native session release before archiving its panel after an assertion", async () => {
  const result = await exerciseTestkitCleanup("assertion-panel-page");
  expect(result.outcome).toBe("failed");
  expect(result.remaining).toEqual([]);
  expect(result.release.released.map(x=>x.kind)).toEqual(["scratch","page-client","panel"]);
  expect(live.events).toEqual(["session-close","panel-archive"]);
});
