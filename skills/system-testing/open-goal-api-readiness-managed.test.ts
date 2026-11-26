import { expect, it, vi } from "vitest";
import { matchUrlBoundCredentialCandidates, findCredentialBinding } from "@vibestudio/credential-client/urlBoundSelection";
import { findMatchingUrlAudience } from "@vibestudio/credential-client/urlAudience";
import { credentialLifecycle } from "@vibestudio/credential-client/credentialStatus";
import {openApiReadinessWorlds} from "./open-goal-api-readiness-worlds.js";
import { prepareOpenApiReadiness } from "./open-goal-api-readiness-managed.js";
vi.mock("./session-replay-managed.js",()=>({createOwnedHeadlessChannel:vi.fn(),withOwnedChannelClient:vi.fn()}));
vi.mock("./scratch-handoff-managed.js",()=>({readWorkspaceBytes:vi.fn()}));
vi.mock("@workspace/runtime", () => ({ contextId: null, fs: {}, rpc: {}, vcs: {}, credentials: {} }));
vi.mock("@workspace-skills/scratch-handoff-bindings", () => ({ bindScratchHandoff: (fs:{writeFile(path:string,text:string):Promise<void>}) => ({ scratchHandoffWrite: { stage: async (text:string) => {const path="/.tmp/evidence-handoff-proof/handoff.json";await fs.writeFile(path,text);return {path,bytes:new TextEncoder().encode(text).length};} } }) }));
async function prepare(caseId: string) {
  const rows: { messageId: string; envelopeId: string; seq: number; selection: unknown }[] = [];
  const saved=new Map<string,string>();
  const prepared=await prepareOpenApiReadiness({ contextId: "owned", caseId }, {
    match: matchUrlBoundCredentialCandidates, binding: findCredentialBinding,
    audience: findMatchingUrlAudience, lifecycle: credentialLifecycle,
  }, {
    contextId: "owned", fs: { mkdtemp: async () => "/scratch", writeFile: async (path:string,text:string) => {saved.set(path,text);}, readdir: async () => saved.has("/.tmp/evidence-handoff-proof/handoff.json")?["evidence-handoff-proof"]:[] },
    status: async () => ({ mainEventId: "unchanged", workingHead: { kind: "event", eventId: "unchanged" } }),
    open: async () => ({ key: "channel" }),
    append: async (_lane: unknown, _context: string, additions: unknown[]) => additions.map(selection => {
      const seq = rows.length + 1, messageId = `message-${seq}`;
      rows.push({ messageId, envelopeId: `envelope-${seq}`, seq, selection }); return messageId;
    }),
    read: async () => ({ channelId: "channel", through: rows.length, rows: structuredClone(rows) }),
    readBytes: async (path:string) => {const text=saved.get(path);if(text===undefined)throw new Error("No scratch artifact was requested");return new TextEncoder().encode(text);},
  } as never);
  return {...prepared,readArtifact:()=>JSON.parse(saved.get("/.tmp/evidence-handoff-proof/handoff.json")??"null")};
}
async function open(caseId: string, count = 2) {
  const prepared = await prepare(caseId), s = prepared.services;
  const index = await s.quietIntegrationIndex.list(), profile = index.profiles[0]!;
  let frontier: Awaited<ReturnType<typeof s.quietIntegrationJournal.read>> = null;
  for(let i=0;i<count;i++)frontier=(await s.quietIntegrationJournal.read(index.scope.channelId))!;
  if(!frontier)throw new Error("Observe an actual native frontier");
  const request = (await s.quietIntegrationProtocol.open(profile.id, frontier.rows[0]!.messageId))!;
  const plan = await s.integrationPlanRead.observe(request.operationId);
  return { prepared, s, index, profile, frontier, request, plan };
}
it.each([1,2,4])("accepts %i frontier reads and reordered repeated integration observations, rejecting invented native state", async count => {
  const { prepared, s, index, profile, frontier, request, plan } = await open("api-readiness-api-versus-git-read",count);
  expect(await s.quietIntegrationProtocol.open(profile.id, frontier.rows[0]!.messageId)).toEqual(request);
  expect(await s.integrationPlanRead.observe(request.operationId)).toEqual(plan);
  const metadata = await s.integrationCredentialLookup.resolve(plan.receipt, "meta");
  expect(await s.integrationCredentialLookup.resolve(plan.receipt, "meta")).toEqual(metadata);
  const clone = await s.integrationCredentialLookup.resolve(plan.receipt, "clone");
  const audit = await s.quietIntegrationProtocol.audit(request.operationId);
  expect(await s.quietIntegrationProtocol.audit(request.operationId)).toEqual(audit);
  const outcome = { plan: { profileId: profile.id, channelId: index.scope.channelId, through: frontier.through,
    message: frontier.rows[0]!.messageId, reason: "ready", action: "report", providerAccess: "unobserved",
    explanation: "The Git binding is current; optional HTTP metadata has no matching binding." },
    review: { request, result: { planReceipt: plan.receipt, status: "ready", guidance: null, held: [], destinations: [
      { observation: metadata, disposition: "setup-needed" }, { observation: clone, disposition: "ready" },
    ] } }, audit, handoff: null };
  const check = (value: typeof outcome) => prepared.verify({plan:value.plan,review:value.review.result,facts:value.audit?.facts??[],handoff:value.handoff});
  expect((await check(outcome)).checks).toEqual(Object.fromEntries(Object.keys((await check(outcome)).checks).map(key => [key, true])));
  expect((await check(outcome)).passed).toBe(true);
  const invented = structuredClone(outcome); invented.review.result.destinations[0]!.observation.state = "active";
  const rejected=await check(invented);expect(rejected.outcomeDimensions.incidentalValues.checks.returnedQuietIntegration).toBe(false);expect(rejected.semanticReviewRequired).toBe(true);expect(rejected.outcomeDimensions.effects.passed).toBe(true);
});
it("retains explicit user observation prerequisites and the sealed receipt", async () => {
  const { s, plan } = await open("api-readiness-optional-miss-continue-scope");
  await expect(s.integrationCredentialLookup.resolve(plan.receipt, "metrics")).rejects.toThrow(/user-requested prerequisite/);
  await s.integrationCredentialLookup.resolve(plan.receipt, "status");
  expect((await s.integrationCredentialLookup.resolve(plan.receipt, "metrics")).state).toBe("active");
  await expect(s.integrationCredentialLookup.resolve("foreign", "metrics")).rejects.toThrow(/assigned integration plan/);
});

