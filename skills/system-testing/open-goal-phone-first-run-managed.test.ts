import {eligiblePhoneDesktops} from "@workspace-skills/phone-setup/eligibility";
import {assessSemanticOutcome} from "@workspace/application-outcomes/semantic-outcome-contract";
import { expect, it, vi } from "vitest";
import { preparePhoneFirstRun } from "./open-goal-phone-first-run-managed.js";
import { openPhoneFirstRunWorlds } from "./open-goal-phone-first-run-worlds.js";

vi.mock("@vibestudio/service-schemas/phoneProvisioning", () => ({
  PhoneProviderSchema: { array: () => ({ parse: (value: unknown) => value }) },
}));
vi.mock("@vibestudio/workspace/configParser", () => ({ parseWorkspaceSystemEpochEnvelope: () => ({}) }));
vi.mock("@vibestudio/workspace/templateManifest", () => ({
  parseTemplateManifestContent: () => ({ top: { runtimeExtensions: { "react-native": ["extensions/react-native"] } } }),
}));
vi.mock("@vibestudio/workspace-contracts/clients", () => ({
  CURRENT_HOST_ABI: { "react-native": "test-abi" },
  isClientRuntime: (runtime: string) => runtime === "react-native",
}));

it("accepts repeated identical native read observations without admitting a pairing attempt", async () => {
  const world = openPhoneFirstRunWorlds.find(({ id }) => id === "phone-first-run-radio-paired-no-visible-session")!;
  const prepared = await preparePhoneFirstRun({ contextId: "owned", caseId: world.id }, world, {
    contextId: "owned",
    vcs: {
      status: async () => ({ mainEventId: "commit", workingHead: { kind: "event", eventId: "commit" } }),
      resolveRepository: async ({ repoPath }: { repoPath: string }) => ({ repoPath, repositoryId: repoPath }),
      readFile: async ({ repositoryId }: { repositoryId: string }) => ({
        content: {
          kind: "text",
          text: repositoryId === "clients/mobile-browser" ? JSON.stringify({
            vibestudio: { client: { id: "browser", runtime: "react-native", hostAbi: "test-abi" } },
          }) : JSON.stringify({ name: "@workspace-extensions/react-native" }),
        },
        contentHash: repositoryId,
      }),
    },
    workspacePhoneReadiness: () => ({ state: "opening" }),
    eligiblePhoneDesktops: () => [],
    bindPhoneSetup: async (_assignment: { paired: { deviceId: string } }) => ({
      request: { goal: world.goal, operationId: "operation" },
      services: { phoneSetupRead: {
        start: async () => ({ pairedDeviceId: _assignment.paired.deviceId, receipt: "setup" }),
        readiness: async () => ({ state: "opening", receipt: "ready" }),
      } },
    }),
  } as never);
  const prior = await prepared.qualify();
  expect(assessSemanticOutcome(prior).passed).toBe(true);
  expect(prior.passed).toBe(true);
  await prepared.services.phoneSetupRead.start("operation");
  await prepared.services.phoneSetupRead.readiness("setup");
  expect((await prepared.verify(prior.report)).passed).toBe(true);
  await expect(prepared.services.phoneFirstRun.inspect(prior.assignment.id)).resolves.toEqual(prior.assignment);
  expect((await prepared.verify(prior.report)).passed).toBe(true);
  await expect(prepared.services.phoneSetupPair.provision()).rejects.toThrow("no preparation, installation or pairing authority");
  const refused=await prepared.verify(prior.report);expect(refused.outcomeDimensions.effects.passed).toBe(true);expect(refused.checks.noRefusedPhoneOperations).toBe(false);expect(refused.semanticReviewRequired).toBe(true);
});

