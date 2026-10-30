/** Triage every failed test of a run, reading the run's record through the systemTests service. */
import { systemTests } from "natlang:services";
import triage from "./triage.js";
import type { Failure, RunPacket, Triage } from "../types.js";

export default async function run(
  runnerTargetId: string,
  runId: string,
): Promise<{ test: string; triage: Triage }[]> {
  const packet = (await systemTests.inspect(
    runnerTargetId,
    runId,
  )) as RunPacket;
  const out: { test: string; triage: Triage }[] = [];
  for (const test of packet.failedTests) {
    const failure = (await systemTests.inspect(
      runnerTargetId,
      runId,
      test,
    )) as Failure;
    out.push({ test, triage: await triage(failure) });
  }
  return out;
}
