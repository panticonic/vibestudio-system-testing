import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessNativeGoal=bindObservedContentReview(["docket","inventoryReadback"]);
import type {ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { contextId, fs, vcs } from "@workspace/runtime";
import type { prepareLocalModelComparison } from "@workspace-skills/local-model-task-bindings/live";
import type { LocalInventoryWorld } from "./open-goal-live-local-inventory-worlds.js";

type Card = { id: string; title: string; current: boolean };
type Comparison = Awaited<ReturnType<typeof prepareLocalModelComparison>>;
type Report = Comparison["expected"];

export async function prepareOpenLiveLocalInventory(
  input: { contextId: string; caseId: string; goal: string },
  world: LocalInventoryWorld,
  prepareComparison: (contextId: string, world: LocalInventoryWorld) => Promise<Comparison>,
) {
  if (contextId !== input.contextId || world.id !== input.caseId || world.goal !== input.goal)
    throw new Error("The local model docket belongs to another goal or workspace");
  const original = await vcs.status({ contextId });
  const prepared = await prepareComparison(input.contextId, world);
  const card: Card = { id: crypto.randomUUID(), title: world.title, current: true };
  const prior: Card = { id: crypto.randomUUID(), title: `${world.title} archive`, current: false };
  const docket = { card, preferences: world.preferences, purpose: "Read current local inventory for this retained workload." };
  const path = `${await fs.mkdtemp("owned-local-model-docket")}/docket.json`;
  const serialized = JSON.stringify(docket);
  await fs.writeFile(path, serialized);
  let selected: typeof docket | null = null;
  const localInventoryDocket = {
    async list() { return [prior, card]; },
    async read(id: string) {
      if (id !== card.id) throw new Error("Use the exact current workload docket");
      const bytes = await fs.readFile(path, "utf8");
      if (bytes !== serialized) throw new Error("The current local workload docket changed");
      selected = JSON.parse(bytes) as typeof docket;
      return selected;
    },
  };

  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["verifiedExactLocalDispositions","matchedLocalInventoryGoal"],"rootPath":["report"],"producerSourceSuffix":"prepareLocalModel.nl","producerPath":[]}];
    const contributions=authored.filter(binding=>{
      let current:unknown=value;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessNativeGoal(proof,proof.outcomeContract,value,invocation,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(value: unknown, invocation?: InvocationObservations) {
    const envelope = value as {
      card?: Card | null; plan?: Comparison["request"] | null; report?: Report | null; reason?: string;
    } | null;
    const outcome = envelope;
    const [after, final, retained] = await Promise.all([prepared.readback(), vcs.status({ contextId }), fs.readFile(path, "utf8")]);
    const native = prepared.verify(outcome?.report ?? null, after);
    const checks = {
      exactCurrentLocalWorkload: isDeepStrictEqual(selected, docket) &&
        retained === serialized,
      exactLocalRequirements: isDeepStrictEqual(selected,docket),
      realLocalCandidateReadback: native.checks.currentInventory && native.checks.exactReads,
      verifiedExactLocalDispositions: native.checks.handoff && native.checks.candidates,
      preservedLocalInventoryAndWorkspace: isDeepStrictEqual(original.workingHead, final.workingHead) &&
        original.mainEventId === final.mainEventId && native.checks.currentInventory,
      matchedLocalInventoryGoal: typeof outcome?.reason === "string" && outcome.reason.trim().length > 0,
    };
    return {
      outcomeContract:{effects:{checks:["exactCurrentLocalWorkload", "exactLocalRequirements", "realLocalCandidateReadback", "preservedLocalInventoryAndWorkspace"],rationale:"Independent native state, admission, captured operations and durable readback establish these facts."},
        returnedValue:{checks:["verifiedExactLocalDispositions", "matchedLocalInventoryGoal"],required:true,rationale:"A requested query answer is required; a redundant result copy is optional after its requested native effect is established."},
        incidentalValues:{checks:[],rationale:"Known incorrect emitted application values use actual invocation definitions for masking."}},
      incorrectReturnValues:[],
 contextId: input.contextId, caseId: input.caseId, goal: input.goal, checks,
      passed: Object.values(checks).every(Boolean), native, docket, inventoryReadback:{request:prepared.request,rows:native.rows,inspected:native.inspected,initialRows:native.initialRows,observations:native.observations}, available: [prior, card], outcome };
  }

  async function qualify() {
    await localInventoryDocket.list();
    const rejectedArchive = await localInventoryDocket.read(prior.id).then(() => false, () => true);
    await localInventoryDocket.read(card.id);
    for (const { ref } of docket.preferences) await prepared.services.localModelTaskInventory.inspect(ref);
    const rejectedOutsideCandidate = await prepared.services.localModelTaskInventory.inspect("local:outside-assignment").then(() => false, () => true);
    const outcome = { report: prepared.expected,
      reason: "Checked the exact local candidates and the bounded handoff requirements." };
    const proof = await verify(outcome);
    const rejectedInvalidLocalInventory = rejectedArchive && rejectedOutsideCandidate;
    return assessNativeQualification({ ...proof,outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"rejectedInvalidLocalInventory"]}}, passed: proof.passed && rejectedInvalidLocalInventory,
      checks: { ...proof.checks, rejectedInvalidLocalInventory } });
  }

  return { services: { ...prepared.services, localInventoryDocket }, verify, qualify };
}
