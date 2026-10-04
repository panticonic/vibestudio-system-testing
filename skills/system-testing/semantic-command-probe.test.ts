import { describe, expect, it } from "vitest";
import type { VcsClient } from "@workspace/runtime";
import type { VcsEditInput } from "@vibestudio/service-schemas/vcs";
import { probeSemanticCommand, validateSemanticCommandProbe } from "./semantic-command-probe.js";

function fixture(defect?: "duplicate" | "mutated-refusal" | "wrong-failure") {
  let text = "Fixture\n", count = 0;
  const results = new Map<string, unknown>();
  const head = () => count ? { kind: "application", applicationId: `application:${count}` } : { kind: "event", eventId: "event:initial" };
  const vcs = {
    status: async () => ({ contextId: "context:fixture", workingHead: head(), workingCounts: { applications: count, workUnits: count, changes: count } }),
    resolveRepository: async () => ({ repositoryId: "repository:fixture" }),
    readFile: async () => ({ fileId: "file:readme", content: { kind: "text", text } }),
    edit: async (request: VcsEditInput) => {
      if (results.has(request.commandId) && defect !== "duplicate") return results.get(request.commandId);
      if (JSON.stringify(request.expectedWorkingHead) !== JSON.stringify(head())) {
        if (defect === "duplicate") { count++; return results.get(request.commandId); }
        if (defect === "mutated-refusal") count++;
        throw { name: "RemoteRpcError", message: "The basis advanced", code: defect === "wrong-failure" ? "AccessDenied" : "RevisionChanged" };
      }
      const change = request.changes[0]!;
      if (change.kind !== "text-edit") throw new Error("Unexpected fixture operation");
      const edit = change.edits[0]!;
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
      count++;
      const result = { commandId: request.commandId, contextId: request.contextId, changeCount: 1, applicationId: `application:${count}`, workUnitId: `work:${count}`, workingHead: head() };
      results.set(request.commandId, result);
      return result;
    },
  } as unknown as Pick<VcsClient, "status" | "resolveRepository" | "readFile" | "edit">;
  return { vcs, contextId: "context:fixture", repoPath: "projects/fixture" };
}

describe("harness-owned semantic command probes", () => {
  it("replays one exact request with one terminal result and one authored application", async () => {
    const probe = await probeSemanticCommand({ ...fixture(), mode: "replay" });
    expect(probe.second).toEqual(probe.first);
    expect(probe.final.workingCounts.applications).toBe(1);
    expect(validateSemanticCommandProbe(probe, "replay")).toEqual({ passed: true });
  });
  it("rejects a duplicate semantic application even if replay returns the original result", async () => {
    await expect(probeSemanticCommand({ ...fixture("duplicate"), mode: "replay" })).rejects.toThrow("incorrect applications count");
  });
  it("proves stale refusal is effect-free and recovers through a newly observed basis", async () => {
    const probe = await probeSemanticCommand({ ...fixture(), mode: "stale" });
    expect(probe.refusal?.code).toBe("RevisionChanged");
    expect(probe.final.workingCounts.applications).toBe(2);
    expect(validateSemanticCommandProbe(probe, "stale")).toEqual({ passed: true });
    expect(validateSemanticCommandProbe({ ...probe, afterRefusal: probe.final }, "stale").passed).toBe(false);
  });
  it("rejects a stale refusal that changed native state", async () => {
    await expect(probeSemanticCommand({ ...fixture("mutated-refusal"), mode: "stale" })).rejects.toThrow("rejected stale command changed");
  });
  it("propagates an unrelated original failure instead of treating it as a stale race", async () => {
    await expect(probeSemanticCommand({ ...fixture("wrong-failure"), mode: "stale" })).rejects.toMatchObject({ code: "AccessDenied" });
  });
  it("rejects an unobserved guest claim or the wrong probe kind", async () => {
    expect(validateSemanticCommandProbe({ contentVerified: true }, "replay").passed).toBe(false);
    const probe = await probeSemanticCommand({ ...fixture(), mode: "replay" });
    expect(validateSemanticCommandProbe(probe, "stale").passed).toBe(false);
    expect(validateSemanticCommandProbe({ ...probe, second: { ...probe.second, applicationId: "application:other" } }, "replay").passed).toBe(false);
  });
});
