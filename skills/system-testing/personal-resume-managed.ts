import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { blobstore, contextId, fs, vcs } from "@workspace/runtime";
import type {
  PersonalRepoRequest,
  PersonalSetupRequest,
  PersonalWorkflowReport,
} from "../personal-workflows/types.js";
import { personalResumeWorlds } from "./personal-resume-worlds.js";

type Input = { caseId: string; contextId: string };
type Ports = {
  inspect(
    goal: string, repository: string, clean: boolean,
  ): Promise<PersonalRepoRequest>;
  resolve(goal: string, action: "setup" | "check"): Promise<PersonalSetupRequest>;
};

export async function preparePersonalResume(input: Input, ports: Ports) {
  const world = personalResumeWorlds.find(({ id }) => id === input.caseId);
  if (!world || input.contextId !== contextId)
    throw new Error("Unknown Personal repository assignment");

  const before = await vcs.status({ contextId });
  const operationId = crypto.randomUUID();
  const repository = `projects/personal-resume-${operationId}`;
  const path = "README.md";
  const initialText = "Assigned repository handoff.\n";
  const workingText = world.dirty ? initialText + "Draft handoff notes.\n" : initialText;
  const files = [{ path, contentHash: (await blobstore.putText(initialText)).digest, mode: 0o644 }];
  const imported = await vcs.importSnapshot({
    contextId,
    commandId: operationId,
    expectedWorkingHead: before.workingHead,
    intentSummary: "Seed the assigned repository for resumption",
    source: {
      kind: "generated",
      uri: `system-test://personal-resume/${operationId}`,
      snapshotRevision: sha256HexSyncText(JSON.stringify(files)),
    },
    repositories: [{ repoPath: repository, files }],
    message: "Seed the assigned Personal repository",
  });
  const [repositoryId] = imported.importedRepositoryIds;
  if (!repositoryId || imported.importedRepositoryIds.length !== 1)
    throw new Error("Repository resumption needs one assigned project");
  if (world.dirty) await fs.writeFile(`${repository}/${path}`, workingText);
  const start = await vcs.status({ contextId });
  if (start.clean === world.dirty || start.committed.eventId !== imported.eventId)
    throw new Error("The assigned worktree state was not established");

  const work = { goal: world.goal, operationId };
  const request = {
    goal: world.goal,
    work: [{ kind: "resumeRepositoryWork", input: work }],
  };
  let observedRepo: PersonalRepoRequest | undefined;
  let observedOwner: PersonalSetupRequest | undefined;
  let ownerAction: "setup" | "check" | null = null;
  const services = {
    repositoryResumeRead: {
      async inspect(id: string) {
        if (id !== operationId || observedRepo)
          throw new Error("Inspect the assigned repository once");
        const status = await vcs.status({ contextId });
        if (!isDeepStrictEqual(status.workingHead, start.workingHead))
          throw new Error("The assigned worktree changed before inspection");
        observedRepo = await ports.inspect(world.goal, repository, status.clean);
        return structuredClone(observedRepo);
      },
    },
    repositoryOwnerRead: {
      async resolve(id: string, action: "setup" | "check") {
        if (id !== operationId || !observedRepo || ownerAction || world.ownerAction !== action)
          throw new Error("Resolve only the assigned post-inspection owner action");
        ownerAction = action;
        observedOwner = await ports.resolve(world.goal, action);
        return structuredClone(observedOwner);
      },
    },
  };

  async function verify(report: PersonalWorkflowReport | null) {
    const final = await vcs.status({ contextId });
    const file = await vcs.readFile({
      state: final.workingHead, repositoryId, file: { kind: "path", path },
    });
    const [result] = report?.results ?? [];
    const resume = result?.kind === "resumeRepositoryWork" ? result.report : null;
    const selection = observedOwner?.selection;
    const checks = {
      observedRepository: observedRepo?.repository === repository &&
        observedRepo.workingTree === (world.dirty ? "dirty" : "clean") &&
        observedRepo.remoteVerified === null && observedRepo.upstream === "unknown" &&
        isDeepStrictEqual(observedRepo.availableAccess, []),
      repositoryPlan: report?.results.length === 1 &&
        resume?.repository.repository === repository &&
        resume.repository.operation === world.operation && resume.repository.access === world.access &&
        resume.repository.decision === world.decision && resume.repository.next.length > 0,
      ownerHandoff: world.ownerAction === "skip"
        ? resume?.owner === null && ownerAction === null && observedOwner === undefined
        : ownerAction === world.ownerAction && selection?.via === "owner-skill" &&
          selection.capabilityId === "connection.github" && selection.action === world.ownerAction &&
          selection.ownerSkillPath === "skills/github/SKILL.md" &&
          observedOwner?.capabilities.some(({ id, state }) =>
            id === selection.capabilityId && state === "not-configured") &&
          resume?.owner?.action === "follow-owner-route" &&
          resume.owner.routeId === selection.id && resume.owner.workspaceScope === "current" &&
          isDeepStrictEqual(resume.owner.capabilityIds, [selection.capabilityId]),
      worktreePreserved: final.mainEventId === before.mainEventId &&
        final.clean === start.clean && isDeepStrictEqual(final.workingHead, start.workingHead) &&
        file?.repoPath === repository && file.content.kind === "text" && file.content.text === workingText,
    };
    return {
      ...input, request, observedRepo, observedOwner: observedOwner ?? null, ownerAction,
      state: {
        main: before.mainEventId, finalMain: final.mainEventId,
        startingHead: start.workingHead, finalHead: final.workingHead,
        startClean: start.clean, finalClean: final.clean,
        finalFileHash: file?.content.kind === "text" ? sha256HexSyncText(file.content.text) : null,
        expectedFileHash: sha256HexSyncText(workingText),
      },
      checks, passed: Object.values(checks).every(Boolean),
    };
  }

  async function qualify() {
    await services.repositoryResumeRead.inspect(operationId);
    const setup = world.ownerAction === "skip"
      ? null : await services.repositoryOwnerRead.resolve(operationId, world.ownerAction);
    return verify({
      results: [{
        kind: "resumeRepositoryWork",
        report: {
          repository: {
            repository, operation: world.operation, access: world.access,
            decision: world.decision, facts: [], next: ["Follow the observed prerequisite."],
          },
          owner: setup ? {
            action: "follow-owner-route", capabilityIds: ["connection.github"],
            routeId: setup.selection?.id ?? null, workspaceScope: "current",
            unknownIds: [], brief: "Use the installed owner route.",
          } : null,
        },
      }],
      unresolved: [],
    });
  }
  return { request, services, verify, qualify };
}

type Prepared = Awaited<ReturnType<typeof preparePersonalResume>>;
export interface PersonalResumeReceiver {
  runPersonalResumeTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyPersonalResume(input: Input): ReturnType<Prepared["qualify"]>;
}
export const personalResumeMethods =
  createReceiverRpcMethods<PersonalResumeReceiver>(["runPersonalResumeTeacher", "qualifyPersonalResume"]);