it("requires the requested shell sign-off finding while preserving actual assigned phases and readonly custody",async()=>{
 const world=openPhoneFirstRunWorlds.find(w=>w.id==="phone-first-run-shell-only-excerpt")!;
  const prepared = await preparePhoneFirstRun({ contextId: "owned", caseId: world.id }, world, {
    contextId: "owned",
    vcs: {
      status: async () => ({ mainEventId: "commit", workingHead: { kind: "event", eventId: "commit" } }),
      resolveRepository: async ({ repoPath }: { repoPath: string }) => ({ repoPath, repositoryId: repoPath }),
      readFile: async ({ repositoryId }: { repositoryId: string }) => ({
        content: {
          kind: "text",
          text: repositoryId === "clients/mobile-browser" ? JSON.stringify({
            vibestudio: { client: { id: "browser", runtime: "react-native", hostAbi: "test-abi" } },
          }) : JSON.stringify({ name: "@workspace-extensions/react-native" }),
        },
        contentHash: repositoryId,
      }),
    },
    workspacePhoneReadiness: () => ({ state: "opening" }),
    eligiblePhoneDesktops: (providers:unknown[]) => providers,
    bindPhoneSetup: async (_assignment: { paired: { deviceId: string } }) => ({
      request: { goal: world.goal, operationId: "operation" },
      services: { phoneSetupRead: {
        start: async () => ({ pairedDeviceId: _assignment.paired.deviceId, receipt: "setup" }),
        readiness: async () => ({ state: "opening", receipt: "ready" }),
      } },
    }),
  } as never);

 const proof=await prepared.qualify();
 expect(proof.outcomeDimensions.effects.passed).toBe(true);
 const answer="No. The shell-ready marker does not establish a connected workspace or a loaded panel. Verify those remaining phases on the assigned desktop before signing off; no pairing was performed.";
 const actual=await prepared.verify(answer);
 expect(actual.outcomeDimensions.effects.passed).toBe(true);expect(actual.outcomeDimensions.returnedValue.passed).toBe(true);
 expect(actual.phases.status).toBe("await-connection");expect(actual.phases.observedShell).toBe(true);expect(actual.phases.observedConnection).toBe(false);
 expect(actual.semanticReviewRequired).toBe(true);expect(actual.semanticReviewInput!.actual.requestedReturn).toBe(answer);
 expect(actual.semanticReviewInput!.actual.observations).toEqual({card:actual.card,assignment:actual.assignment,phases:actual.phases,build:actual.build,journal:actual.journal,refusedOperations:actual.refusedOperations,nativeFacts:actual.nativeFacts});
 expect((await prepared.verify("")).outcomeDimensions.returnedValue.passed).toBe(false);
 expect((await prepared.verify({action:"inspect-native-evidence",reason:"shell"})).outcomeDimensions.returnedValue.passed).toBe(false);
 await expect(prepared.services.phoneSetupPair.provision()).rejects.toThrow();const refused=await prepared.verify(answer);expect(refused.outcomeDimensions.effects.passed).toBe(true);expect(refused.refusedOperations.at(-1)).toMatchObject({service:"phoneSetupPair",method:"provision"});expect(refused.semanticReviewRequired).toBe(true);
});

