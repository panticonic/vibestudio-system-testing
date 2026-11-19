import type { DeliveryHistoryReceiver } from "../delivery-history-managed.js";
import {
  chatDeliveryWorlds,
  deliveryHistoryWorlds,
  isChatDeliveryCase,
} from "../delivery-history-worlds.js";
import type { TestCase } from "../types.js";
import {
  PANEL_AUTOMATION_RESOURCE,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";

type Qualification = Awaited<
  ReturnType<DeliveryHistoryReceiver["qualifyDeliveryHistory"]>
>;
type Teacher = Awaited<
  ReturnType<DeliveryHistoryReceiver["runDeliveryHistoryTeacher"]>
>;
const settings = {
  category: "local-messaging",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/delivery-history-bindings"],
};

const browserSettings = {
  requiresUnits: [...settings.requiresUnits, "panels/chat"],
  resources: [PANEL_AUTOMATION_RESOURCE],
  authorityPolicy: panelControlAuthorityPolicy(
    "inspect-assigned-chat-delivery",
  ),
};

export const managedDeliveryHistoryTests: TestCase[] = [
  ...deliveryHistoryWorlds,
  ...chatDeliveryWorlds,
].map((world) => ({
  ...settings,
  ...(isChatDeliveryCase(world.id) ? browserSettings : {}),
  name: `${isChatDeliveryCase(world.id) ? "chat-delivery" : "delivery-history"}-live-${world.id}`,
  description:
    "Audit delivery against real channel replay and the consumer graph",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runDeliveryHistory(world.id, false, signal);
    if (result.kind !== "teacher")
      throw new Error("Expected a captured delivery audit");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [],
      duration: Date.now() - start,
      provenance: {
        contextId,
        channelId: null,
        branchId: null,
        agentEntityId: null,
        agentTargetId: null,
      },
      diagnostics: { natlangTeacher: teacher, deliveryHistory: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as
      | Teacher["teacher"]
      | undefined;
    const verification = result.diagnostics?.["deliveryHistory"] as
      | Teacher["verification"]
      | undefined;
    return {
      passed: !!teacher?.trainingEligible && !!verification?.passed,
      details: verification?.checks,
    };
  },
}));

function qualification(
  name: string,
  worlds: readonly { id: string; goal: string }[],
  browser = false,
): TestCase {
  return {
    ...settings,
    ...(browser ? browserSettings : {}),
    name,
    description: browser
      ? "Verify durable delivery against the actual assigned chat panel through CDP"
      : "Qualify durable delivery and consumer evidence without model calls",
    prompt: worlds[0]!.goal,
    async orchestrate({ runner, signal }) {
      const start = Date.now();
      const outcomes: Qualification[] = [];
      for (const { id } of worlds) {
        const result = await runner.runDeliveryHistory(id, true, signal);
        if (result.kind !== "reference")
          throw new Error("Delivery history qualification invoked a teacher");
        outcomes.push(result.value);
      }
      return {
        messages: [],
        duration: Date.now() - start,
        diagnostics: { deliveryHistory: outcomes },
      };
    },
    validate(result) {
      const outcomes = result.diagnostics?.["deliveryHistory"] as
        | Qualification[]
        | undefined;
      return {
        passed:
          outcomes?.length === worlds.length &&
          outcomes.every(({ passed }) => passed),
        details: outcomes?.map(({ caseId, checks }) => ({ caseId, checks })),
      };
    },
  };
}

managedDeliveryHistoryTests.push(
  qualification("delivery-history-oracle-qualification", deliveryHistoryWorlds),
  qualification("chat-delivery-oracle-qualification", chatDeliveryWorlds, true),
);
