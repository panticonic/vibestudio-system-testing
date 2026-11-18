import type { VcsClient } from "@workspace/runtime";
import type { VcsMergeSource, VcsStateNodeRef } from "@vibestudio/service-schemas/vcs";

type OracleClient = Pick<VcsClient, "status" | "readFile" | "compare" | "inspect">;
export type IntegrationOracleFixture = { contextId: string; source: VcsMergeSource; repositoryId: string; fileId: string; path: string; mainEventId: string; commonSeedEvent: VcsStateNodeRef; sourceChangeIds: string[]; baseline: Record<string, unknown>; required: Record<string, unknown> };

/** Harness-only: takes no teacher report, source edits, claimed head or claimed decision IDs. */
export async function verifyWorkspaceIntegration(vcs: OracleClient, fixture: IntegrationOracleFixture) {
  const status = await vcs.status({ contextId: fixture.contextId });
  const reasons: string[] = []; const evidence: unknown[] = [];
  if (status.mainEventId !== fixture.mainEventId) reasons.push("Protected main changed");
  const file = await vcs.readFile({ state: status.workingHead, repositoryId: fixture.repositoryId, file: { kind: "id", fileId: fixture.fileId } });
  evidence.push({kind:"file-readback",state:status.workingHead,file});
  if (!file || file.content.kind !== "text") reasons.push("Assigned text file absent");
  else {
    if (file.path !== fixture.path || file.repositoryId !== fixture.repositoryId) reasons.push("Assigned file placement changed");
    let candidate: unknown;
    try { candidate = JSON.parse(file.content.text); } catch { reasons.push("Candidate JSON invalid"); }
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) reasons.push("Candidate is not a JSON object");
    else {
      const expected = { ...fixture.baseline, ...fixture.required };
      const actual = candidate as Record<string, unknown>;
      if (Object.keys(actual).sort().join("\n") !== Object.keys(expected).sort().join("\n")) reasons.push("Unrequested keys added or removed");
      for (const [key, value] of Object.entries(expected)) if (JSON.stringify(actual[key]) !== JSON.stringify(value)) reasons.push(`Required or preserved field differs: ${key}`);
    }
  }
  const decisionIds = new Set<string>();
  const pages = async (cursor?: string, seen: string[] = []): Promise<void> => {
    const page = await vcs.compare({ target: status.workingHead, source: fixture.source, ...(cursor ? { cursor } : {}) });
    evidence.push(page);
    if (!page.resolution.complete || !page.resolution.concluded || page.resolution.remainingCoordinateCount !== 0) reasons.push("Source integration incomplete or unconcluded");
    for (const item of page.coordinates) if (item.decisionId) decisionIds.add(item.decisionId);
    if (page.nextCursor) {
      if (seen.includes(page.nextCursor)) throw new Error("Oracle comparison repeated a cursor");
      await pages(page.nextCursor, [...seen, page.nextCursor]);
    }
  };
  await pages();
  let assignedDecision = false;
  for (const decisionId of decisionIds) {
    const inspected = await vcs.inspect({ node: { kind: "decision", decisionId } });
    evidence.push(inspected);
    if (inspected.node.kind !== "decision") { reasons.push("Decision identity did not resolve to a decision"); continue; }
    const decision = inspected.node.value;
    if (JSON.stringify(decision.sourceState) !== JSON.stringify(fixture.source)) { reasons.push("Decision names another source"); continue; }
    if (decision.entries.some((entry) => entry.coordinate.kind === "file" && entry.coordinate.id === fixture.fileId && (entry.resolution === "composed" || entry.resolution === "current") && fixture.sourceChangeIds.length > 0 && fixture.sourceChangeIds.every((id) => entry.accountedSourceChangeIds.includes(id)))) assignedDecision = true;
  }
  if (!assignedDecision) reasons.push("No reachable composed/current decision accounts for assigned file");
  const final = await vcs.status({ contextId: fixture.contextId });
  if (JSON.stringify(final.workingHead) !== JSON.stringify(status.workingHead) || final.mainEventId !== fixture.mainEventId) reasons.push("State changed during independent verification");
  return { passed: reasons.length === 0, reasons, head: status.workingHead, evidence };
}
