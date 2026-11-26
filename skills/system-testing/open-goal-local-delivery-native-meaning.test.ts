import { expect, it, vi } from "vitest";
import { prepareOpenLocalDelivery } from "./open-goal-local-delivery-managed.js";
import { openLocalDeliveryWorlds } from "./open-goal-local-delivery-worlds.js";

it("can establish an absent owned conversation by catalog discovery without inspecting a forbidden substitute", async () => {
  const original = openLocalDeliveryWorlds.find(
    (world) => world.id === "local-delivery-no-eligible-conversation-hold",
  )!;
  // Empty owned inventory exercises this factory's exact discovery/verification
  // boundary without creating actors. It is a component case, not corpus data.
  const world = { ...original, rooms: [] };
  const createEntity = vi.fn(async () => {
      throw Error("No room exists");
    }),
    retireEntity = vi.fn(),
    call = vi.fn(async () => {
      throw Error("No native actor should be called");
    });
  const prepared = await prepareOpenLocalDelivery(
    { contextId: "owned-empty", caseId: world.id },
    world,
    { runtime: { createEntity, retireEntity }, rpc: { call } } as never,
  );
  const answer = {
    status: "unconfirmed",
    reason: "The requested room is not available in this owned inventory.",
    delivery: null,
  };
  try {
    expect((await prepared.verify(answer)).passed).toBe(false);
    expect(await prepared.services.localDeliveryCatalog.discover()).toEqual([]);
    const proof = await prepared.verify(answer);
    expect(proof.passed).toBe(true);
    expect(proof.semanticReviewRequired).toBe(true);
    expect(proof.outcomeContract.returnedValue.required).toBe(true);
    expect(proof.observedChecks.discoveredOwnedDeliveryRooms).toBe(true);
    expect(proof.observedChecks).not.toHaveProperty(
      "exactObservedDeliveryScope",
    );
    expect(proof.observedChecks).not.toHaveProperty(
      "matchedLocalDeliveryDecision",
    );
    expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(answer);
    const missing = await prepared.verify(null);
    expect(missing.passed).toBe(false);
    const invented = {
      ...answer,
      status: "delivered",
      reason: "The unavailable room acknowledged it.",
    };
    const pending = await prepared.verify(invented);
    expect(pending.semanticReviewRequired).toBe(true);
    expect(pending.semanticReviewInput.actual.requestedReturn).toEqual(
      invented,
    );
    expect(createEntity).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  } finally {
    await prepared.close();
  }
});