async function makePhoneFixture(world:typeof openPhoneFirstRunWorlds[number]){
 let version="baseline";const actualStarts=vi.fn(async()=>({receipt:"resume",pairedDeviceId:""}));
 const prepared=await preparePhoneFirstRun({contextId:"owned",caseId:world.id},world,{
  contextId:"owned",vcs:{status:async()=>({mainEventId:version,workingHead:{kind:"event",eventId:version}}),resolveRepository:async({repoPath}:{repoPath:string})=>({repoPath,repositoryId:repoPath}),readFile:async({repositoryId}:{repositoryId:string})=>({content:{kind:"text",text:JSON.stringify(repositoryId==="clients/mobile-browser"?{vibestudio:{client:{id:"browser",runtime:"react-native",hostAbi:"test-abi"}}}:{name:"@workspace-extensions/react-native"})},contentHash:repositoryId})},
  workspacePhoneReadiness:()=>({state:world.expected.ready??"opening"}),
  eligiblePhoneDesktops,
  bindPhoneSetup:async(assignment:{paired:{deviceId:string}})=>({request:{goal:world.goal,operationId:"owned-native-operation"},services:{phoneSetupRead:{start:async()=>{actualStarts();return{receipt:"resume",pairedDeviceId:assignment.paired.deviceId}},readiness:async()=>({receipt:"readback",state:world.expected.ready??"opening"})}}}),
 }as never);
 return{prepared,actualStarts,changeWorkspace(){version="changed"}};
}
for(const world of openPhoneFirstRunWorlds)it(`retains actual phone reference authority and required answer: ${world.id}`,async()=>{
 const {prepared}=await makePhoneFixture(world);const reference=await prepared.qualify();expect(reference.passed).toBe(true);
 expect((await prepared.verify("")).outcomeDimensions.returnedValue.passed).toBe(false);
});
it("a refused read has no operation effect and remains bound into mandatory review",async()=>{
 const world=openPhoneFirstRunWorlds.find(w=>w.id==="phone-first-run-compatible-package-setup-only")!;
 const {prepared,actualStarts,changeWorkspace}=await makePhoneFixture(world);
 const reference=await prepared.qualify();expect(reference.assignment.setupRequest).toBeNull();
 await expect(prepared.services.phoneSetupRead.start("invented-operation")).rejects.toThrow("no preparation");
 expect(actualStarts).not.toHaveBeenCalled();
 const answer="The compatible release package is already retained. Pair it with the eligible desktop and verify connection and workspace readiness next; do not reinstall or request a source build.";
 const proof=await prepared.verify(answer);expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.outcomeDimensions.returnedValue.passed).toBe(true);
 expect(proof.checks.noRefusedPhoneOperations).toBe(false);expect(proof.refusedOperations).toEqual([{service:"phoneSetupRead",method:"start",reason:"The owned phone rehearsal has no preparation, installation or pairing authority"}]);
 expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput!.actual.observations.refusedOperations).toEqual(proof.refusedOperations);
 changeWorkspace();expect((await prepared.verify(answer)).outcomeDimensions.effects.passed).toBe(false);
});

it("allows a narrow current-assignment inquiry without an unrelated phases/provider/resume checklist",async()=>{
 const world=openPhoneFirstRunWorlds.find(w=>w.id==="phone-first-run-compatible-package-setup-only")!;
 const{prepared,actualStarts}=await makePhoneFixture(world);
 const cards=await prepared.services.phoneFirstRun.discover();await prepared.services.phoneFirstRun.inspect(cards[0]!.id);
 const proof=await prepared.verify("The retained release package is recorded; use the eligible desktop for pairing next, then establish connection. Do not reinstall or request a source build.");
 expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(actualStarts).not.toHaveBeenCalled();
 expect(proof.nativeFacts.actorObserved).toEqual({assignment:true,startup:false,provider:false,resume:false});
 expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput!.actual.observations.nativeFacts).toEqual(proof.nativeFacts);
});
it("does not turn an unread phase into verified evidence for a guessed ready answer",async()=>{
 const world=openPhoneFirstRunWorlds.find(w=>w.id==="phone-first-run-shell-only-excerpt")!;
 const{prepared}=await makePhoneFixture(world);const cards=await prepared.services.phoneFirstRun.discover();await prepared.services.phoneFirstRun.inspect(cards[0]!.id);
 const proof=await prepared.verify("The workspace is completely ready.");
 expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.nativeFacts.actorObserved.startup).toBe(false);
 expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput!.actual.observations.journal.every((row:any)=>row.method!=="phases")).toBe(true);
});
it("still requires a real current assigned basis and rejects actual unrelated workspace changes",async()=>{
 const world=openPhoneFirstRunWorlds.find(w=>w.id==="phone-first-run-compatible-package-setup-only")!;const{prepared,changeWorkspace}=await makePhoneFixture(world);
 expect((await prepared.verify("A guessed setup step.")).outcomeDimensions.effects.passed).toBe(false);
 const cards=await prepared.services.phoneFirstRun.discover();await prepared.services.phoneFirstRun.inspect(cards[0]!.id);changeWorkspace();
 expect((await prepared.verify("A current setup step.")).outcomeDimensions.effects.passed).toBe(false);
});
