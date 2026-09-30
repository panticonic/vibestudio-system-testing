import { describe, expect, it } from "vitest";
import { systemTestProgressCheckpoint } from "./cli.js";

describe("system-test progress checkpoints", () => {
  const progress = {
    runId: "run",
    status: "running",
    running: [{ name: "case", phase: "agent-turn" }],
  };
  const liveInspection = {
    inspect: { name: "case" },
    trajectories: { case: { bounded: { name: "case" } } },
  };

  it("retains inspection through a phase-only update, then replaces it on refresh", () => {
    const observed = systemTestProgressCheckpoint(null, {
      ...progress,
      liveInspection,
    });
    const cleanup = systemTestProgressCheckpoint(observed, {
      ...progress,
      running: [{ name: "case", phase: "cleanup" }],
    });
    expect(cleanup).toMatchObject({
      liveInspection,
      running: [{ phase: "cleanup" }],
    });
    const next = { inspect: { name: "next" }, trajectories: {} };
    expect(
      systemTestProgressCheckpoint(cleanup, {
        ...progress,
        liveInspection: next,
      }),
    ).toMatchObject({ liveInspection: next });
  });

  it("does not carry inspection into another run or terminal progress", () => {
    const previous = { ...progress, liveInspection };
    expect(
      systemTestProgressCheckpoint(previous, { ...progress, runId: "other" }),
    ).not.toHaveProperty("liveInspection");
    expect(
      systemTestProgressCheckpoint(previous, {
        ...progress,
        status: "completed",
      }),
    ).not.toHaveProperty("liveInspection");
  });

  it("bounds inherited and refreshed inspection by the same durable budget", () => {
    const previous = {
      ...progress,
      liveInspection: {
        inspect: { name: "case" },
        trajectories: { huge: "x".repeat(64 * 1024) },
      },
    };
    for (const observed of [
      systemTestProgressCheckpoint(previous, progress),
      systemTestProgressCheckpoint(null, previous),
    ]) {
      expect(observed).toMatchObject({
        liveInspection: { inspect: { name: "case" }, trajectories: {} },
      });
      expect(JSON.stringify(observed).length).toBeLessThan(48 * 1024);
    }
  });
});
