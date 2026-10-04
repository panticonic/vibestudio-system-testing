import type { VcsClient } from "@workspace/runtime";
import type { VcsEditInput } from "@vibestudio/service-schemas/vcs";
import { serializeSystemTestError } from "./structured-error.js";

/** Control the exact command and basis at the public boundary, rather than
 * asking an agent to defeat its focused editing tools' ownership contract. */
export async function probeSemanticCommand(input: {
  vcs: Pick<VcsClient, "status" | "resolveRepository" | "readFile" | "edit">;
  contextId: string;
  repoPath: string;
  mode: "replay" | "stale";
}) {
  const { vcs, contextId } = input;
  const initial = await vcs.status({ contextId });
  const repository = await vcs.resolveRepository({ state: initial.workingHead, repoPath: input.repoPath });
  if (!repository) throw new Error("Semantic command probe has no fixture repository");
  const file = await vcs.readFile({ state: initial.workingHead, repositoryId: repository.repositoryId, file: { kind: "path", path: "README.md" } });
  if (!file || file.content.kind !== "text") throw new Error("Semantic command probe requires its exact text fixture");
  const original = file.content.text;
  const firstText = "\nsemantic-command-first\n";
  const secondText = "\nsemantic-command-second\n";
  const command = (head: VcsEditInput["expectedWorkingHead"], suffix: string, text: string, start: number): VcsEditInput => ({
    commandId: `system-test:semantic-command:${crypto.randomUUID()}:${suffix}`,
    contextId, expectedWorkingHead: head, intentSummary: "Verify the semantic command boundary",
    changes: [{ kind: "text-edit", repositoryId: repository.repositoryId, fileId: file.fileId, edits: [{ start, end: start, text }] }],
  });
  const firstRequest = command(initial.workingHead, "first", firstText, original.length);
  const first = await vcs.edit(firstRequest);
  if (first.commandId !== firstRequest.commandId || first.contextId !== contextId || first.changeCount !== 1)
    throw new Error("The first semantic response did not identify its exact command");
  const afterFirst = await vcs.status({ contextId });
  let second;
  let refusal;
  let afterRefusal;
  if (input.mode === "replay") {
    // Discarding the first response at the caller is precisely the uncertain
    // delivery scenario: submit the same immutable request, not a new edit.
    second = await vcs.edit(firstRequest);
  } else {
    try {
      await vcs.edit(command(initial.workingHead, "stale", secondText, original.length));
      throw new Error("A stale semantic edit was accepted");
    } catch (error) {
      refusal = serializeSystemTestError(error);
      if (refusal.code !== "RevisionChanged") throw error;
    }
    afterRefusal = await vcs.status({ contextId });
    if (JSON.stringify(afterRefusal.workingHead) !== JSON.stringify(afterFirst.workingHead) ||
        JSON.stringify(afterRefusal.workingCounts) !== JSON.stringify(afterFirst.workingCounts))
      throw new Error("The rejected stale command changed semantic working state");
    second = await vcs.edit(command(afterRefusal.workingHead, "fresh", secondText, original.length + firstText.length));
  }
  const final = await vcs.status({ contextId });
  const read = await vcs.readFile({ state: final.workingHead, repositoryId: repository.repositoryId, file: { kind: "id", fileId: file.fileId } });
  const expected = original + firstText + (input.mode === "stale" ? secondText : "");
  if (read?.content.kind !== "text" || read.content.text !== expected)
    throw new Error("The semantic command probe did not preserve exact expected content");
  const added = input.mode === "stale" ? 2 : 1;
  for (const key of ["applications", "workUnits", "changes"] as const) {
    if (final.workingCounts[key] !== initial.workingCounts[key] + added)
      throw new Error(`The semantic command probe produced an incorrect ${key} count`);
  }
  if (input.mode === "replay" && JSON.stringify(first) !== JSON.stringify(second))
    throw new Error("Replaying an exact command returned a different semantic result");
  return { protocol: "semantic-command-probe.v1" as const, mode: input.mode, contextId, path: `${input.repoPath}/README.md`, initial, first, afterFirst, second, refusal, afterRefusal, final, contentVerified: true };
}

export function validateSemanticCommandProbe(value: unknown, mode: "replay" | "stale") {
  if (!value || typeof value !== "object") return { passed: false, reason: "No harness-owned semantic command probe was captured" };
  const probe = value as Partial<Awaited<ReturnType<typeof probeSemanticCommand>>>;
  if (probe.protocol !== "semantic-command-probe.v1" || probe.mode !== mode ||
      probe.contentVerified !== true || !probe.initial || !probe.first || !probe.second || !probe.final ||
      probe.initial.contextId !== probe.contextId || probe.final.contextId !== probe.contextId)
    return { passed: false, reason: "The semantic command probe has incomplete native evidence" };
  const added = mode === "replay" ? 1 : 2;
  for (const key of ["applications", "workUnits", "changes"] as const)
    if (probe.final.workingCounts[key] !== probe.initial.workingCounts[key] + added)
      return { passed: false, reason: "The semantic command probe has duplicate or missing work" };
  if (mode === "replay" ? JSON.stringify(probe.first) !== JSON.stringify(probe.second) :
      probe.refusal?.code !== "RevisionChanged" || !probe.afterRefusal || !probe.afterFirst ||
      JSON.stringify(probe.afterRefusal.workingHead) !== JSON.stringify(probe.afterFirst.workingHead) ||
      JSON.stringify(probe.afterRefusal.workingCounts) !== JSON.stringify(probe.afterFirst.workingCounts))
    return { passed: false, reason: "The semantic command probe did not preserve replay or stale-refusal semantics" };
  return { passed: true };
}
