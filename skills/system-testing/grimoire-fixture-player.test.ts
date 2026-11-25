const cancellation = vi.hoisted(() => ({
  signal: null as AbortSignal | null,
  error: null as Error | null,
}));
vi.mock("@workspace/testkit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/testkit")>();
  return {
    ...actual,
    activeTestContext: () =>
      cancellation.signal
        ? { signal: cancellation.signal }
        : actual.activeTestContext(),
    waitFor: (...args: Parameters<typeof actual.waitFor>) =>
      cancellation.error
        ? Promise.reject(cancellation.error)
        : actual.waitFor(...args),
  };
});
import { TestAssertionError } from "@workspace/testkit";
import { expect, it, vi } from "vitest";
import {
  advanceOwnedGrimoirePanel,
  visitOwnedGrimoirePanel,
} from "./grimoire-fixture-player.js";
const fixture = {
  contextId: "owned-context",
  estateKey: "natlang-scene-00000000-0000-4000-8000-000000000001",
};
function nativePanel(
  read: (clicked: boolean) => {
    clock: string;
    busy: boolean;
    error: string;
    notice?: string;
  },
) {
  let clicked = false;
  const close = vi.fn(async () => {});
  const click = vi.fn(async () => {
    clicked = true;
  });
  const evaluate = vi.fn(async (source: string) => {
    expect(source).toContain('main.grimoire [role="alert"]');
    return read(clicked);
  });
  const panel = {
    id: "owned-panel",
    observe: async () => ({
      panelId: "owned-panel",
      kind: "workspace",
      source: "panels/grimoire",
      contextId: fixture.contextId,
      requestedRef: `ctx:${fixture.contextId}`,
    }),
    stateArgs: { get: async () => ({ estateKey: fixture.estateKey }) },
    cdp: {
      session: async () => ({
        page: { evaluate, getByRole: () => ({ click }), close },
      }),
    },
  };
  return {
    panel: panel as unknown as Parameters<typeof advanceOwnedGrimoirePanel>[0],
    close,
    click,
  };
}
async function expireFixture(operation: () => Promise<void>) {
  vi.useFakeTimers();
  try {
    const result = operation().then(
      () => null,
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(30_001);
    return await result;
  } finally {
    vi.useRealTimers();
  }
}
it("retains a real opening failure and actual clock in the original timeout evidence", async () => {
  const p = nativePanel(() => ({
    clock: "",
    busy: false,
    error: "Native owned read denied",
  }));
  const error = await expireFixture(() =>
    advanceOwnedGrimoirePanel(p.panel, fixture, { day: 1, phase: 3 }),
  );
  expect(error.message).toContain("Native owned read denied");
  expect(error.message).toContain("timed out after 30000ms");
  expect(error.cause.name).toBe("TestAssertionError");
  expect(error.actual.playerState.clock).toBe("");
  expect(p.click).not.toHaveBeenCalled();
  expect(p.close).toHaveBeenCalledOnce();
});
it("retains a post-action failure instead of hiding it behind an expected-clock label", async () => {
  const p = nativePanel((clicked) => ({
    clock: "DAY 1 · NIGHT",
    busy: false,
    error: clicked ? "Native quiet observation failed" : "",
  }));
  const error = await expireFixture(() =>
    advanceOwnedGrimoirePanel(p.panel, fixture, { day: 1, phase: 3 }),
  );
  expect(error.message).toContain("Native quiet observation failed");
  expect(error.actual.playerState.clock).toBe("DAY 1 · NIGHT");
  expect(p.click).toHaveBeenCalledOnce();
  expect(p.close).toHaveBeenCalledOnce();
});
it("retains exact normal advance despite an unrelated recoverable read alert", async () => {
  const p = nativePanel((clicked) => ({
    clock: clicked ? "DAY 2 · MORNING" : "DAY 1 · NIGHT",
    busy: false,
    error: "Incidental read retry",
  }));
  await expect(
    advanceOwnedGrimoirePanel(p.panel, fixture, { day: 1, phase: 3 }),
  ).resolves.toBeUndefined();
  expect(p.click).toHaveBeenCalledOnce();
  expect(p.close).toHaveBeenCalledOnce();
});
it("retains a resident-action failure when the clock is correct but acknowledgement is absent", async () => {
  const p = nativePanel((clicked) => ({
    clock: "DAY 1 · NIGHT",
    busy: false,
    error: clicked ? "Native visit failed" : "",
    notice: "",
  }));
  const error = await expireFixture(() =>
    visitOwnedGrimoirePanel(p.panel, fixture, { day: 1, phase: 3 }, "Rill"),
  );
  expect(error.message).toContain("Native visit failed");
  expect(error.actual.playerState.notice).toBe("");
  expect(p.click).toHaveBeenCalledOnce();
  expect(p.close).toHaveBeenCalledOnce();
});
it("retains the existing successful native visit acknowledgement", async () => {
  const p = nativePanel((clicked) => ({
    clock: "DAY 1 · NIGHT",
    busy: false,
    error: "",
    notice: clicked ? "Rill pauses to watch you." : "",
  }));
  await expect(
    visitOwnedGrimoirePanel(p.panel, fixture, { day: 1, phase: 3 }, "Rill"),
  ).resolves.toBeUndefined();
  expect(p.close).toHaveBeenCalledOnce();
});

it("preserves the original cancelled-wait error identity and still joins the page", async () => {
  const controller = new AbortController();
  controller.abort();
  const original = new TestAssertionError(
    "waitFor aborted: cancelled by owner",
  );
  cancellation.signal = controller.signal;
  cancellation.error = original;
  const p = nativePanel(() => ({ clock: "", busy: false, error: "" }));
  try {
    const error = await advanceOwnedGrimoirePanel(p.panel, fixture, {
      day: 1,
      phase: 3,
    }).then(
      () => null,
      (error) => error,
    );
    expect(error).toBe(original);
    expect(p.close).toHaveBeenCalledOnce();
  } finally {
    cancellation.signal = null;
    cancellation.error = null;
  }
});
