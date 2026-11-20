import { isDeepStrictEqual } from "node:util";
import type { VcsClient } from "@workspace/runtime";
import type {
  VcsMergeSource,
  VcsStateNodeRef,
} from "@vibestudio/service-schemas/vcs";

type OracleClient = Pick<
  VcsClient,
  "status" | "readFile" | "compare" | "inspect"
>;
export type IntegrationOracleFixture = {
  contextId: string;
  source: VcsMergeSource;
  repositoryId: string;
  mainEventId: string;
  commonSeedEvent: VcsStateNodeRef;
  files: {
    fileId: string;
    path: string;
    sourceChangeIds: string[];
    expected: Record<string, unknown>;
  }[];
};

/** Harness-only: takes no teacher report, source edits, claimed head or claimed decision IDs. */
export async function verifyWorkspaceIntegration(
  vcs: OracleClient,
  fixture: IntegrationOracleFixture,
) {
  const status = await vcs.status({ contextId: fixture.contextId });
  const reasons: string[] = [];
  const evidence: unknown[] = [];
  const verifiedFiles: string[] = [];
  if (status.mainEventId !== fixture.mainEventId)
    reasons.push("Protected main changed");
  for (const assigned of fixture.files) {
    const file = await vcs.readFile({
      state: status.workingHead,
      repositoryId: fixture.repositoryId,
      file: { kind: "id", fileId: assigned.fileId },
    });
    evidence.push({ kind: "file-readback", state: status.workingHead, file });
    if (!file || file.content.kind !== "text") {
      reasons.push(`Assigned text file absent: ${assigned.path}`);
      continue;
    }
    if (
      file.path !== assigned.path ||
      file.repositoryId !== fixture.repositoryId ||
      file.fileId !== assigned.fileId
    ) {
      reasons.push(
        `Assigned file identity or placement changed: ${assigned.path}`,
      );
      continue;
    }
    try {
      const candidate: unknown = JSON.parse(file.content.text);
      if (isDeepStrictEqual(candidate, assigned.expected))
        verifiedFiles.push(assigned.path);
      else
        reasons.push(`Required or preserved fields differ: ${assigned.path}`);
    } catch {
      reasons.push(`Candidate JSON invalid: ${assigned.path}`);
    }
  }

  const decisionIds = new Set<string>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await vcs.compare({
      target: status.workingHead,
      source: fixture.source,
      ...(cursor ? { cursor } : {}),
    });
    evidence.push(page);
    if (
      !page.resolution.complete ||
      !page.resolution.concluded ||
      page.resolution.remainingCoordinateCount !== 0
    )
      reasons.push("Source integration incomplete or unconcluded");
    for (const item of page.coordinates)
      if (item.decisionId) decisionIds.add(item.decisionId);
    cursor = page.nextCursor ?? undefined;
    if (cursor) {
      if (seen.has(cursor))
        throw new Error("Oracle comparison repeated a cursor");
      seen.add(cursor);
    }
  } while (cursor);

  const accountedFiles = new Set<string>();
  for (const decisionId of decisionIds) {
    const inspected = await vcs.inspect({
      node: { kind: "decision", decisionId },
    });
    evidence.push(inspected);
    if (inspected.node.kind !== "decision") {
      reasons.push("Decision identity did not resolve to a decision");
      continue;
    }
    const decision = inspected.node.value;
    if (!isDeepStrictEqual(decision.sourceState, fixture.source)) {
      reasons.push("Decision names another source");
      continue;
    }
    for (const file of fixture.files) {
      if (
        decision.entries.some(
          (entry) =>
            entry.coordinate.kind === "file" &&
            entry.coordinate.id === file.fileId &&
            (entry.resolution === "composed" ||
              entry.resolution === "current" ||
              entry.resolution === "convergent") &&
            file.sourceChangeIds.length > 0 &&
            file.sourceChangeIds.every((id) =>
              entry.accountedSourceChangeIds.includes(id),
            ),
        )
      )
        accountedFiles.add(file.fileId);
    }
  }
  for (const file of fixture.files)
    if (!accountedFiles.has(file.fileId))
      reasons.push(
        `No reachable composed, current, or convergent decision accounts for ${file.path}`,
      );

  const final = await vcs.status({ contextId: fixture.contextId });
  if (
    !isDeepStrictEqual(final.workingHead, status.workingHead) ||
    final.mainEventId !== fixture.mainEventId
  )
    reasons.push("State changed during independent verification");
  return {
    passed: reasons.length === 0,
    reasons,
    head: status.workingHead,
    verificationPaths: verifiedFiles,
    evidence,
  };
}
