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
} from "../template-candidate/types.js";
import { templateCandidateManagedWorlds } from "./template-candidate-worlds.js";

type Input = { contextId: string; caseId: string };
const unit = "@workspace-extensions/templates";
const baseSource = "git+https://github.com/panticonic/vibestudio-base.git";

export async function prepareManagedTemplateCandidate(input: Input) {
  const assignment = templateCandidateManagedWorlds.find(
    ({ id }) => id === input.caseId,
  );
  if (!assignment || input.contextId !== contextId)
    throw new Error("Unknown native template candidate assignment");
  const baseline = await vcs.status({ contextId });
  const discovery = templateUpdateStatusSchema.parse(
    await extensions.invoke(unit, "checkUpdates", []),
  );
  const before = discovery.checks.find(
    ({ source }) => source.url === baseSource,
  );
  if (
    !before?.target ||
    before.status !== "current" ||
    before.source.commit !== before.target.commit ||
    before.target.url !== before.source.url
  ) {
    throw new Error(
      "The local Base checkpoint did not match the installed template",
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
  let preparations = 0;
  let reviews = 0;
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
        preparations++;
        return bound.templateCandidatePrepare.prepare();
      },
    },
    templateCandidateReview: {
      async read() {
        reviews++;
        return bound.templateCandidateReview.read();
      },
    },
  };
  const reference: CandidateReport = {
    status: assignment.status,
    offer: expected,
    operationId: null,
    candidate: null,
  };

  async function verify(report: CandidateReport | null) {
    const after = await vcs.status({ contextId });
    const checks = {
      observed: reads.length === 1 && isDeepStrictEqual(reads[0], expected),
      report: isDeepStrictEqual(report, reference),
      held: preparations === 0 && reviews === 0,
      unchanged:
        baseline.mainEventId === after.mainEventId &&
        isDeepStrictEqual(baseline.workingHead, after.workingHead),
    };
    return {
      ...input,
      request,
      observed: reads[0] ?? null,
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
      const verification = await verify(reference);
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
