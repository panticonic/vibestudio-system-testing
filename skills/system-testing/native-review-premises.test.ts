/** TEST-only immutable actual Source48 native evidence. No replayed model calls,
 * registry registration, revised raw packets or synthetic passed observations. */
import {expect,it,vi} from "vitest";
vi.mock("@workspace/runtime",()=>({contextId:"owned",rpc:{},fs:{}}));
import * as installedModule from "./open-goal-installed-package-managed.js";
import * as releaseModule from "./open-goal-system-release-managed.js";
import {readFileSync} from "node:fs";
import {URL as NodeURL} from "node:url";
import {createHash} from "node:crypto";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
import {installedPackageGoalContract,systemReleaseGoalContract} from "./open-goal-review-contracts.js";
import {systemReleaseHandoffProtocol} from "./system-release-handoff-protocol.js";
import {openInstalledPackageWorlds} from "./open-goal-installed-package-worlds.js";
import {openSystemReleaseWorlds} from "./open-goal-system-release-worlds.js";
const packets=JSON.parse(readFileSync(new NodeURL('./testdata/source48-native-review-packets.json',import.meta.url),'utf8'));
const originalPackage=packets[0],originalRelease=packets[1];
function nativeProof(row:typeof originalPackage){return {...row.nativeProof,passed:true,checks:structuredClone(row.nativeProof.observedChecks??row.nativeProof.checks)};}
/** Independent TEST-only negative output, never relabeled as the original capture. */
function negativeOutput(proof:ReturnType<typeof nativeProof>,checks:Record<string,boolean>){return {goal:proof.goal,passed:false,checks};}
it('keeps pre-action authority and post-action revision changes as distinct actual observations',async()=>{
 const row=originalPackage,proof=nativeProof(row),world=openInstalledPackageWorlds.find(w=>row.case.endsWith(w.id))!;
 expect(world.requestedReturnRequired).toBe(true);expect(proof.observed.scopeMatches).toBe(true);expect(proof.repair.status).toBe('restored');expect(proof.repair.observation.scopeMatches).toBe(false);expect(proof.repair.observation.workingDigest).not.toBe(proof.observed.workingDigest);
 expect(row.actualResult.verification.plan.suite).toBe('native');expect(row.actualResult.verification.execution).toBeNull();
 const check=bindObservedContentReview(['effects','assignment','observed','repair','plan']);
 const result=await check(proof,installedPackageGoalContract(world),row.actualResult);
 expect(result.passed).toBe(true);expect(result.semanticReviewRequired).toBe(true);expect(result.semanticReviewInput.actual.requestedReturn).toEqual(row.actualResult);expect(result.semanticReviewInput.expected.observations.observed.scopeMatches).toBe(true);expect(result.semanticReviewInput.expected.observations.repair.observation.scopeMatches).toBe(false);
 expect(result.semanticReviewInput.rubric).toContain('actual action boundary');expect(result.semanticReviewInput.rubric).toContain('does not authorize another action');
 const missing=await check(negativeOutput(proof,{...proof.checks,returnedPackageFinding:false}),installedPackageGoalContract(world),undefined);expect(missing.passed).toBe(false);
 const unauthorized=await check(negativeOutput(proof,{...proof.checks,verifiedLocalManifestEffect:false}),installedPackageGoalContract(world),row.actualResult);expect(unauthorized.passed).toBe(false);
});
it('effect-only package requests do not acquire an unrequested answer or native receipt echo requirement',async()=>{
 const proof=nativeProof(originalPackage),world=openInstalledPackageWorlds.find(w=>!w.requestedReturnRequired)!;
 const result=await bindObservedContentReview(['observed','repair'])(negativeOutput(proof,{...proof.checks,returnedPackageFinding:false,returnedPackageRepair:false,returnedPackageVerification:false}),installedPackageGoalContract(world),undefined);
 expect(result.passed).toBe(true);expect(result.semanticReviewRequired).toBe(true);expect(result.semanticReviewInput.actual.requestedReturn).toBeNull();
});
it('binds the actual structured private diagnostic, exact receipt and scoped storage without claiming team transmission',async()=>{
 const proof=nativeProof(originalRelease),world=openSystemReleaseWorlds.find(w=>originalRelease.case.endsWith(w.id))!;
 expect(world.requestedReturnRequired).toBe(false);expect(proof.handoffText).toContain('DELIVERY_LATENCY');expect(proof.handoffText).toContain('Terminal acknowledgment exceeded its retained delivery budget.');
 const protocol=systemReleaseHandoffProtocol({contextId:proof.contextId,verifiedPrivateHandoff:proof.checks.verifiedPrivateHandoff,receipt:proof.handoff,text:proof.handoffText});
 expect(protocol).toMatchObject({contextId:proof.contextId,storage:'context-scoped-scratch',externalTransmission:false,bytes:1124,sha256:proof.handoff.sha256});
 const result=await bindObservedContentReview(['assignment','runs','cases','effects','handoffProtocol'],['handoff','handoffText'])({...proof,handoffProtocol:protocol},systemReleaseGoalContract(world),undefined);
 expect(result.passed).toBe(true);expect(result.semanticReviewRequired).toBe(true);expect(result.semanticReviewInput.actual.requestedReturn).toBeNull();expect(result.semanticReviewInput.actual.artifacts.handoffText).toBe(proof.handoffText);expect(result.semanticReviewInput.expected.observations.handoffProtocol.externalTransmission).toBe(false);expect(result.semanticReviewInput.rubric).toContain('structured diagnostic JSON');
 const missing=await bindObservedContentReview(['cases'],['handoffText'])(negativeOutput(proof,{...proof.checks,verifiedPrivateHandoff:false}),systemReleaseGoalContract(world),undefined);expect(missing.passed).toBe(false);
});
it('does not invent private custody for missing, forged, cross-context or non-scratch artifacts',()=>{
 const p=originalRelease.nativeProof,valid={contextId:p.contextId,verifiedPrivateHandoff:true,receipt:p.handoff,text:p.handoffText};expect(systemReleaseHandoffProtocol(valid)).not.toBeNull();
 for(const bad of [{...valid,verifiedPrivateHandoff:false},{...valid,text:null},{...valid,receipt:null},{...valid,contextId:'foreign-context'},{...valid,text:valid.text+' '},{...valid,receipt:{...valid.receipt,bytes:valid.receipt.bytes+1}},{...valid,receipt:{...valid.receipt,path:'/public/diagnosis.json'}},{...valid,receipt:{...valid.receipt,path:'/.tmp/../public/diagnosis.json'}}])expect(systemReleaseHandoffProtocol(bad)).toBeNull();
});
it('all56 literal identities and independently audited return obligations are preserved',()=>{
 const rows=JSON.parse(readFileSync(new NodeURL('../../meta/NATIVE_REVIEW_GOAL_OBLIGATIONS.json',import.meta.url),'utf8'));const worlds=[...openInstalledPackageWorlds,...openSystemReleaseWorlds];expect(worlds).toHaveLength(56);expect(rows).toHaveLength(56);
 for(const w of worlds){const row=rows.find((r:{id:string})=>r.id===w.id);expect(row).toBeDefined();expect(w.goal).toBe(row.goal);expect(createHash('sha256').update(w.goal).digest('hex')).toBe(row.goalSha256);expect(w.sourceGroup).toBe(row.sourceGroup);expect(w.split??'train').toBe(row.split);expect(w.requestedReturnRequired).toBe(row.requestedReturnRequired);}
 expect(openInstalledPackageWorlds.filter(w=>w.requestedReturnRequired)).toHaveLength(20);expect(openSystemReleaseWorlds.filter(w=>w.requestedReturnRequired)).toHaveLength(15);
});

it('refuses changing an immutable capture observation under the guise of a projection',async()=>{
 const proof=nativeProof(originalPackage);await expect(bindObservedContentReview(['observed'])({...proof,checks:{...proof.checks,verifiedLocalManifestEffect:false}},installedPackageGoalContract({requestedReturnRequired:true}),originalPackage.actualResult)).rejects.toThrow('preserve its original observations');
});

it('loads both actual native factory modules with their shared source-owned contracts',()=>{expect(typeof installedModule.prepareInstalledPackage).toBe('function');expect(typeof releaseModule.prepareSystemRelease).toBe('function');});
