import { isDeepStrictEqual } from "node:util";
import type { VcsClient } from "@workspace/runtime";
import type {
  VcsMergeSource,
  VcsStateNodeRef,
} from "@vibestudio/service-schemas/vcs";

type OracleClient = Pick<
  VcsClient,
  "status" | "readFile" | "inspect"
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
  for (const entry of status.integrating) {
    if (isDeepStrictEqual(entry.source, fixture.source) &&
        (!entry.concluded || entry.remainingCoordinateCount !== 0)) {
      reasons.push("Source integration incomplete or unconcluded");
    }
  }
  // After a merge, its source is already an ancestor. Read the decisions
  // from the target's recorded work instead of attempting another comparison.
  let basis: VcsStateNodeRef | null = status.workingHead;
  while (basis && !isDeepStrictEqual(basis, fixture.commonSeedEvent)) {
    const key = basis.kind === "event" ? basis.eventId : basis.applicationId;
    if (seen.has(key)) throw new Error("Oracle target history contains a cycle");
    seen.add(key);
    const inspected = await vcs.inspect({ node: basis, edgeLimit: 1 });
    evidence.push(inspected);
    const { node } = inspected;
    if (node.kind === "application") {
      const work = await vcs.inspect({
        node: { kind: "work-unit", workUnitId: node.value.workUnitId },
        edgeLimit: 1,
      });
      evidence.push(work);
      if (work.node.kind !== "work-unit") throw new Error("Oracle target work unit is unavailable");
      for (const decisionId of work.node.value.decisionIds) decisionIds.add(decisionId);
      basis = node.value.basis;
    } else {
      if (node.kind !== "event") throw new Error("Oracle target event is unavailable");
      for (const decisionId of node.value.decisionIds) decisionIds.add(decisionId);
      const parent = node.value.parentEventIds[0];
      basis = parent ? { kind: "event", eventId: parent } : null;
    }
  }
  if (!basis) reasons.push("Target history does not reach the assigned common seed");

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
              entry.resolution === "current") &&
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
        `No reachable composed/current decision accounts for ${file.path}`,
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
