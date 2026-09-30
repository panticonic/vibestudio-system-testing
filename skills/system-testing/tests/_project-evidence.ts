import type { TestExecutionResult } from "../types.js";
import { getToolCalls } from "./_helpers.js";
import { walkRecords } from "./_scenario-evidence.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Preparation is context-local evidence, never publication evidence. */
export function preparedProject(
  record: Record<string, unknown>,
  kind: string,
): boolean {
  const preparation = record["preparation"];
  const preflight = record["preflight"];
  const sections: Record<string, string> = {
    panel: "panels",
    worker: "workers",
    package: "packages",
    skill: "skills",
    project: "projects",
  };
  return (
    typeof record["created"] === "string" &&
    record["created"].startsWith(`${sections[kind]}/`) &&
    isRecord(preflight) &&
    preflight["ok"] === true &&
    preflight["projectType"] === kind &&
    isRecord(preparation) &&
    preparation["protocol"] === "project-preparation.v1" &&
    typeof preparation["contextId"] === "string" &&
    isRecord(preparation["workingHead"]) &&
    preparation["workingHead"]["kind"] === "application" &&
    typeof preparation["workingHead"]["applicationId"] === "string" &&
    preparation["publication"] === "unchanged" &&
    preparation["liveRuntime"] === "unchanged"
  );
}

/** Join the prepared application to a real commit and its exact protected push.
 * Accept tool or eval receipts, including multiple operations in one eval.
 */
export function publishedPreparation(
  result: TestExecutionResult,
  prepared: Record<string, unknown>,
): boolean {
  const preparation = prepared["preparation"];
  if (!isRecord(preparation) || !isRecord(preparation["workingHead"]))
    return false;
  const applicationId = preparation["workingHead"]["applicationId"];
  const contextId = preparation["contextId"];
  return publishedCommits(result).some(
    (commit) =>
      commit["contextId"] === contextId &&
      Array.isArray(commit["committedApplicationIds"]) &&
      commit["committedApplicationIds"].includes(applicationId),
  );
}

/** A local commit consumes the reviewed application without publishing it. */
export function committedPreparation(
  result: TestExecutionResult,
  prepared: Record<string, unknown>,
): boolean {
  const preparation = prepared["preparation"];
  if (!isRecord(preparation) || !isRecord(preparation["workingHead"]))
    return false;
  const applicationId = preparation["workingHead"]["applicationId"];
  return getToolCalls(result).some(
    (call) =>
      call.execution?.status === "complete" &&
      call.execution.isError !== true &&
      walkRecords([call.execution.result]).some(
        (commit) =>
          commit["contextId"] === preparation["contextId"] &&
          isRecord(commit["event"]) &&
          commit["event"]["kind"] === "event" &&
          typeof commit["event"]["eventId"] === "string" &&
          Array.isArray(commit["committedApplicationIds"]) &&
          commit["committedApplicationIds"].includes(applicationId),
      ),
  );
}

/** Publication is independently observable, even when the author projects a
 * preparation result or creates source through ordinary managed edits. */
export function publishedCommits(
  result: TestExecutionResult,
): Record<string, unknown>[] {
  const records = getToolCalls(result).flatMap((call) =>
    call.execution?.status === "complete" && call.execution.isError !== true
      ? walkRecords([call.execution.result])
      : [],
  );
  return records.filter((commit, commitIndex) => {
    const event = commit["event"];
    if (
      typeof commit["contextId"] !== "string" ||
      !isRecord(event) ||
      event["kind"] !== "event" ||
      typeof event["eventId"] !== "string" ||
      !Array.isArray(commit["committedApplicationIds"])
    )
      return false;
    return records
      .slice(commitIndex + 1)
      .some(
        (push) =>
          typeof push["effectId"] === "string" &&
          push["contextId"] === commit["contextId"] &&
          push["eventId"] === event["eventId"] &&
          push["mainEventId"] === event["eventId"],
      );
  });
}
