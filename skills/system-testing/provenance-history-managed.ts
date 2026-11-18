import type { VcsClient } from "@workspace/runtime";
import {
  managedProvenanceHistoryWorlds,
  type ProvenanceHistoryCheck,
} from "./provenance-history-worlds.js";

type Report = {
  kind: "live-history";
  constraint?: { status: string; evidence: string[] };
  findings: {
    check: ProvenanceHistoryCheck;
    status: string;
    evidence: string[];
  }[];
};
type Ports = Pick<
  VcsClient,
  "status" | "resolveRepository" | "readFile" | "walk"
>;

export async function prepareManagedProvenanceHistory(
  vcs: Ports,
  contextId: string,
  repoPath: string,
  caseId: string,
) {
  const world = managedProvenanceHistoryWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown managed provenance history case");
  const baseline = await vcs.status({ contextId });
  if (!baseline.clean)
    throw new Error("Provenance review requires a clean fixture");
  const { workingHead } = baseline;
  const repository = await vcs.resolveRepository({
    state: workingHead,
    repoPath,
  });
  if (!repository) throw new Error("Owned provenance repository is missing");
  const { repositoryId } = repository;
  const request = {
    kind: "live-history" as const,
    goal: world.goal,
    checks: world.checks,
    ...(world.constraint
      ? { proposedProperty: world.constraint.proposedProperty }
      : {}),
  };
  let pending = false;
  const sources = new Map<string, string>();
  function sourceRef(node: unknown) {
    const key = JSON.stringify(node);
    const existing = sources.get(key);
    if (existing) return existing;
    const id = `source:${sources.size + 1}`;
    sources.set(key, id);
    return id;
  }

  async function observe(check: ProvenanceHistoryCheck, index: number) {
    const file = await vcs.readFile({
      state: workingHead,
      repositoryId,
      file: { kind: "path", path: check.path },
    });
    const fileId = file?.fileId ?? null;
    const walk = fileId
      ? await vcs.walk({
          contextId,
          walk: check.walk,
          scope: check.scope,
          limit: 40,
          subject: { kind: "file", state: workingHead, repositoryId, fileId },
        })
      : null;
    if (
      walk &&
      (walk.walk !== check.walk ||
        walk.subject.kind !== "file" ||
        walk.subject.fileId !== fileId ||
        walk.subject.repositoryId !== repositoryId)
    )
      throw new Error(
        "The returned provenance does not match the assigned file",
      );
    const entries = walk?.entries ?? [];
    const receipt = {
      check,
      exists: file !== null,
      limited:
        !!walk?.nextCursor ||
        Boolean(walk?.omitted.length) ||
        entries.some(({ boundary }) => boundary === "outside-visibility"),
      records: entries.map(
        ({ node, label, intent, group, detail, boundary }, item) => ({
          ref: `history:${index + 1}:${item + 1}`,
          source: sourceRef(node),
          label,
          detail: detail ?? null,
          intent: intent?.text ?? null,
          tier: intent?.tier ?? null,
          group: group ?? null,
          boundary: boundary ?? null,
        }),
      ),
    };
    return { receipt, walk, fileId };
  }
  const readbacks: Awaited<ReturnType<typeof observe>>[] = [];
  async function readNext(check: ProvenanceHistoryCheck) {
    const index = readbacks.length;
    const allowed = request.checks[index];
    if (
      pending ||
      !allowed ||
      allowed.path !== check.path ||
      allowed.walk !== check.walk ||
      allowed.scope !== check.scope
    )
      throw new Error("Read only the next assigned VCS walk");
    pending = true;
    try {
      const read = await observe(allowed, index);
      readbacks.push(read);
      return structuredClone(read.receipt);
    } finally {
      pending = false;
    }
  }

  function constraintReference(): Report["constraint"] {
    const expected = world?.constraint;
    if (!expected) return undefined;
    const records = readbacks.flatMap(({ receipt }) => receipt.records);
    const match = records.find((record) => {
      if (expected.evidence === "retry-counteraction")
        return (
          record.group === "counteractions" &&
          /300 seconds/iu.test(record.detail ?? "") &&
          /staging cut the link/iu.test(record.intent ?? "")
        );
      if (expected.evidence === "policy")
        return /Cap the retry backoff at 30 seconds/iu.test(
          record.intent ?? "",
        );
      if (expected.evidence === "cache")
        return /Cache the upstream feed for 900 seconds/iu.test(
          record.intent ?? "",
        );
      return false;
    });
    if (expected.evidence !== "none" && !match)
      throw new Error(
        "The proposed change lacks its assigned recorded evidence",
      );
    return { status: expected.status, evidence: match ? [match.ref] : [] };
  }

  function reference(): Report {
    return {
      kind: "live-history",
      ...(request.proposedProperty
        ? { constraint: constraintReference() }
        : {}),
      findings: readbacks.map(({ receipt }) => ({
        check: receipt.check,
        status: !receipt.exists
          ? "coordinate-absent"
          : receipt.limited
            ? "limited"
            : receipt.records.length
              ? "recorded"
              : "none-visible",
        evidence: receipt.records.map(({ ref }) => ref),
      })),
    };
  }

  async function verify(report: Report | null) {
    const after = await vcs.status({ contextId });
    const expected = reference();
    const checks = {
      constraint: expected.constraint
        ? report?.constraint?.status === expected.constraint.status &&
          JSON.stringify(report.constraint.evidence) ===
            JSON.stringify(expected.constraint.evidence)
        : report?.constraint === undefined,
      unchanged:
        after.clean &&
        JSON.stringify(after.workingHead) === JSON.stringify(workingHead),
      exactReads: readbacks.length === request.checks.length,
      history: readbacks.every(({ receipt, walk, fileId }) => {
        const { check } = receipt;
        if (check.path === "src/retired-ingress.ts")
          return fileId === null && walk === null;
        if (!fileId || !walk) return false;
        if (check.walk === "rejections") {
          return check.path === "src/retry-policy.ts"
            ? walk.entries.some(
                (entry) =>
                  entry.group === "counteractions" &&
                  /staging|cut the link/iu.test(entry.intent?.text ?? ""),
              )
            : walk.entries.length === 0;
        }
        return true;
      }),
      report:
        report?.kind === "live-history" &&
        report.findings.length === expected.findings.length &&
        expected.findings.every(({ check, status, evidence }, index) => {
          const finding = report.findings[index];
          return (
            finding?.status === status &&
            finding.check?.path === check.path &&
            finding.check.walk === check.walk &&
            finding.check.scope === check.scope &&
            JSON.stringify(finding.evidence) === JSON.stringify(evidence)
          );
        }),
    };
    return {
      caseId,
      contextId,
      repoPath,
      repositoryId,
      workingHead,
      readbacks,
      ...(expected.constraint
        ? {
            property: request.proposedProperty,
            constraint: expected.constraint,
          }
        : {}),
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  return { request, service: { readNext }, reference, verify };
}
