import { isDeepStrictEqual } from "node:util";
import { bindIntegrationReview } from "@workspace-skills/api-integrations/workflow";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { integrationReadinessWorld } from "./integration-readiness-worlds.js";

type Services = ReturnType<typeof bindIntegrationReview>["services"];
type Plan = Awaited<ReturnType<Services["integrationPlanRead"]["observe"]>>;
type Observation = Awaited<
  ReturnType<Services["integrationCredentialLookup"]["resolve"]>
>;
type Report = {
  planReceipt: string;
  destinations: { observation: Observation; disposition: string }[];
  held: string[];
  status: string;
  guidance: string | null;
};

export function prepareManagedIntegrationReadiness(
  contextId: string,
  caseId: string,
) {
  const world = integrationReadinessWorld(caseId);
  const { request, services: bound } = bindIntegrationReview({
    goal: world.goal,
    destinations: world.destinations.map(
      ({ id, purpose, use, required, url }) => ({
        id,
        purpose,
        use,
        required,
        url,
      }),
    ),
  });
  let observedPlan: Plan | null = null;
  const observations: Observation[] = [];
  const services: Services = {
    integrationPlanRead: {
      async observe(id) {
        const plan = await bound.integrationPlanRead.observe(id);
        observedPlan = structuredClone(plan);
        return plan;
      },
    },
    integrationCredentialLookup: {
      async resolve(receipt, id) {
        const observed = await bound.integrationCredentialLookup.resolve(
          receipt,
          id,
        );
        observations.push(structuredClone(observed));
        return observed;
      },
    },
  };
  const expectedDestinations = world.destinations.map(
    ({ id, purpose, use, required }) => ({ id, purpose, use, required }),
  );
  const expectedDispositions = world.destinations.map(({ state }) =>
    state === "active" ? "ready" : "setup-needed",
  );
  function verify(report: Report | null) {
    const checks = {
      plan:
        observedPlan?.receipt === request.operationId + ":integration" &&
        isDeepStrictEqual(observedPlan.destinations, expectedDestinations),
      bindings:
        observations.length === world.destinations.length &&
        world.destinations.every(({ id, state }, i) =>
          isDeepStrictEqual(observations[i], {
            id,
            receipt: request.operationId + ":binding:" + id,
            state,
            canRefresh: state === "active" ? false : null,
          }),
        ),
      report:
        observedPlan !== null &&
        report?.planReceipt === observedPlan.receipt &&
        isDeepStrictEqual(report.held, []) &&
        report.status === world.status &&
        isDeepStrictEqual(
          report.destinations,
          observations.map((observation, i) => ({
            observation,
            disposition: expectedDispositions[i],
          })),
        ) &&
        (world.status === "ready" ||
          (typeof report.guidance === "string" &&
            report.guidance.trim().length > 0)),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId,
      caseId,
      request,
      plan: observedPlan,
      observations,
      checks,
    };
  }

  async function qualify() {
    const plan = await services.integrationPlanRead.observe(
      request.operationId,
    );
    let rejectsWrongDestination = false;
    try {
      await services.integrationCredentialLookup.resolve(
        plan.receipt,
        world.destinations[1].id,
      );
    } catch (error) {
      rejectsWrongDestination =
        error instanceof Error && /next destination/.test(error.message);
    }
    const destinations = [];
    for (const [i, { id }] of world.destinations.entries()) {
      destinations.push({
        observation: await services.integrationCredentialLookup.resolve(
          plan.receipt,
          id,
        ),
        disposition: expectedDispositions[i]!,
      });
    }
    return {
      verification: verify({
        planReceipt: plan.receipt,
        destinations,
        held: [],
        status: world.status,
        guidance:
          world.status === "ready"
            ? null
            : "Identify the publication provider and audience.",
      }),
      rejectsWrongDestination,
    };
  }
  return { request, services, verify, qualify };
}

type Prepared = ReturnType<typeof prepareManagedIntegrationReadiness>;
type Input = { contextId: string; caseId: string };
export interface ManagedIntegrationReadinessReceiver {
  runManagedIntegrationReadinessTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyManagedIntegrationReadiness(
    input: Input,
  ): ReturnType<Prepared["qualify"]>;
}
export const managedIntegrationReadinessMethods =
  createReceiverRpcMethods<ManagedIntegrationReadinessReceiver>([
    "runManagedIntegrationReadinessTeacher",
    "qualifyManagedIntegrationReadiness",
  ]);
