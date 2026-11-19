import { isDeepStrictEqual } from "node:util";
import { extensions, vcs } from "@workspace/runtime";
import { bindExtensionRelease } from "@workspace-skills/extensiondev/workflow";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { managedExtensionReleaseWorlds } from "./extension-release-worlds.js";

type Services = ReturnType<typeof bindExtensionRelease>["services"];
type Source = Awaited<ReturnType<Services["extensionReleaseRead"]["source"]>>;
type Runtime = Awaited<ReturnType<Services["extensionReleaseRead"]["runtime"]>>;
type Report = {
  source: { observation: Source; disposition: string };
  runtime: { observation: Runtime; disposition: string };
  decision: string;
};

const dispositions = {
  "waiting-approval": "wait-for-approval",
  building: "wait-for-build",
  failed: "inspect-failure",
  cold: "await-activation",
  "live-method": "observed-live",
  "method-not-observed": "inspect-active-contract",
} as const;

export async function prepareManagedExtensionRelease(
  contextId: string,
  caseId: string,
) {
  const world = managedExtensionReleaseWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown extension release case");
  const initial = await vcs.status({ contextId });
  const initialRuntime = await extensions.status(world.name);
  const staged = world.mode !== "published";
  if (staged) {
    const state = initial.workingHead;
    const repo = await vcs.resolveRepository({ state, repoPath: world.source });
    if (!repo) throw new Error("Missing assigned extension repository");
    const file = await vcs.readFile({
      state,
      repositoryId: repo.repositoryId,
      file: {
        kind: "path",
        path: world.mode === "manifest-change" ? "package.json" : "index.ts",
      },
    });
    if (file?.content.kind !== "text")
      throw new Error("Missing assigned extension manifest");
    let text =
      file.content.text + "\n// Assigned local implementation review marker.\n";
    if (world.mode === "manifest-change") {
      const candidate = JSON.parse(file.content.text);
      const methods = candidate.vibestudio?.extension?.methodAuthority;
      if (!methods?.probe || Object.hasOwn(methods, world.method))
        throw new Error("Cannot stage an independent candidate method");
      methods[world.method] = structuredClone(methods.probe);
      text = JSON.stringify(candidate, null, 2) + "\n";
    }
    await vcs.edit({
      contextId,
      expectedWorkingHead: state,
      commandId: `extension-release-${crypto.randomUUID()}`,
      intentSummary: "Stage the assigned local extension source change",
      changes: [
        {
          kind: "content-replace",
          repositoryId: repo.repositoryId,
          fileId: file.fileId,
          content: {
            kind: "text",
            text,
          },
        },
      ],
    });
  }
  const assigned = await vcs.status({ contextId });
  const assignedRevision =
    assigned.workingHead.kind === "event"
      ? assigned.workingHead.eventId
      : assigned.workingHead.applicationId;
  const bound = bindExtensionRelease({ contextId, ...world });
  const sourceReads: Source[] = [];
  const runtimeReads: Runtime[] = [];
  const services: Services = {
    extensionReleaseRead: {
      async source(operationId) {
        const read =
          await bound.services.extensionReleaseRead.source(operationId);
        sourceReads.push(structuredClone(read));
        return read;
      },
      async runtime(operationId) {
        const read =
          await bound.services.extensionReleaseRead.runtime(operationId);
        runtimeReads.push(structuredClone(read));
        return read;
      },
    },
  };

  function expected(source: Source, runtime: Runtime): Report {
    const runtimeDisposition =
      runtime.pendingApproval || runtime.status === "pending-approval"
        ? "waiting-approval"
        : runtime.status === "building"
          ? "building"
          : runtime.status === "error" || runtime.hasError
            ? "failed"
            : runtime.status !== "running" ||
                !runtime.identity ||
                !runtime.activeEv
              ? "cold"
              : runtime.methods.includes(world.method)
                ? "live-method"
                : "method-not-observed";
    return {
      source: {
        observation: source,
        disposition: staged ? "unpublished-candidate" : "published-method",
      },
      runtime: { observation: runtime, disposition: runtimeDisposition },
      decision: staged
        ? "verify-and-publish-candidate"
        : dispositions[runtimeDisposition],
    };
  }

  async function verify(report: Report | null) {
    const [source] = sourceReads;
    const [runtime] = runtimeReads;
    const after = await vcs.status({ contextId });
    const afterRuntime = await extensions.status(world.name);
    const checks = {
      source:
        sourceReads.length === 1 &&
        source?.operationId === bound.request.operationId &&
        source.contextId === contextId &&
        source.name === world.name &&
        source.source === world.source &&
        source.workingRevision === assignedRevision &&
        source.mainRevision === initial.mainEventId &&
        source.working?.activation === world.activation &&
        source.working.methods.includes(world.method) &&
        source.published !== null &&
        Boolean(source.workingTree) &&
        Boolean(source.publishedTree) &&
        (staged
          ? !assigned.clean && source.workingTree !== source.publishedTree
          : source.workingTree === source.publishedTree) &&
        (world.mode === "manifest-change"
          ? source.working.hash !== source.published.hash &&
            !source.published.methods.includes(world.method)
          : source.working.hash === source.published.hash &&
            source.published.methods.includes(world.method)),
      runtime:
        runtimeReads.length === 1 &&
        runtime?.operationId === bound.request.operationId &&
        runtime.name === world.name &&
        runtime.source === world.source &&
        runtime.activeEv === afterRuntime.activeEv &&
        runtime.identity === (afterRuntime.identity?.entityId ?? null) &&
        (!staged ||
          (runtime.activeEv === initialRuntime.activeEv &&
            runtime.identity === (initialRuntime.identity?.entityId ?? null) &&
            (world.mode !== "manifest-change" ||
              !runtime.methods.includes(world.method)))),
      unchanged:
        after.mainEventId === initial.mainEventId &&
        isDeepStrictEqual(after.workingHead, assigned.workingHead),
      report: Boolean(
        source &&
        runtime &&
        isDeepStrictEqual(report, expected(source, runtime)),
      ),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId,
      caseId,
      request: bound.request,
      source,
      runtime,
      checks,
    };
  }

  async function qualify() {
    let rejectedForeignScope = false;
    try {
      await services.extensionReleaseRead.source("foreign");
    } catch (error) {
      rejectedForeignScope =
        error instanceof Error &&
        /assigned extension manifest/.test(error.message);
    }
    const source = await services.extensionReleaseRead.source(
      bound.request.operationId,
    );
    const runtime = await services.extensionReleaseRead.runtime(
      bound.request.operationId,
    );
    const report = expected(source, runtime);
    const verification = await verify(report);
    const wrongDecision =
      report.decision === "observed-live" ? "declare-method" : "observed-live";
    return {
      verification,
      rejectedForeignScope,
      rejectedWrongDecision: !(
        await verify({ ...report, decision: wrongDecision })
      ).passed,
    };
  }
  return { request: bound.request, services, verify, qualify };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedExtensionRelease>>;
type Input = { contextId: string; caseId: string };
export interface ManagedExtensionReleaseReceiver {
  runManagedExtensionReleaseTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedExtensionRelease(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedExtensionReleaseMethods =
  createReceiverRpcMethods<ManagedExtensionReleaseReceiver>([
    "runManagedExtensionReleaseTeacher",
    "qualifyManagedExtensionRelease",
  ]);