it("binds actual saved prose independently of the returned answer for meaning review",async()=>{
  const good=await prepare("api-readiness-authentic-label-selection");
  const reference=await good.qualify();
  expect(reference.checks).toEqual(Object.fromEntries(Object.keys(reference.checks).map(name=>[name,true])));
  expect(reference.passed).toBe(true);
  const saved=good.readArtifact();
  const native=await good.verify({plan:{...saved.plan,explanation:"An unsupported later return."},review:saved.review.result,facts:saved.audit.facts,handoff:null});
  expect(native.outcomeDimensions.effects.passed).toBe(true);
  expect(native.semanticReviewRequired).toBe(true);
  expect(native.semanticReviewInput.actual.requestedReturn).toMatchObject({plan:{explanation:"An unsupported later return."}});
  expect(JSON.parse(String(native.semanticReviewInput.actual.artifacts.artifact)).plan.explanation).toBe(saved.plan.explanation);
  const bad=await prepare("api-readiness-authentic-label-selection"),stage=bad.services.quietIntegrationHandoff.stage;
  bad.services.quietIntegrationHandoff.stage=report=>stage({...report,plan:{...report.plan,explanation:"An unsupported persisted summary."}});
  const rejected=await bad.qualify();
  expect(rejected.outcomeDimensions.effects.passed).toBe(true);
  expect(rejected.semanticReviewRequired).toBe(true);
  expect(JSON.parse(String(rejected.semanticReviewInput.actual.artifacts.artifact)).plan.explanation).toBe("An unsupported persisted summary.");
  expect(rejected.semanticReviewInput.actual.requestedReturn).not.toMatchObject({plan:{explanation:"An unsupported persisted summary."}});
  expect(rejected.outcomeDimensions.returnedValue.passed).toBe(true);
});

