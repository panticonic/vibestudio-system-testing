import { describe, expect, it } from "vitest";
import {
  CHANNEL_DELIVERY_LATENCY_BASELINE_MS,
  channelDeliveryLatencyViolations,
  summarizeChannelDeliveryLatency,
} from "./delivery-latency.js";

describe("channel delivery latency regression gate", () => {
  it("fails only metrics whose observed execution span exceeds the checked-in baseline", () => {
    const metric = "publish-to-recipient-execution";
    expect(
      channelDeliveryLatencyViolations({
        channelDelivery: {
          deliveryLifecycle: {
            latencyHistogram: [
              {
                metric,
                maximum_ms: CHANNEL_DELIVERY_LATENCY_BASELINE_MS[metric] + 1,
              },
              { metric: "call-to-provider-execution", maximum_ms: 20 },
            ],
          },
        },
      })
    ).toEqual([expect.stringContaining(metric)]);
  });

  it("scales the allowance by the test agents that shared the instance", () => {
    const metric = "publish-to-recipient-execution";
    const baseline = CHANNEL_DELIVERY_LATENCY_BASELINE_MS[metric];
    const histogram = (maximum_ms: number) => ({
      channelDelivery: { deliveryLifecycle: { latencyHistogram: [{ metric, maximum_ms }] } },
    });

    // Alone on the instance, a span past the isolated ceiling is a regression.
    expect(
      channelDeliveryLatencyViolations({ ...histogram(baseline + 1), concurrentTestAgents: 1 })
    ).toEqual([`${metric}: ${baseline + 1}ms exceeds ${baseline}ms baseline`]);

    // Sharing it with five others, queueing explains a span this size, and the
    // message says what the allowance was made of.
    expect(
      channelDeliveryLatencyViolations({ ...histogram(baseline * 4), concurrentTestAgents: 6 })
    ).toEqual([]);
    expect(
      channelDeliveryLatencyViolations({ ...histogram(baseline * 6 + 1), concurrentTestAgents: 6 })
    ).toEqual([
      `${metric}: ${baseline * 6 + 1}ms exceeds ${baseline * 6}ms budget ` +
        `(${baseline}ms baseline x 6 test agents sharing the instance)`,
    ]);
  });

  it("keeps the unscaled comparison as evidence when a shared run passes", () => {
    const metric = "publish-to-recipient-execution";
    const baseline = CHANNEL_DELIVERY_LATENCY_BASELINE_MS[metric];
    const summary = summarizeChannelDeliveryLatency({
      channelDelivery: {
        deliveryLifecycle: { latencyHistogram: [{ metric, maximum_ms: baseline * 4 }] },
      },
      concurrentTestAgents: 6,
    });

    expect(summary?.violations).toEqual([]);
    expect(summary?.concurrentTestAgents).toBe(6);
    expect(summary?.metrics[0]).toMatchObject({
      baselineMs: baseline,
      budgetMs: baseline * 6,
      // The run was slow for its ceiling, and says so, while still passing.
      overBaseline: true,
      overBudget: false,
    });
  });

  it("still fails closed on a broken measurement under contention", () => {
    expect(
      channelDeliveryLatencyViolations({
        channelDelivery: { deliveryLifecycle: {} },
        concurrentTestAgents: 6,
      })
    ).toEqual([expect.stringContaining("unavailable")]);
  });

  it("fails closed when collected channel latency diagnostics are malformed", () => {
    expect(
      channelDeliveryLatencyViolations({ channelDelivery: { deliveryLifecycle: {} } })
    ).toEqual([expect.stringContaining("unavailable")]);
    expect(
      channelDeliveryLatencyViolations({
        channelDelivery: {
          deliveryLifecycle: {
            latencyHistogram: [{ metric: "call-to-provider-execution", maximum_ms: Number.NaN }],
          },
        },
      })
    ).toEqual([expect.stringContaining("invalid maximum_ms")]);
  });
});

describe("channel delivery latency summary", () => {
  it("separates a single over-budget outlier from the bulk of the distribution", () => {
    const summary = summarizeChannelDeliveryLatency({
      channelDelivery: {
        deliveryLifecycle: {
          latencyHistogram: [
            {
              metric: "publish-to-recipient-execution",
              upper_bound_ms: 30000,
              samples: 1,
              maximum_ms: 30001,
            },
            {
              metric: "publish-to-recipient-execution",
              upper_bound_ms: 100,
              samples: 9,
              maximum_ms: 80,
            },
          ],
        },
      },
    });

    expect(summary?.violations).toHaveLength(1);
    expect(summary?.metrics).toEqual([
      {
        metric: "publish-to-recipient-execution",
        baselineMs: CHANNEL_DELIVERY_LATENCY_BASELINE_MS["publish-to-recipient-execution"],
        // One agent, so the enforced budget is the isolated ceiling itself.
        budgetMs: CHANNEL_DELIVERY_LATENCY_BASELINE_MS["publish-to-recipient-execution"],
        maximumMs: 30001,
        samples: 10,
        overBudget: true,
        overBaseline: true,
        buckets: [
          { upperBoundMs: 100, samples: 9, maximumMs: 80 },
          { upperBoundMs: 30000, samples: 1, maximumMs: 30001 },
        ],
      },
    ]);
  });

  it("reports the fail-closed violation even when no row survives projection", () => {
    const summary = summarizeChannelDeliveryLatency({
      channelDelivery: { deliveryLifecycle: {} },
    });
    expect(summary?.metrics).toEqual([]);
    expect(summary?.violations).toEqual([expect.stringContaining("unavailable")]);
  });

  it("is absent when channel delivery diagnostics were never collected", () => {
    expect(summarizeChannelDeliveryLatency(undefined)).toBeNull();
    expect(summarizeChannelDeliveryLatency({})).toBeNull();
  });
});
