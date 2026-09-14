/** Calibrated 2026-08-10 from isolated cold and warm managed-instance runs
 * after moving the origin ahead of durable append/projection work. Observed
 * maxima were 22,001ms for publish -> recipient execution and 19,680ms for
 * result -> caller settlement; 30s is the next measured histogram ceiling and
 * is shared by all spans so newly exercised provider routes are gated too. */
export const CHANNEL_DELIVERY_LATENCY_BASELINE_MS = {
  "publish-to-recipient-execution": 30_000,
  "call-to-provider-execution": 30_000,
  "result-to-caller-settlement": 30_000,
} as const;

type Metric = keyof typeof CHANNEL_DELIVERY_LATENCY_BASELINE_MS;

/** How many test agents shared the instance while these spans were measured. */
function concurrentTestAgents(diagnostics: Record<string, unknown>): number {
  const value = diagnostics["concurrentTestAgents"];
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : 1;
}

/**
 * What this run is allowed to spend on one span.
 *
 * The baselines are wall-clock ceilings calibrated from runs where one test
 * agent had the instance to itself. A suite run with `--concurrency N`
 * deliberately puts N agents on it, and publish -> recipient execution then
 * includes time the recipient spent queued behind other tests' model turns —
 * so the isolated ceiling reports a delivery regression for every test in the
 * run, which is exactly how a real one would hide.
 *
 * N agents time-share one instance, so the queueing term grows about linearly
 * with N, and the allowance follows it. This is a contention allowance rather
 * than a second calibration: across an observed 6-agent suite the worst span
 * reached 4.4x its isolated baseline, inside a 6x allowance, while a stalled
 * route still has to stay under a fixed multiple of the ceiling to pass. The
 * unscaled comparison is kept alongside it as `overBaseline`, so evidence of
 * a slow run survives even when the verdict is a pass.
 */
function latencyBudgetMs(metric: Metric, agents: number): number {
  return CHANNEL_DELIVERY_LATENCY_BASELINE_MS[metric] * agents;
}

export function channelDeliveryLatencyViolations(diagnostics: Record<string, unknown>): string[] {
  const agents = concurrentTestAgents(diagnostics);
  const channel = diagnostics["channelDelivery"] as
    | { deliveryLifecycle?: { latencyHistogram?: unknown } }
    | undefined;
  const rows = channel?.deliveryLifecycle?.latencyHistogram;
  if (!channel) return [];
  if (!Array.isArray(rows)) return ["channel delivery latency histogram is unavailable"];
  const maximums = new Map<Metric, number>();
  const violations: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      violations.push("channel delivery latency histogram contains a malformed row");
      continue;
    }
    const metric = (row as { metric?: unknown }).metric;
    const maximum = (row as { maximum_ms?: unknown }).maximum_ms;
    if (typeof metric !== "string" || !(metric in CHANNEL_DELIVERY_LATENCY_BASELINE_MS)) continue;
    if (typeof maximum !== "number" || !Number.isFinite(maximum) || maximum < 0) {
      violations.push(`${metric}: invalid maximum_ms`);
      continue;
    }
    const typedMetric = metric as Metric;
    maximums.set(typedMetric, Math.max(maximums.get(typedMetric) ?? 0, maximum));
  }
  violations.push(
    ...[...maximums].flatMap(([metric, maximum]) => {
      const budget = latencyBudgetMs(metric, agents);
      if (maximum <= budget) return [];
      const baseline = CHANNEL_DELIVERY_LATENCY_BASELINE_MS[metric];
      return [
        agents > 1
          ? `${metric}: ${maximum}ms exceeds ${budget}ms budget ` +
            `(${baseline}ms baseline x ${agents} test agents sharing the instance)`
          : `${metric}: ${maximum}ms exceeds ${budget}ms baseline`,
      ];
    })
  );
  return violations;
}

export interface ChannelDeliveryLatencyBucket {
  upperBoundMs: number;
  samples: number;
  maximumMs: number;
}

export interface ChannelDeliveryLatencyMetric {
  metric: Metric;
  /** The isolated-run ceiling, before any contention allowance. */
  baselineMs: number;
  /** What was actually enforced: the baseline scaled by sharing agents. */
  budgetMs: number;
  maximumMs: number;
  samples: number;
  overBudget: boolean;
  /** Over the isolated ceiling, which a shared run may legitimately be. */
  overBaseline: boolean;
  buckets: ChannelDeliveryLatencyBucket[];
}

export interface ChannelDeliveryLatencySummary {
  violations: string[];
  metrics: ChannelDeliveryLatencyMetric[];
  /** Test agents sharing the instance while these spans were measured. */
  concurrentTestAgents: number;
}

/** The regression gate reports its verdict as prose. Bounded failure packets
 * need the histogram that produced it: whether a span sat in one bucket (a
 * fixed stall) or spread across several (contention) is the whole diagnosis,
 * and it is unrecoverable from the reason string alone. */
export function summarizeChannelDeliveryLatency(
  diagnostics: Record<string, unknown> | undefined
): ChannelDeliveryLatencySummary | null {
  if (!diagnostics || !diagnostics["channelDelivery"]) return null;
  const rows = (
    diagnostics["channelDelivery"] as {
      deliveryLifecycle?: { latencyHistogram?: unknown };
    }
  ).deliveryLifecycle?.latencyHistogram;
  const buckets = new Map<Metric, ChannelDeliveryLatencyBucket[]>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const { metric, upper_bound_ms, samples, maximum_ms } = row as Record<string, unknown>;
      if (typeof metric !== "string" || !(metric in CHANNEL_DELIVERY_LATENCY_BASELINE_MS)) continue;
      if (typeof maximum_ms !== "number" || !Number.isFinite(maximum_ms)) continue;
      const list = buckets.get(metric as Metric) ?? [];
      list.push({
        upperBoundMs: typeof upper_bound_ms === "number" ? upper_bound_ms : -1,
        samples: typeof samples === "number" ? samples : 0,
        maximumMs: maximum_ms,
      });
      buckets.set(metric as Metric, list);
    }
  }
  const agents = concurrentTestAgents(diagnostics);
  const metrics = [...buckets].map(([metric, rowsForMetric]) => {
    const ordered = [...rowsForMetric].sort((a, b) => a.upperBoundMs - b.upperBoundMs);
    const maximumMs = ordered.reduce((max, bucket) => Math.max(max, bucket.maximumMs), 0);
    const baselineMs = CHANNEL_DELIVERY_LATENCY_BASELINE_MS[metric];
    const budgetMs = latencyBudgetMs(metric, agents);
    return {
      metric,
      baselineMs,
      budgetMs,
      maximumMs,
      samples: ordered.reduce((total, bucket) => total + bucket.samples, 0),
      overBudget: maximumMs > budgetMs,
      overBaseline: maximumMs > baselineMs,
      buckets: ordered,
    };
  });
  metrics.sort((a, b) => a.metric.localeCompare(b.metric));
  return {
    violations: channelDeliveryLatencyViolations(diagnostics),
    metrics,
    concurrentTestAgents: agents,
  };
}
