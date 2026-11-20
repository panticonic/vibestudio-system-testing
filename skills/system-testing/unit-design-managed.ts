import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { contextId, vcs } from "@workspace/runtime";
import { bindExtensionDesign } from "@workspace-skills/extensiondev/unit-design";
import type { LiveExtensionDesignEvidence, UnitFinding, UnitReview } from "../workspace-unit-design/types.js";
import { managedUnitDesignWorlds } from "./unit-design-worlds.js";

type Input = { contextId: string; caseId: string };

export async function prepareManagedUnitDesign(input: Input) {
  const assigned = managedUnitDesignWorlds.find(({ id }) => id === input.caseId);
  if (!assigned || input.contextId !== contextId)
    throw new Error("Unknown assigned extension design");
  const world = assigned;
  const start = await vcs.status({ contextId });
  async function manifest(state: typeof start.workingHead) {
    const repo = await vcs.resolveRepository({ state, repoPath: world.source });
    const file = repo && await vcs.readFile({
      state, repositoryId: repo.repositoryId, file: { kind: "path", path: "package.json" },
    });
    if (!repo || file?.content.kind !== "text") throw new Error("The assigned extension manifest is missing");
    return { repo, file, text: file.content.text };
  }
  if (world.mode !== "published") {
    const { repo, file, text } = await manifest(start.workingHead);
    const candidate = JSON.parse(text);
    if (world.mode === "invalid-local") candidate.vibestudio.icon = "not a valid icon";
    else candidate.vibestudio.extension.activationEvents = ["*"];
    await vcs.edit({
      contextId, expectedWorkingHead: start.workingHead, commandId: crypto.randomUUID(),
      intentSummary: "Stage the assigned extension manifest for review",
      changes: [{
        kind: "content-replace", repositoryId: repo.repositoryId, fileId: file.fileId,
        content: { kind: "text", text: JSON.stringify(candidate, null, 2) + "\n" },
      }],
    });
  }
  const current = await vcs.status({ contextId });
  const [working, published] = await Promise.all([
    manifest(current.workingHead),
    manifest({ kind: "event", eventId: start.mainEventId }),
  ]);
  const bound = bindExtensionDesign({ contextId, ...world });
  let observation: LiveExtensionDesignEvidence | undefined;
  const services = {
    extensionDesignRead: {
      async inspect(id: string) {
        observation = await bound.services.extensionDesignRead.inspect(id);
        return structuredClone(observation);
      },
    },
  };
  function reference(): UnitReview {
    const invalid = world.mode === "invalid-local";
    const live = world.mode === "published";
    const { operationId } = bound.request;
    const workingId = `${operationId}:working`;
    const publishedId = `${operationId}:published`;
    const components: UnitFinding[] = [
      { decision: invalid ? "revision-needed" : "ready",
        finding: invalid ? "MANIFEST_ICON" : "manifest-verified", evidenceIds: [workingId] },
      { decision: "ready", finding: "manifest-verified", evidenceIds: [publishedId] },
      { decision: live ? "ready" : "waiting",
        finding: live ? "manifest-published" : "manifest-not-published", evidenceIds: [workingId, publishedId] },
    ];
    return {
      decision: invalid ? "revision-needed" : live ? "ready" : "waiting",
      finding: invalid ? "required-revision" : live ? "prerequisites-verified" : "pending-lifecycle",
      evidenceIds: [workingId, publishedId], components,
    };
  }
  async function verify(report: UnitReview | null) {
    const after = await vcs.status({ contextId });
    const workingRevision =
      current.workingHead.kind === "event" ? current.workingHead.eventId : current.workingHead.applicationId;
    const checks = {
      revision: observation?.contextId === contextId && observation.workingRevision === workingRevision &&
        observation.mainRevision === start.mainEventId && current.clean === (world.mode === "published"),
      manifests: observation?.working.source === world.source && observation.published.source === world.source &&
        observation.working.candidateDigest === working.file.contentHash &&
        observation.published.candidateDigest === published.file.contentHash &&
        (working.file.contentHash === published.file.contentHash) === (world.mode === "published") &&
        observation.working.receipt?.errorCode === (world.mode === "invalid-local" ? "MANIFEST_ICON" : null) &&
        observation.published.receipt?.errorCode === null,
      preserved: after.mainEventId === start.mainEventId && isDeepStrictEqual(after.workingHead, current.workingHead),
      outcome: isDeepStrictEqual(report, reference()),
    };
    return {
      ...input, request: bound.request, observation,
      checks, passed: Object.values(checks).every(Boolean),
    };
  }
  return {
    request: bound.request, services, verify,
    async qualify() {
      await services.extensionDesignRead.inspect(bound.request.operationId);
      return verify(reference());
    },
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedUnitDesign>>;
type Verification = ReturnType<Prepared["verify"]>;
export interface ManagedUnitDesignReceiver {
  runManagedUnitDesignTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: Awaited<Verification>;
  }>;
  qualifyManagedUnitDesign(input: Input): Verification;
}
export const managedUnitDesignMethods =
  createReceiverRpcMethods<ManagedUnitDesignReceiver>(["runManagedUnitDesignTeacher", "qualifyManagedUnitDesign"]);
