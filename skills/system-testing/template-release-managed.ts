import { isDeepStrictEqual } from "node:util";
import { contextId, extensions, vcs } from "@workspace/runtime";
import {
  canonicalJson,
  sha256HexSyncText,
} from "@vibestudio/content-addressing";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { templateAuthoringInspectionSchema } from "@vibestudio/service-schemas/templates";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  TemplateAuthoringPlan,
  TemplateAuthoringReport,
  TemplateAuthoringRequest,
} from "../templates/types.js";
import {
  templateReleasePart,
  templateReleaseWorlds,
} from "./template-release-worlds.js";

const templateExtension = "@workspace-extensions/templates";
type Input = { contextId: string; caseId: string };

export async function prepareTemplateRelease(input: Input) {
  const world = templateReleaseWorlds.find(({ id }) => id === input.caseId);
  if (!world || input.contextId !== contextId)
    throw new Error("Unknown template release assignment");

  const starting = await vcs.status({ contextId });
  const inspect = async (name: string) =>
    templateAuthoringInspectionSchema.parse(
      await extensions.invoke(templateExtension, "inspectAuthoring", [
        {
          name,
          description: world.description,
          parts: [templateReleasePart],
        },
      ]),
    );
  const original = await inspect(
    "previousName" in world ? world.previousName : world.name,
  );
  const request: TemplateAuthoringRequest = {
    goal: world.goal,
    operationId: crypto.randomUUID(),
    reviewedFingerprint: original.fingerprint,
    acknowledgedParts: original.requiredParts,
    destination: world.destination,
    version: world.version,
  };
  let used = false;
  let observed: typeof original | null = null;

  function view(raw: typeof original): TemplateAuthoringPlan {
    return {
      mainEventId: raw.mainEventId,
      name: raw.request.name,
      requestedParts: raw.requestedParts,
      includedParts: raw.includedParts,
      requiredParts: raw.requiredParts,
      manifestDigest: raw.manifestDigest,
      fingerprint: raw.fingerprint,
    };
  }
  const services = {
    templateAuthoringRead: {
      async inspect(operationId: string) {
        if (operationId !== request.operationId || used)
          throw new Error(
            "The read is outside the assigned template authoring review",
          );
        used = true;
        observed = await inspect(world.name);
        return structuredClone(view(observed));
      },
    },
  };

  async function verify(report: TemplateAuthoringReport | null) {
    if (!observed)
      throw new Error("The authored review did not read its assigned plan");
    const actual = view(observed);
    const renamed = "previousName" in world;
    const recomputeFingerprint = (receipt: typeof original) =>
      `v1-sha256:${sha256HexSyncText(
        canonicalJson({
          protocol: "vibestudio-template-authoring-plan-v1",
          request: receipt.request,
          mainEventId: receipt.mainEventId,
          includedParts: receipt.includedParts,
          manifestDigest: `v1-sha256:${sha256HexSyncText(receipt.manifest)}`,
        }),
      )}`;
    const final = await vcs.status({ contextId });
    const checks = {
      assignedScope: used && isDeepStrictEqual(report?.plan, actual),
      protectedMain:
        original.mainEventId === starting.mainEventId &&
        actual.mainEventId === starting.mainEventId &&
        final.mainEventId === starting.mainEventId &&
        isDeepStrictEqual(final.workingHead, starting.workingHead),
      closure:
        isDeepStrictEqual(actual.requestedParts, [templateReleasePart]) &&
        actual.includedParts.includes(templateReleasePart) &&
        actual.requiredParts.every((part) =>
          actual.includedParts.includes(part),
        ) &&
        isDeepStrictEqual(original.requiredParts, actual.requiredParts),
      nativeManifest:
        actual.name === world.name &&
        actual.manifestDigest ===
          `v1-sha256:${sha256HexSyncText(observed.manifest)}`,
      fingerprint:
        original.request.name ===
          ("previousName" in world ? world.previousName : world.name) &&
        original.fingerprint === recomputeFingerprint(original) &&
        actual.fingerprint === recomputeFingerprint(observed) &&
        (original.fingerprint !== actual.fingerprint) === renamed &&
        (original.manifestDigest !== actual.manifestDigest) === renamed,
      report: isDeepStrictEqual(report?.review, {
        kind: "publication",
        next: world.next,
        basis: actual.fingerprint,
      }),
    };
    return {
      caseId: world.id,
      request,
      original: view(original),
      actual,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  async function qualify() {
    const plan = await services.templateAuthoringRead.inspect(
      request.operationId,
    );
    return verify({
      plan,
      review: {
        kind: "publication",
        next: world.next,
        basis: plan.fingerprint,
      },
    });
  }

  return { request, services, qualify, verify };
}

type Verification = ReturnType<
  Awaited<ReturnType<typeof prepareTemplateRelease>>["verify"]
>;
export interface TemplateReleaseReceiver {
  runTemplateReleaseTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<Verification>;
  }>;
  qualifyTemplateRelease(input: Input): Verification;
}
export const templateReleaseMethods =
  createReceiverRpcMethods<TemplateReleaseReceiver>([
    "runTemplateReleaseTeacher",
    "qualifyTemplateRelease",
  ]);
