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

  async function verify(value: unknown) {
    const envelope = value as {
      card?: Card | null; plan?: Comparison["request"] | null; report?: Report | null; reason?: string;
    } | null;
    const outcome = envelope;
    const [after, final, retained] = await Promise.all([prepared.readback(), vcs.status({ contextId }), fs.readFile(path, "utf8")]);
    const native = prepared.verify(outcome?.report ?? null, after);
    const checks = {
      exactCurrentLocalWorkload: isDeepStrictEqual(selected, docket) &&
        isDeepStrictEqual(outcome?.card, card) && retained === serialized,
      exactLocalRequirements: isDeepStrictEqual(outcome?.plan, prepared.request),
      realLocalCandidateReadback: native.checks.stableInventory && native.checks.exactReads,
      verifiedExactLocalDispositions: native.checks.handoff && native.checks.candidates,
      preservedLocalInventoryAndWorkspace: isDeepStrictEqual(original.workingHead, final.workingHead) &&
        original.mainEventId === final.mainEventId && native.checks.stableInventory && outcome?.report?.receipt === null,
      matchedLocalInventoryGoal: typeof outcome?.reason === "string" && outcome.reason.trim().length > 0,
    };
    return { contextId: input.contextId, caseId: input.caseId, goal: input.goal, checks,
      passed: Object.values(checks).every(Boolean), native, docket, available: [prior, card], outcome };
  }

  async function qualify() {
    await localInventoryDocket.list();
    const rejectedArchive = await localInventoryDocket.read(prior.id).then(() => false, () => true);
    await localInventoryDocket.read(card.id);
    for (const { ref } of docket.preferences) await prepared.services.localModelTaskInventory.inspect(ref);
    const rejectedOutsideCandidate = await prepared.services.localModelTaskInventory.inspect("local:outside-assignment").then(() => false, () => true);
    const outcome = { card, plan: prepared.request, report: prepared.expected,
      reason: "Checked the exact local candidates and the bounded handoff requirements." };
    const proof = await verify(outcome);
    const rejectedInvalidLocalInventory = rejectedArchive && rejectedOutsideCandidate;
    return { ...proof, passed: proof.passed && rejectedInvalidLocalInventory,
      checks: { ...proof.checks, rejectedInvalidLocalInventory } };
  }

  return { services: { ...prepared.services, localInventoryDocket }, verify, qualify };
}
