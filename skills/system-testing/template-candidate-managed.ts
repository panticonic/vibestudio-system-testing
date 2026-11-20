import { isDeepStrictEqual } from "node:util";
import { randomBytes } from "node:crypto";
import { contextId, extensions, vcs } from "@workspace/runtime";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import {
  templateUpdateReviewSchema,
  templateUpdateStatusSchema,
  type TemplatesClient,
} from "@vibestudio/service-schemas/templates";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { bindTemplateCandidate } from "@workspace-skills/template-candidate-bindings";
import type {
  CandidateOffer,
  CandidateReport,
  CandidateRequest,
  CandidateState,
  StageReceipt,
} from "../template-candidate/types.js";
import { templateCandidateManagedWorlds } from "./template-candidate-worlds.js";

type Input = { contextId: string; caseId: string };
const unit = "@workspace-extensions/templates";
const examplesSource =
  "git+https://github.com/panticonic/vibestudio-template-examples.git";
const baseSource = "git+https://github.com/panticonic/vibestudio-base.git";

export async function prepareManagedTemplateCandidate(input: Input) {
  const assignment = templateCandidateManagedWorlds.find(
    ({ id }) => id === input.caseId,
  );
  if (!assignment || input.contextId !== contextId)
    throw new Error("Unknown native template candidate assignment");
  const historical = "workspaceBaseline" in assignment;
  const staging = assignment.status === "validate-candidate";
  const baseline = await vcs.status({ contextId });
  const discovery = templateUpdateStatusSchema.parse(
    await extensions.invoke(unit, "checkUpdates", []),
  );
  const before = discovery.checks.find(
    ({ source }) => source.url === (historical ? examplesSource : baseSource),
  );
  if (
    !before?.target ||
    before.status !== (historical ? "available" : "current") ||
    (before.source.commit !== before.target.commit) !== historical ||
    before.target.url !== before.source.url
  ) {
    throw new Error(
      "The local template discovery did not establish the assigned exact offer",
    );
  }

  const request: CandidateRequest = {
    goal: assignment.goal,
    intent: assignment.intent,
    sourceUrl: before.source.url,
    installedCommit: before.source.commit,
    incomingCommit:
      assignment.status === "target-changed"
        ? randomBytes(20).toString("hex")
        : before.target.commit,
    checkedAfterMs: before.checkedAt + Number(assignment.status === "refresh"),
    commandId: crypto.randomUUID(),
  };
  const expected: CandidateOffer = {
    installedCommit: before.source.commit,
    incomingCommit: before.target.commit,
    status: before.status,
    checkedAt: before.checkedAt,
    workspaceAppVersion: discovery.workspaceAppVersion,
    currentAppVersion: discovery.currentAppVersion,
    targetAppVersion: before.targetAppVersion ?? null,
    minimumAppVersion: before.targetMinimumAppVersion ?? null,
    hostUnavailable: Boolean(before.hostError),
  };

  const native: Pick<
    TemplatesClient,
    "updateStatus" | "prepareUpdate" | "reviewUpdate"
  > = {
    async updateStatus() {
      return templateUpdateStatusSchema.parse(
        await extensions.invoke(unit, "updateStatus", []),
      );
    },
    async prepareUpdate(params) {
      return templateUpdateReviewSchema.parse(
        await extensions.invoke(unit, "prepareUpdate", [params]),
      );
    },
    async reviewUpdate(params) {
      return templateUpdateReviewSchema.parse(
        await extensions.invoke(unit, "reviewUpdate", [params]),
      );
    },
  };
  const bound = bindTemplateCandidate(
    native,
    async () => (await vcs.status({ contextId })).mainEventId,
    request,
  );
  const reads: (CandidateOffer | null)[] = [];
  const preparations: StageReceipt[] = [];
  const reviews: (CandidateState | null)[] = [];
  const services = {
    templateOffer: {
      async read() {
        const offer = await bound.templateOffer.read();
        reads.push(structuredClone(offer));
        return offer;
      },
    },
    templateCandidatePrepare: {
      async prepare() {
        const receipt = await bound.templateCandidatePrepare.prepare();
        preparations.push(structuredClone(receipt));
        return receipt;
      },
    },
    templateCandidateReview: {
      async read() {
        const state = await bound.templateCandidateReview.read();
        reviews.push(structuredClone(state));
        return state;
      },
    },
  };
  function reference(): CandidateReport {
    return {
      status: assignment.status,
      offer: expected,
      operationId: staging ? request.commandId : null,
      candidate: staging ? (reviews[0]?.review ?? null) : null,
    };
  }

  async function verify(report: CandidateReport | null) {
    const after = await vcs.status({ contextId });
    const receipt = preparations[0];
    const observedReview = reviews[0];
    const candidate = observedReview?.review;
    const checks = {
      observed: reads.length === 1 && isDeepStrictEqual(reads[0], expected),
      report: isDeepStrictEqual(report, reference()),
      lifecycle: staging
        ? preparations.length === 1 &&
          reviews.length === 1 &&
          receipt?.outcome === "acknowledged" &&
          !!candidate &&
          isDeepStrictEqual(receipt.review, candidate) &&
          candidate.contextId !== contextId &&
          candidate.state === "review" &&
          candidate.operationId === request.commandId &&
          candidate.incomingCommit === request.incomingCommit &&
          candidate.mainEventId === baseline.mainEventId &&
          observedReview.mainEventId === baseline.mainEventId &&
          candidate.conflicts.length === 0 &&
          candidate.repositories.some(
            ({ repoPath, kind }) =>
              repoPath === "workers/grimoire-world" && kind === "changed",
          )
        : preparations.length === 0 && reviews.length === 0,
      unchanged:
        baseline.mainEventId === after.mainEventId &&
        isDeepStrictEqual(baseline.workingHead, after.workingHead),
    };
    return {
      ...input,
      request,
      observed: reads[0] ?? null,
      ...(staging
        ? { receipt, observedReview, protectedMainEventId: after.mainEventId }
        : {}),
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  return {
    request,
    services,
    verify,
    async qualify() {
      await services.templateOffer.read();
      if (staging) {
        await services.templateCandidatePrepare.prepare();
        await services.templateCandidateReview.read();
        return verify(reference());
      }
      const verification = await verify(reference());
      const denied = await bound.templateCandidatePrepare.prepare();
      return {
        ...verification,
        passed:
          verification.passed &&
          denied.outcome === "offer-changed" &&
          (await bound.templateCandidateReview.read()) === null,
      };
    },
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedTemplateCandidate>>;
type Verification = ReturnType<Prepared["verify"]>;
export interface ManagedTemplateCandidateReceiver {
  runTemplateCandidateTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<Verification>;
  }>;
  qualifyTemplateCandidate(input: Input): Verification;
}
export const templateCandidateMethods =
  createReceiverRpcMethods<ManagedTemplateCandidateReceiver>([
    "runTemplateCandidateTeacher",
    "qualifyTemplateCandidate",
  ]);
