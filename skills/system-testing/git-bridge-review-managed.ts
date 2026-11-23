import { isDeepStrictEqual } from "node:util";
import { git, vcs } from "@workspace/runtime";
import { bindGitBridgeReview } from "@workspace-skills/git-bridge-review-bindings";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { managedGitBridgeReviewWorlds } from "./git-bridge-review-worlds.js";

type Services = ReturnType<typeof bindGitBridgeReview>["services"];
type View = Awaited<ReturnType<Services["gitBridgeReviewRead"]["observe"]>>;
type Report = {
  view: View;
  upstreamReview: null | { freshness: string; consequence: string };
  semanticReview: null | {
    source: { state: string; explanation: string };
    integration: {
      candidate: View["upstream"]["candidate"];
      explanation: string;
    };
  };
  next: string;
  reason: string;
};

export async function prepareManagedGitBridgeReview(
  contextId: string,
  caseId: string,
) {
  const scenario = managedGitBridgeReviewWorlds.find(({ id }) => id === caseId);
  if (!scenario) throw new Error("Unknown assigned Git Bridge review");
  const { goal, repository, direction, draft, source, next } = scenario;
  const bound = bindGitBridgeReview({ goal, repository, direction });
  const before = await vcs.status();
  const main = { kind: "event", eventId: before.mainEventId } as const;
  let observed: View | undefined;
  const services: Services = {
    gitBridgeReviewRead: {
      async observe(id) {
        const view = await bound.services.gitBridgeReviewRead.observe(id);
        observed = structuredClone(view);
        return view;
      },
    },
  };

  async function verify(report: Report | null) {
    const [after, rows, workingRepo, mainRepo] = await Promise.all([
      vcs.status(),
      git.upstreamStatus([repository]),
      vcs.resolveRepository({
        state: before.workingHead,
        repoPath: repository,
      }),
      vcs.resolveRepository({ state: main, repoPath: repository }),
    ]);
    const expectedPresent = source === "protected";
    const semantic = observed?.semantic;
    const upstream = observed?.upstream;
    const checks = {
      contextPreserved:
        before.contextId === contextId && isDeepStrictEqual(before, after),
      semantic:
        semantic?.contextId === contextId &&
        semantic.current &&
        semantic.clean === !draft &&
        before.clean === !draft &&
        semantic.mainEventId === before.mainEventId &&
        semantic.relation === "at" &&
        before.mainRelation === "at" &&
        isDeepStrictEqual(semantic.working, before.workingHead) &&
        !!workingRepo === expectedPresent &&
        !!mainRepo === expectedPresent &&
        semantic.mainRepositoryId === (mainRepo?.repositoryId ?? null) &&
        semantic.workingRepositoryId === (workingRepo?.repositoryId ?? null),
      upstream:
        rows.length === 1 &&
        rows[0]?.repoPath === repository &&
        rows[0].state === "local-only" &&
        observed?.repository === repository &&
        upstream?.state === rows[0].state &&
        upstream.autoPush === false &&
        upstream.remote === null &&
        upstream.branch === null &&
        upstream.candidate === null &&
        upstream.observation === null,
      report:
        !!observed &&
        isDeepStrictEqual(report?.view, observed) &&
        report?.next === next &&
        report.upstreamReview?.freshness === "absent" &&
        !!report.upstreamReview.consequence.trim() &&
        report.semanticReview?.source.state === source &&
        !!report.semanticReview.source.explanation.trim() &&
        report.semanticReview.integration.candidate === null &&
        !!report.reason.trim(),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId,
      caseId,
      request: bound.request,
      observed,
      checks,
    };
  }

  async function qualify() {
    let rejectsOtherRepository = false;
    try {
      await services.gitBridgeReviewRead.observe("other-bridge-assignment");
    } catch (error) {
      rejectsOtherRepository =
        error instanceof Error &&
        error.message.includes("assigned Git Bridge repository");
    }
    const view = await services.gitBridgeReviewRead.observe(
      bound.request.operationId,
    );
    return {
      verification: await verify({
        view,
        upstreamReview: {
          freshness: "absent",
          consequence: "The bridge returned local-only.",
        },
        semanticReview: {
          source: {
            state: source,
            explanation: "Checked the working and protected repository.",
          },
          integration: {
            candidate: null,
            explanation: "The upstream supplied no import candidate.",
          },
        },
        next,
        reason: "Checked the exact repository and protected-main basis.",
      }),
      rejectsOtherRepository,
    };
  }
  return { request: bound.request, services, verify, qualify };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedGitBridgeReview>>;
type Input = { contextId: string; caseId: string };
export interface ManagedGitBridgeReviewReceiver {
  runManagedGitBridgeReviewTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedGitBridgeReview(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedGitBridgeReviewMethods =
  createReceiverRpcMethods<ManagedGitBridgeReviewReceiver>([
    "runManagedGitBridgeReviewTeacher",
    "qualifyManagedGitBridgeReview",
  ]);
