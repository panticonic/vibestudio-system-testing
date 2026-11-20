import { requireAssignedWorld } from "./assigned-world.js";
import { isDeepStrictEqual } from "node:util";
import { vcs } from "@workspace/runtime";
import { bindVcsDelivery } from "@workspace-skills/vcs-delivery-bindings";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import {
  deliveryRepository,
  managedVcsDeliveryWorlds,
} from "./vcs-delivery-worlds.js";

type Services = ReturnType<typeof bindVcsDelivery>["services"];
type Snapshot = Awaited<ReturnType<Services["vcsDeliveryRead"]["observe"]>>;
type DeliveryReport = {
  snapshot: Snapshot;
  chain: {
    local: { state: string; summary: string };
    main: { state: string; summary: string };
  } | null;
  review: { effect: string; risks: string[]; checks: string[] } | null;
  next: string;
};

export async function prepareManagedVcsDelivery(
  contextId: string,
  caseId: string,
) {
  const scenario = requireAssignedWorld(
    managedVcsDeliveryWorlds,
    caseId,
    "Unknown assigned semantic VCS delivery case",
  );
  const bound = bindVcsDelivery({
    goal: scenario.goal,
    repository: deliveryRepository,
    path: scenario.path,
  });
  const before = await vcs.status();
  let observed: Snapshot | undefined;
  const services: Services = {
    vcsDeliveryRead: {
      async observe(id) {
        if (observed) throw new Error("The assigned VCS file was already read");
        const snapshot = await bound.services.vcsDeliveryRead.observe(id);
        observed = structuredClone(snapshot);
        return snapshot;
      },
    },
  };

  async function verify(report: DeliveryReport | null) {
    const after = await vcs.status();
    const assignedChanged = scenario.seedPath === scenario.path;
    const file = observed?.file;
    const checkText = report?.review?.checks.join(" ").toLowerCase() ?? "";
    const effect = report?.review?.effect.toLowerCase() ?? "";
    const checks = {
      contextPreserved:
        before.contextId === contextId && isDeepStrictEqual(before, after),
      exactState:
        observed?.contextId === contextId &&
        observed.current &&
        observed.clean === scenario.commit &&
        observed.relation === (scenario.commit ? "ahead" : "at") &&
        before.clean === scenario.commit &&
        before.integrating.length === 0 &&
        isDeepStrictEqual(observed.working, before.workingHead) &&
        isDeepStrictEqual(observed.committed, before.committed) &&
        observed.protectedMain.kind === "event" &&
        observed.protectedMain.eventId === before.mainEventId,
      assignedFile:
        file?.path === scenario.path &&
        file.hasDeliveryDifference === assignedChanged &&
        file.hasLocalDifference === (assignedChanged && !scenario.commit) &&
        (assignedChanged
          ? file.working?.excerpt === scenario.text &&
            file.protectedMain === null &&
            (scenario.commit
              ? isDeepStrictEqual(file.working, file.committed)
              : file.committed === null)
          : !!file.working &&
            isDeepStrictEqual(file.working, file.committed) &&
            isDeepStrictEqual(file.working, file.protectedMain)),
      report:
        !!observed &&
        isDeepStrictEqual(report?.snapshot, observed) &&
        report?.next === scenario.next &&
        report.chain?.local.state ===
          (scenario.commit ? "clean" : "uncommitted") &&
        report.chain.main.state === "current" &&
        !!effect &&
        (assignedChanged
          ? scenario.terms.every((term) => effect.includes(term)) &&
            scenario.terms.some((term) => checkText.includes(term))
          : report.review?.checks.length === 0),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId,
      caseId,
      request: bound.request,
      snapshot: observed,
      checks,
    };
  }

  async function qualify() {
    let rejectsOtherAssignment = false;
    try {
      await services.vcsDeliveryRead.observe("unassigned-vcs-delivery");
    } catch (error) {
      rejectsOtherAssignment =
        error instanceof Error &&
        error.message.includes("assigned semantic VCS file");
    }
    const snapshot = await services.vcsDeliveryRead.observe(
      bound.request.operationId,
    );
    const assignedChanged = scenario.seedPath === scenario.path;
    const review: DeliveryReport = {
      snapshot,
      chain: {
        local: {
          state: scenario.commit ? "clean" : "uncommitted",
          summary: "Observed semantic working head",
        },
        main: { state: "current", summary: "Observed protected main" },
      },
      review: {
        effect: assignedChanged
          ? scenario.text
          : "Assigned file matches protected main.",
        risks: [],
        checks: assignedChanged
          ? [
              "Exercise the stated " +
                scenario.terms.join(" and ") +
                " behavior",
            ]
          : [],
      },
      next: scenario.next,
    };
    return { verification: await verify(review), rejectsOtherAssignment };
  }

  return { request: bound.request, services, verify, qualify };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedVcsDelivery>>;
type Input = { contextId: string; caseId: string };
export interface ManagedVcsDeliveryReceiver {
  runManagedVcsDeliveryTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedVcsDelivery(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedVcsDeliveryMethods =
  createReceiverRpcMethods<ManagedVcsDeliveryReceiver>([
    "runManagedVcsDeliveryTeacher",
    "qualifyManagedVcsDelivery",
  ]);
