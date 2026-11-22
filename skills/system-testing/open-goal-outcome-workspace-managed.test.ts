import { mkdtemp, readFile, readdir, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { prepareOutcomeWorkspace } from "./open-goal-outcome-workspace-managed.js";
import { outcomeWorkspaceWorlds } from "./open-goal-outcome-workspace-worlds.js";
import { assessSemanticOutcome } from "./semantic-outcome-contract.js";
vi.mock("@workspace/runtime", () => ({contextId:"owned-context",rpc:{call:vi.fn()},fs:{readFile,readdir,rm,writeFile,
  mkdtemp:(prefix:string)=>mkdtemp(join(tmpdir(),prefix)),
  exists:async(path:string)=>{try{await access(path);return true;}catch{return false;}},
}}));
it("requires the requested native answer and grounded current evidence", async () => {
  const world=outcomeWorkspaceWorlds.find(row=>row.target===null)!;
  const prepared=await prepareOutcomeWorkspace({contextId:"owned-context",caseId:world.id},world);
  try {
    const source=await prepared.services.goalWorkspace.read(world.authority);
    const answer={answer:`Doors open at ${world.doors}.`,citations:[{path:world.authority,version:source!.version,quote:source!.text}],unresolved:[]};
    expect(assessSemanticOutcome(await prepared.verify(answer)).passed).toBe(true);
    expect(assessSemanticOutcome(await prepared.verify({...answer,citations:[{...answer.citations[0],version:"invented"}]})).passed).toBe(false);
    expect(assessSemanticOutcome(await prepared.verify(null)).passed).toBe(false);
  } finally {await prepared.close();}
});
it("proves a requested document effect independently of an incidental return receipt", async () => {
  const world=outcomeWorkspaceWorlds.find(row=>row.target!==null&&!row.concurrentAddition)!;
  const prepared=await prepareOutcomeWorkspace({contextId:"owned-context",caseId:world.id},world);
  try {
    await prepared.services.goalWorkspace.read(world.authority);
    const original=await prepared.services.goalWorkspace.read(world.target!);
    const desired=original!.text.replace("10:00",world.doors);
    await prepared.services.goalWorkspace.revise(world.target!,original!.version,desired);
    const result=assessSemanticOutcome(await prepared.verify(null));
    expect(result.passed).toBe(true);
    expect(result.outcomeDimensions.returnedValue).toMatchObject({required:false,passed:false});
  } finally {await prepared.close();}
});
