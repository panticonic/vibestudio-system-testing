import { withAuthoredExecutionLifecycle } from "../../skills/system-testing/authored-execution-lifecycle.js";
/** This boundary belongs to the harness source, before loading the assigned program. */
export const AUTHORED_START_BOUNDARY = "\n/* system-test:assigned-program-start */\n";

export class AuthoredLifecycles {
  private readonly runs = new Map<string, { runtimeId: string; started: boolean }>();
  register(runId: string, runtimeId: string): () => void {
    if (this.runs.has(runId)) throw new Error("Authored lifecycle already registered");
    const run = { runtimeId, started: false };
    this.runs.set(runId, run);
    return () => { if (this.runs.get(runId) === run) this.runs.delete(runId); };
  }
  start(runId: string, callerId: string | null): void {
    const run = this.runs.get(runId);
    if (!run || run.runtimeId !== callerId)
      throw new Error("Authored lifecycle belongs to another finite Eval");
    run.started = true;
  }
  evidence(runId: string) {
    const run = this.runs.get(runId);
    return run ? {
      schema: "vibestudio.authored-lifecycle/1" as const,
      runId,
      runtimeId: run.runtimeId,
      boundary: "assigned-program-load" as const,
      teacherStarted: run.started,
    } : undefined;
  }
}

export function instrumentAuthoredStart(source: string, startCode: string): string | null {
  const parts = source.split(AUTHORED_START_BOUNDARY);
  if (parts.length === 1) return null;
  if (parts.length !== 2) throw new Error("Expected one authored start boundary");
  return parts[0] + "\n" + startCode + "\n" + parts[1];
}

export function authoredLifecycleFailure(runs: AuthoredLifecycles, runId: string, error: unknown): unknown {
  const evidence = runs.evidence(runId);
  // Even an uninstrumented utility gets a trusted outer envelope. Otherwise a
  // guest-thrown errorData could impersonate a no-start witness at the reader.
  return withAuthoredExecutionLifecycle(error, evidence ?? null);
}

export function authoredHarnessSource(source: string, ownerId: string, runId: string): string | null {
  const instrumented = instrumentAuthoredStart(source,
    `await rpc.call(${JSON.stringify(ownerId)}, authoredLifecycleMethods.markAssignedProgramStarted, [${JSON.stringify(runId)}]);`);
  return instrumented === null ? null : `
    import {authoredLifecycleRpcMethods as authoredLifecycleMethods} from "@workspace-skills/system-testing/authored-execution-lifecycle";
    ${instrumented}
  `;
}
