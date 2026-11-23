import { expect, it, vi } from "vitest";
vi.mock("@workspace/runtime",()=>({contextId:"owned-context"}));
vi.mock("./tests/_client-device.js",()=>({openClientDevice:vi.fn()}));
import { bindOpenGoalOperator } from "./open-goal-operator-managed.js";
import { operatorGoalWorlds } from "./open-goal-operator-worlds.js";

const identity = {
  serverId: "owned-server",
  workspaceId: "owned-workspace",
  bootId: "first-boot",
  buildId: "first-build",
};
const worldNamed = (id: string) =>
  operatorGoalWorlds.find((world) => world.id === id)!;

function deployment(id: string, changeWorkspace = false) {
  const world = worldNamed(id);
  if (world.target.surface !== "deployment")
    throw new Error("Use a deployment test world");
  const ready = world.target.initial === "ready";
  const initial = ready
    ? { state: "ready" as const, identity }
    : { state: "inactive" as const, identity: null };
  const after = {
    ...identity,
    bootId: "second-boot",
    workspaceId: changeWorkspace ? "different-workspace" : identity.workspaceId,
  };
  const records: string[] = [];
  const bound = bindOpenGoalOperator(
    { contextId: "owned-context", caseId: id },
    world,
    {
      kind: "deployment",
      initial,
      async baseline() {
        records.push("baseline");
        return {
          receipt: "baseline-receipt",
          intent: ready ? "update" : "deploy",
          state: initial.state,
          hasPriorIdentity: ready,
        };
      },
      async apply() {
        records.push("apply");
        return { receipt: "installer-receipt", state: "applied" };
      },
      async verify() {
        records.push("verify");
        return {
          receipt: "readback-receipt",
          state: "verified",
          identity: after,
        };
      },
      async finish() {
        const wasApplied = records.includes("apply");
        records.push("finish");
        return wasApplied ? { state: "ready", identity: after } : initial;
      },
    },
  );
  return { ...bound, records };
}

it("keeps unapproved or inspection-only deployments unchanged", async () => {
  const harness = deployment("hold-unapproved-training-instance-start");
  expect((await harness.qualify()).passed).toBe(true);
  expect(harness.records).toEqual(["baseline", "finish"]);
  const inspection = deployment("verify-healthy-catalog-hub-without-update");
  expect((await inspection.qualify()).passed).toBe(true);
  expect(inspection.records).toEqual(["baseline", "finish"]);
});

it("requires the original workspace and a new boot after restart", async () => {
  const harness = deployment("reapply-review-hub-preserving-project");
  const result = await harness.qualify();
  expect(result.passed).toBe(true);
  expect(result.rejectedAlias).toBe(true);
  expect(harness.records).toEqual(["baseline", "apply", "verify", "finish"]);
  const replacement = await deployment(
    "reapply-review-hub-preserving-project",
    true,
  ).qualify();
  expect(replacement.checks.verifiedServiceOutcome).toBe(false);
  expect(replacement.passed).toBe(false);
});

it("uses the observed profile's actual pairing route and rejects forged receipts", async () => {
  const world = worldNamed("pair-new-operator-to-running-workspace");
  const records: string[] = [];
  const harness = bindOpenGoalOperator(
    { contextId: "owned-context", caseId: world.id },
    world,
    {
      kind: "terminal-profile",
      initial: { state: "ready", identity },
      async baseline() {
        records.push("baseline");
        return {
          receipt: "baseline-receipt",
          intent: "deploy",
          state: "ready",
          hasPriorIdentity: true,
        };
      },
      async profile() {
        records.push("profile");
        return {
          receipt: "profile-receipt",
          state: "unpaired",
          inviteAssigned: true,
        };
      },
      async pair() {
        records.push("pair");
        return { receipt: "pair-receipt", state: "paired" };
      },
      async open() {
        records.push("route");
        return { receipt: "route-receipt", state: "routed" };
      },
      async verify() {
        records.push("child");
        return {
          receipt: "child-receipt",
          state: "verified",
          workspaceId: identity.workspaceId,
        };
      },
      async finish() {
        records.push("finish");
        return { stableDeployment: true, persistedNewProfile: true };
      },
    },
  );
  expect((await harness.qualify()).passed).toBe(true);
  expect(records).toEqual([
    "baseline",
    "profile",
    "pair",
    "route",
    "child",
    "finish",
  ]);
  const forged = await harness.verify({
      status: "paired",
      reason: null,
      targetId: world.target.id,
      identity,
      evidenceIds: ["foreign-receipt"],
    });
  expect(forged.checks.boundOperatorReport).toBe(false);
  expect(records.at(-2)).toBe("child");
});

it("replays owned observations and verifier receipts for concurrent repeated reads", async()=>{
  const harness=deployment("reapply-review-hub-preserving-project");
  const [target]=await harness.services.operatorDiscovery.list();
  const [first,repeat]=await Promise.all([
    harness.services.operatorDiscovery.observe(target!.id),
    harness.services.operatorDiscovery.observe(target!.id),
  ]);
  expect(repeat).toEqual(first);
  const applied=await harness.services.operatorDeployment.apply(first.receipt,"restart");
  const [read,again]=await Promise.all([
    harness.services.operatorDeployment.verify(applied.receipt),
    harness.services.operatorDeployment.verify(applied.receipt),
  ]);
  expect(again).toEqual(read);
  await expect(harness.services.operatorDeployment.verify("foreign-receipt")).rejects.toThrow();
  expect(harness.records).toEqual(["baseline","apply","verify"]);
});
