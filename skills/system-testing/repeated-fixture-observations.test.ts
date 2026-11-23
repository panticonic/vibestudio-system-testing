import { expect, it, vi } from "vitest";
import { prepareManagedSetup } from "./onboarding-managed.js";
import { bindSessionReplay } from "./session-replay-managed.js";
import { managedSessionReplayWorlds } from "./session-replay-worlds.js";
it("shares concurrent/repeated onboarding receipt reads without another native observation", async () => {
  const observe = vi.fn(async () => ({ rows: [], route: null }));
  const fixture = await prepareManagedSetup(
    { vcs: { status: async () => ({}) }, observe } as never,
    "owned",
    "welcome-live-state",
  );
  const [first, second] = await Promise.all([
    fixture.service.inspect(),
    fixture.service.inspect(),
  ]);
  expect(second).toEqual(first);
  expect(observe).toHaveBeenCalledTimes(1);
  second.rows.push({ id: "invented", state: "ready", observed: true });
  expect(await fixture.service.inspect()).toEqual(first);
});
it("reads immutable replay checkpoints in any order and repeats, preserving canonical timeline and rejecting foreign receipts", async () => {
  const world = managedSessionReplayWorlds.find(
    (world) => world.steps.length > 1,
  )!;
  const evidence = world.steps.map((_, i) => ({
    receipt: `owned:replay:${i + 1}`,
    original: { messageId: `original-${i}` },
    retry: null,
    after: [],
  }));
  const fixture = bindSessionReplay("owned", world.id, evidence as never);
  for (const receipt of [...fixture.request.checkpoints].reverse())
    await fixture.services.sessionReplay.inspect(receipt);
  expect(
    await fixture.services.sessionReplay.inspect(
      fixture.request.checkpoints[0]!,
    ),
  ).toEqual(evidence[0]);
  expect(fixture.verify(fixture.reference()).passed).toBe(true);
  await expect(
    fixture.services.sessionReplay.inspect("foreign"),
  ).rejects.toThrow("assigned replay checkpoint");
  expect(fixture.verify({ findings: [] }).passed).toBe(false);
});
