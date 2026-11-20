import { requireAssignedWorld } from "./assigned-world.js";
import { isDeepStrictEqual } from "node:util";
import { contextId, rpc } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { notificationWorlds } from "./notification-worlds.js";

type Input = { contextId: string; caseId: string };

export function prepareManagedNotification(input: Input) {
  if (input.contextId !== contextId)
    throw new Error("Unknown assigned notification lifecycle");
  const world = requireAssignedWorld(
    notificationWorlds,
    input.caseId,
    "Unknown assigned notification lifecycle",
  );
  const request = { operationId: crypto.randomUUID(), goal: world.goal };
  let showStarted = false;
  let dismissing = false;
  let accepted: { notificationId: string; actionLabels: string[] } | undefined;
  let dismissed: { notificationId: string } | undefined;

  async function show(operationId: string) {
    if (operationId !== request.operationId || showStarted)
      throw new Error("Show the assigned notification once");
    showStarted = true;
    const actions = world!.actionLabels.map((label, index) => ({
      id: `test-${index + 1}`,
      label,
    }));
    const notificationId = await rpc.call(
      "main",
      mainRpcMethods["notification.show"],
      [
        {
          type: "info",
          title: world!.title,
          message: "Temporary notification from an isolated system test.",
          ...(actions.length ? { actions } : {}),
        },
      ],
    );
    accepted = {
      notificationId,
      actionLabels: actions.map(({ label }) => label),
    };
    return structuredClone(accepted);
  }
  async function dismiss(operationId: string, notificationId: string) {
    if (
      operationId !== request.operationId ||
      accepted?.notificationId !== notificationId ||
      dismissed ||
      dismissing
    )
      throw new Error(
        "Dismiss only the notification accepted for this assignment",
      );
    dismissing = true;
    try {
      await rpc.call("main", mainRpcMethods["notification.dismiss"], [
        notificationId,
      ]);
      dismissed = { notificationId };
      return structuredClone(dismissed);
    } finally {
      dismissing = false;
    }
  }
  const expected = () => ({
    status: "cleaned-up",
    notificationId: accepted?.notificationId,
    actionLabels: world.actionLabels,
    interaction: "unobserved",
  });
  function verify(report: unknown) {
    const checks = {
      accepted:
        Boolean(accepted?.notificationId) &&
        isDeepStrictEqual(accepted?.actionLabels, world.actionLabels),
      dismissed: Boolean(
        dismissed && dismissed.notificationId === accepted?.notificationId,
      ),
      exactReport: isDeepStrictEqual(report, expected()),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      checks,
      request,
      accepted,
      dismissed,
      caseId: world.id,
    };
  }
  return {
    request,
    services: {
      temporaryNotificationShow: { show },
      temporaryNotificationDismiss: { dismiss },
    },
    verify,
    async qualify() {
      const receipt = await show(request.operationId);
      const rejectedForeignId = await dismiss(
        request.operationId,
        "foreign-notification-id",
      ).then(
        () => false,
        () => true,
      );
      await dismiss(request.operationId, receipt.notificationId);
      return { verification: verify(expected()), rejectedForeignId };
    },
    async cleanup() {
      if (accepted && !dismissed)
        await dismiss(request.operationId, accepted.notificationId);
    },
  };
}

type Prepared = ReturnType<typeof prepareManagedNotification>;
export interface ManagedNotificationReceiver {
  runManagedNotificationTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyManagedNotification(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedNotificationMethods =
  createReceiverRpcMethods<ManagedNotificationReceiver>([
    "runManagedNotificationTeacher",
    "qualifyManagedNotification",
  ]);
