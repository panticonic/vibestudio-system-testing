import {expect,it,vi} from "vitest";
import {createScopedProjectDraft} from "./scoped-project-draft.js";
function fixture(){
 const scope={initialHead:"initial",prepared:false,written:false,committed:false};let head="initial";
 const snapshot=()=>({head,contextId:"private",repoPath:"projects/owned",repositoryId:"repo",mainEventId:"main",committedEventId:"private-before",clean:false,files:[]});
 const project={observe:vi.fn(async()=>snapshot()),prepare:vi.fn(async()=>{head="prepared";return snapshot();}),writeDocuments:vi.fn(async()=>{head+="+repair";return snapshot();})};
 const currentSources=vi.fn(async()=>true);
 const access=createScopedProjectDraft({requireScope:receipt=>{if(receipt!=="owned")throw Error("foreign receipt");return {scope,project} as never;},currentSources,
  onCurrentBasis:async(given,op)=>given===head?op():null,record:(_service,_method,_args,result)=>result});
 return {scope,project,access,currentSources};
}
it("reuses preparation readback and repairs the same private project with exact current heads",async()=>{
 const x=fixture(),first=await x.access.prepare("owned","initial");expect(first?.clean).toBe(false);
 const written=await x.access.write("owned",first!.head,[{path:"README.md",text:"Working edition"}]);
 expect(await x.access.prepare("owned","initial")).toEqual(written);expect(x.project.prepare).toHaveBeenCalledTimes(1);
 expect(await x.access.write("owned",first!.head,[])).toBeNull();
 const observed=await x.access.observe("owned");expect(observed).toEqual(written);
 expect(await x.access.write("owned",observed!.head,[{path:"README.md",text:"Reviewed correction"}])).not.toBeNull();
 expect(x.project.writeDocuments).toHaveBeenCalledTimes(2);
});
it("refuses foreign receipts, changed source authority and writes after local commit",async()=>{
 const x=fixture();await expect(x.access.prepare("foreign","initial")).rejects.toThrow("foreign receipt");
 x.currentSources.mockResolvedValue(false);expect(await x.access.prepare("owned","initial")).toBeNull();expect(x.project.prepare).not.toHaveBeenCalled();
 x.currentSources.mockResolvedValue(true);const prepared=await x.access.prepare("owned","initial");
 x.currentSources.mockResolvedValue(false);expect(await x.access.write("owned",prepared!.head,[])).toBeNull();expect(x.project.writeDocuments).not.toHaveBeenCalled();
 x.scope.committed=true;expect(await x.access.observe("owned")).not.toBeNull();await expect(x.access.write("owned",prepared!.head,[])).rejects.toThrow("before its local commit");
});
