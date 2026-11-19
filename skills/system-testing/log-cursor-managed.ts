import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { hostWorkerdLogTag } from "./log-audit-worlds.js";
import { managedLogCursorWorlds } from "./log-cursor-worlds.js";

type Cursor = { serverBootId: string; seq: number };
type Window = {
  saved: Cursor;
  liveBoot: string;
  latestSeq: number;
  throughSeq: number;
  overflow: boolean;
  snapshot: null | {
    records: { seq: number; tag?: string; message: string }[];
  };
};
type Services = { serverLogCursor: { observe(id: string): Promise<Window> } };
type Binder = (input: {
  goal: string;
  saved: Cursor;
  throughSeq: number;
  limit: number;
  tag: string;
  contains: string;
}) => { request: { operationId: string; goal: string }; services: Services };
type Report = {
  decision: { status: string; reason: string };
  liveBoot: string;
  latestSeq: number;
  next: { serverBootId: string; seq: number } | null;
  brief: null | {
    serverBootId: string;
    latestSeq: number;
    window: { fromSeq: number; toSeq: number; records: number };
    status: string;
    headline: string;
    findings: {
      class: string;
      tag?: string;
      message: string;
      count: number;
      firstSeq: number;
      lastSeq: number;
    }[];
  };
};
type Input = { contextId: string; caseId: string };
type Seed = { marker: string; boot: string; start: number; steps: number[] };

export function prepareManagedLogCursor(
  input: Input,
  seed: Seed,
  bindServerLogCursor: Binder,
) {
  const assigned = managedLogCursorWorlds.find(({ id }) => id === input.caseId);
  if (!assigned) throw new Error("Unknown saved log cursor case");
  const world = assigned;
  const saved = {
    serverBootId:
      world.kind === "reset-for-new-boot" ? `previous:${seed.boot}` : seed.boot,
    seq: seed.start,
  };
  const last = seed.steps.at(-1);
  if (last === undefined) throw new Error("No assigned host log was captured");
  const throughSeq = last;
  const bound = bindServerLogCursor({
    goal: world.goal,
    saved,
    throughSeq,
    limit: world.limit,
    tag: hostWorkerdLogTag,
    contains: seed.marker,
  });
  let observed: Window | undefined;
  const services: Services = {
    serverLogCursor: {
      async observe(id) {
        const record = await bound.services.serverLogCursor.observe(id);
        observed = structuredClone(record);
        return record;
      },
    },
  };

  function referenceBrief() {
    const snapshot = observed?.snapshot;
    if (world.kind !== "review-window" || !snapshot) return null;
    const [first] = snapshot.records;
    if (!first) return null;
    return {
      serverBootId: seed.boot,
      latestSeq: throughSeq,
      window: {
        fromSeq: seed.steps[0]!,
        toSeq: throughSeq,
        records: seed.steps.length,
      },
      status: "incident",
      headline: "The assigned index write failed repeatedly.",
      findings: [
        {
          class: "failure",
          tag: hostWorkerdLogTag,
          message: first.message.slice(0, 300),
          count: seed.steps.length,
          firstSeq: seed.steps[0]!,
          lastSeq: throughSeq,
        },
      ],
    };
  }

  function verify(report: Report | null) {
    const expected = referenceBrief();
    const checks = {
      cursor:
        !!observed &&
        observed.liveBoot === seed.boot &&
        observed.throughSeq === throughSeq &&
        observed.latestSeq >= throughSeq &&
        isDeepStrictEqual(observed.saved, saved) &&
        observed.overflow === (world.kind === "narrow-window"),
      raw:
        world.kind === "review-window"
          ? !!observed?.snapshot &&
            isDeepStrictEqual(
              observed.snapshot.records.map(({ seq }) => seq),
              seed.steps,
            ) &&
            observed.snapshot.records.every(
              ({ tag, message }, index) =>
                tag === hostWorkerdLogTag &&
                message.includes(seed.marker + " " + world.lines[index]),
            )
          : observed?.snapshot === null,
      outcome:
        !!observed &&
        report?.decision.status === world.kind &&
        !!report.decision.reason.trim() &&
        report.liveBoot === seed.boot &&
        report.latestSeq === observed.latestSeq &&
        isDeepStrictEqual(
          report.next,
          expected ? { serverBootId: seed.boot, seq: throughSeq } : null,
        ),
      brief: expected
        ? report?.brief?.status === expected.status &&
          report.brief.serverBootId === seed.boot &&
          report.brief.latestSeq === throughSeq &&
          isDeepStrictEqual(report.brief.window, expected.window) &&
          report.brief.findings.length === 1 &&
          expected.findings.every((finding) =>
            Object.entries(finding).every(
              ([key, value]) =>
                report.brief!.findings[0]![key as keyof typeof finding] ===
                value,
            ),
          )
        : report?.brief === null,
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId: input.contextId,
      caseId: input.caseId,
      request: bound.request,
      observed,
      seed,
      checks,
    };
  }

  async function qualify() {
    let rejectsForeignCursor = false;
    try {
      await services.serverLogCursor.observe("foreign-window");
    } catch (error) {
      rejectsForeignCursor =
        error instanceof Error && error.message.includes("assigned log window");
    }
    const window = await services.serverLogCursor.observe(
      bound.request.operationId,
    );
    const brief = referenceBrief();
    return {
      verification: verify({
        decision: {
          status: world.kind,
          reason: "Use the actual boot and covered sequence.",
        },
        liveBoot: window.liveBoot,
        latestSeq: window.latestSeq,
        next: brief
          ? { serverBootId: window.liveBoot, seq: window.throughSeq }
          : null,
        brief,
      }),
      rejectsForeignCursor,
    };
  }
  return { request: bound.request, services, verify, qualify };
}

type Prepared = ReturnType<typeof prepareManagedLogCursor>;
export interface ManagedLogCursorReceiver {
  runManagedLogCursorTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyManagedLogCursor(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedLogCursorMethods =
  createReceiverRpcMethods<ManagedLogCursorReceiver>([
    "runManagedLogCursorTeacher",
    "qualifyManagedLogCursor",
  ]);
