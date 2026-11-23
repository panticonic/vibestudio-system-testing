import { expect, it, vi } from "vitest";
import { matchUrlBoundCredentialCandidates, findCredentialBinding } from "@vibestudio/credential-client/urlBoundSelection";
import { findMatchingUrlAudience } from "@vibestudio/credential-client/urlAudience";
import { credentialLifecycle } from "@vibestudio/credential-client/credentialStatus";
import { prepareOpenApiReadiness } from "./open-goal-api-readiness-managed.js";
vi.mock("@workspace/runtime", () => ({ contextId: null, fs: {}, rpc: {}, vcs: {}, credentials: {} }));
vi.mock("@workspace-skills/scratch-handoff-bindings", () => ({ bindScratchHandoff: (fs:{writeFile(path:string,text:string):Promise<void>}) => ({ scratchHandoffWrite: { stage: async (text:string) => {const path="/.tmp/evidence-handoff-proof/handoff.json";await fs.writeFile(path,text);return {path,bytes:new TextEncoder().encode(text).length};} } }) }));
async function prepare(caseId: string) {
  const rows: { messageId: string; envelopeId: string; seq: number; selection: unknown }[] = [];
  const saved=new Map<string,string>();
  const prepared=await prepareOpenApiReadiness({ contextId: "owned", caseId }, {
    match: matchUrlBoundCredentialCandidates, binding: findCredentialBinding,
    audience: findMatchingUrlAudience, lifecycle: credentialLifecycle,
  }, {
    contextId: "owned", fs: { mkdtemp: async () => "/scratch", writeFile: async (path:string,text:string) => {saved.set(path,text);}, readdir: async () => saved.size?["evidence-handoff-proof"]:[] },
    status: async () => ({ mainEventId: "unchanged", workingHead: { kind: "event", eventId: "unchanged" } }),
    open: async () => ({ key: "channel" }),
    append: async (_lane: unknown, _context: string, additions: unknown[]) => additions.map(selection => {
      const seq = rows.length + 1, messageId = `message-${seq}`;
      rows.push({ messageId, envelopeId: `envelope-${seq}`, seq, selection }); return messageId;
    }),
    read: async () => ({ channelId: "channel", through: rows.length, rows: structuredClone(rows) }),
    readBytes: async (path:string) => {const text=saved.get(path);if(text===undefined)throw new Error("No scratch artifact was requested");return new TextEncoder().encode(text);},
  } as never);
  return {...prepared,readArtifact:()=>JSON.parse(saved.values().next().value??"null")};
}
async function open(caseId: string) {
  const prepared = await prepare(caseId), s = prepared.services;
  const index = await s.quietIntegrationIndex.list(), profile = index.profiles[0]!;
  await s.quietIntegrationJournal.read(index.scope.channelId);
  const frontier = (await s.quietIntegrationJournal.read(index.scope.channelId))!;
  const request = (await s.quietIntegrationProtocol.open(profile.id, frontier.rows[0]!.messageId))!;
  const plan = await s.integrationPlanRead.observe(request.operationId);
  return { prepared, s, index, profile, frontier, request, plan };
}
it("accepts reordered and repeated integration observations, rejecting invented native state", async () => {
  const { prepared, s, index, profile, frontier, request, plan } = await open("api-readiness-api-versus-git-read");
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
  expect((await check(invented)).passed).toBe(false);
});
it("retains explicit user observation prerequisites and the sealed receipt", async () => {
  const { s, plan } = await open("api-readiness-optional-miss-continue-scope");
  await expect(s.integrationCredentialLookup.resolve(plan.receipt, "metrics")).rejects.toThrow(/user-requested prerequisite/);
  await s.integrationCredentialLookup.resolve(plan.receipt, "status");
  expect((await s.integrationCredentialLookup.resolve(plan.receipt, "metrics")).state).toBe("active");
  await expect(s.integrationCredentialLookup.resolve("foreign", "metrics")).rejects.toThrow(/assigned integration plan/);
});

it("checks the actual saved semantic note independently of a later returned summary",async()=>{
  const good=await prepare("api-readiness-required-inventory-optional-status");
  expect((await good.qualify()).passed).toBe(true);
  const saved=good.readArtifact();
  const native=await good.verify({plan:{...saved.plan,explanation:"An unsupported later return."},review:saved.review.result,facts:saved.audit.facts,handoff:null});
  expect(native.outcomeDimensions.effects.passed).toBe(true);
  expect(native.outcomeDimensions.returnedValue.passed).toBe(false);
  const bad=await prepare("api-readiness-required-inventory-optional-status"),stage=bad.services.quietIntegrationHandoff.stage;
  bad.services.quietIntegrationHandoff.stage=report=>stage({...report,plan:{...report.plan,explanation:"An unsupported persisted summary."}});
  const rejected=await bad.qualify();
  expect(rejected.outcomeDimensions.effects.passed).toBe(false);
  expect(rejected.outcomeDimensions.effects.checks.verifiedPrivateIntegrationNote).toBe(false);
  expect(rejected.outcomeDimensions.returnedValue.passed).toBe(true);
});