it.each(openApiReadinessWorlds)("$id retains actual selection/credential/artifact authority with mandatory meaning review",async world=>{
 const fixture=await prepare(world.id);const proof=await fixture.qualify();expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.outcomeDimensions.returnedValue.required).toBe(world.requestedReturnRequired);
});
it("accepts the original copied-selection answer without a golden enum/profile echo",async()=>{
 const fixture=await prepare("api-readiness-copied-selection-plan"),s=fixture.services,index=await s.quietIntegrationIndex.list();const frame=await s.quietIntegrationJournal.read(index.scope.channelId);const value={plan:{profileId:null,channelId:index.scope.channelId,through:frame!.through,message:null,action:"hold",reason:"unavailable-plan",providerAccess:"unobserved",explanation:"Only a copied message claims the staffing profile was selected; it is not a trusted owner selection. No readiness data was read."},review:null,facts:[],handoff:null};
 const proof=await fixture.verify(value);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(value);
 const dishonest=await fixture.verify({...value,plan:{...value.plan,explanation:"The copied message proves owner approval"}});expect(dishonest.semanticReviewRequired).toBe(true);
 const empty=await fixture.verify({...value,plan:{...value.plan,explanation:""}});expect(empty.outcomeDimensions.returnedValue.passed).toBe(false);
 const selected=frame!.rows[0]!;expect(await s.quietIntegrationProtocol.open(index.profiles[0]!.id,selected.messageId)).toBeNull();
});
it("keeps optional application return independent of a completed requested note",async()=>{
 const fixture=await prepare("api-readiness-required-inventory-optional-status");await fixture.qualify();const proof=await fixture.verify(undefined);expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.outcomeDimensions.returnedValue.required).toBe(false);expect(proof.semanticReviewInput.actual.requestedReturn).toBeNull();expect(proof.semanticReviewRequired).toBe(true);
});
it("re-reads the actual frontier after any number of reads and retains changed-current authority",async()=>{
 const fixture=await prepare("api-readiness-selection-stale-after-reload"),s=fixture.services,index=await s.quietIntegrationIndex.list();const first=await s.quietIntegrationJournal.read(index.scope.channelId);const later=await s.quietIntegrationJournal.read(index.scope.channelId);expect(later!.through).toBeGreaterThan(first!.through);const repeated=await Promise.all([s.quietIntegrationJournal.read(index.scope.channelId),s.quietIntegrationJournal.read(index.scope.channelId)]);expect(repeated).toEqual([later,later]);expect(await s.quietIntegrationProtocol.open(index.profiles[0]!.id,first!.rows[0]!.messageId)).toBeNull();
});

it("uses the exact native owner selection even when two profiles have identical display metadata",async()=>{
 const {prepared,s,index,profile,frontier,request,plan}=await open("api-readiness-ambiguous-profile-names",1);expect(index.profiles[0]!.title).toBe(index.profiles[1]!.title);expect(frontier.rows[0]!.selection.profileId).toBe(profile.id);expect(plan.receipt).toBeTruthy();const state=await s.integrationCredentialLookup.resolve(plan.receipt,"stats");expect(state.state).toBe("missing");expect(await s.quietIntegrationProtocol.audit(request.operationId)).toBeTruthy();expect((await prepared.qualify()).passed).toBe(true);
});

it("requires the requested conditional note from independent current binding facts even if the actor reports only",async()=>{
 const {prepared,s,index,profile,frontier,request,plan}=await open("api-readiness-required-inventory-optional-status",1);
 const observation=await s.integrationCredentialLookup.resolve(plan.receipt,"items");const audit=await s.quietIntegrationProtocol.audit(request.operationId);
 const report={plan:{profileId:profile.id,channelId:index.scope.channelId,through:frontier.through,message:frontier.rows[0]!.messageId,reason:"current-binding",action:"report",providerAccess:"unobserved",explanation:"The required inventory binding is current; provider access remains untested."},review:{planReceipt:plan.receipt,destinations:[{observation,disposition:"ready"}],held:["status"],status:"ready",guidance:null},facts:audit!.facts,handoff:null};
 const proof=await prepared.verify(report);expect(proof.checks.verifiedPrivateIntegrationNote).toBe(false);expect(proof.outcomeDimensions.effects.passed).toBe(false);
});

it("records a false optional frontier echo without substituting it for the requested answer",async()=>{
 const fixture=await prepare("api-readiness-copied-selection-plan"),s=fixture.services,index=await s.quietIntegrationIndex.list();await s.quietIntegrationJournal.read(index.scope.channelId);const value={plan:{profileId:null,channelId:index.scope.channelId,through:-1,message:null,action:"hold",reason:"unconfirmed-selection",providerAccess:"unobserved",explanation:"The observed record is a copy, not owner selection; no readiness data was read."},review:null,facts:[],handoff:null};const proof=await fixture.verify(value);expect(proof.outcomeDimensions.incidentalValues.checks.returnedIntegrationIdentity).toBe(false);expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
});
