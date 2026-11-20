import { requireAssignedWorld } from "./assigned-world.js";
import { isDeepStrictEqual } from "node:util";
import { bindAuthorityReview } from "@workspace-skills/capabilities/workflow";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { managedAuthorityReviewWorlds } from "./authority-review-worlds.js";

type Services = ReturnType<typeof bindAuthorityReview>["services"];
type Observation = Awaited<
  ReturnType<Services["assignedAuthorityRead"]["preflight"]>
>;
type Exact = Pick<Observation["leaves"][number], "capability" | "resourceKey">;
type Review = {
  observation: Observation;
  outside: Exact[];
  disposition:
    | "eligible"
    | "needs-acquisition"
    | "host-denied"
    | "outside-ceiling";
};
type Report = {
  status: string;
  protectedLeaves: Exact[];
  held: string[];
  reviews: Review[];
};

export function prepareManagedAuthorityReview(
  contextId: string,
  caseId: string,
) {
  const world = requireAssignedWorld(
    managedAuthorityReviewWorlds,
    caseId,
    "Unknown managed authority review",
  );
  const bound = bindAuthorityReview({
    ...world,
    operations: world.operations.map((operation) =>
      operation.service === "vcs" && operation.method === "status"
        ? { ...operation, args: [{ contextId }] }
        : operation,
    ),
  });
  const observations: Observation[] = [];
  const services: Services = {
    assignedAuthorityRead: {
      async preflight(operationId) {
        const observed =
          await bound.services.assignedAuthorityRead.preflight(operationId);
        observations.push(structuredClone(observed));
        return observed;
      },
    },
  };

  function reference() {
    const reviews: Review[] = observations.map((observation) => {
      const assigned = world.operations.find(
        ({ id }) => id === observation.operationId,
      );
      const outside = world.outside.includes(observation.operationId)
        ? (assigned?.protectedResources ?? []).map((resourceKey) => ({
            capability: "external.open",
            resourceKey,
          }))
        : [];
      const disposition = outside.length
        ? "outside-ceiling"
        : observation.decision === "denied"
          ? "host-denied"
          : observation.decision === "acquirable"
            ? "needs-acquisition"
            : "eligible";
      return { observation, outside, disposition };
    });
    const held = reviews
      .filter(
        ({ disposition }) =>
          disposition === "outside-ceiling" || disposition === "host-denied",
      )
      .map(({ observation }) => observation.operationId);
    const protectedLeaves = [
      ...new Set(
        world.operations.flatMap(
          ({ protectedResources }) => protectedResources,
        ),
      ),
    ].map((resourceKey) => ({ capability: "external.open", resourceKey }));
    return {
      status: held.length
        ? "held"
        : reviews.some(({ disposition }) => disposition === "needs-acquisition")
          ? "needs-acquisition"
          : "eligible",
      protectedLeaves,
      held,
      reviews,
    };
  }

  function verify(report: Report | null) {
    const expected = reference();
    const checks = {
      assigned:
        observations.length === world.operations.length &&
        observations.every((observed, index) => {
          const operation = world.operations[index];
          if (!operation || observed.operationId !== operation.id) return false;
          const protectedLeaves = observed.leaves.filter(
            ({ tier }) => tier !== "open",
          );
          return (
            protectedLeaves.every(
              ({ capability, tier }) =>
                capability === "external.open" && tier === "gated",
            ) &&
            isDeepStrictEqual(
              protectedLeaves.map(({ resourceKey }) => resourceKey),
              operation.protectedResources,
            )
          );
        }),
      reviews: isDeepStrictEqual(report?.reviews, expected.reviews),
      ceiling: isDeepStrictEqual(
        report?.protectedLeaves,
        expected.protectedLeaves,
      ),
      decision:
        report?.status === expected.status &&
        isDeepStrictEqual(report.held, expected.held),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      caseId,
      contextId,
      request: bound.request,
      observations,
      checks,
    };
  }

  async function qualify() {
    let rejectedForeignOperation = false;
    try {
      await services.assignedAuthorityRead.preflight("foreign");
    } catch (error) {
      rejectedForeignOperation =
        error instanceof Error && /next assigned operation/.test(error.message);
    }
    for (const { id } of world.operations)
      await services.assignedAuthorityRead.preflight(id);
    const expected = reference();
    const verification = verify(expected);
    const rejectedWrongCeiling = !verify({
      ...expected,
      protectedLeaves: [
        ...expected.protectedLeaves,
        { capability: "external.open", resourceKey: "https://foreign.example" },
      ],
    }).passed;
    return { verification, rejectedForeignOperation, rejectedWrongCeiling };
  }
  return { request: bound.request, services, verify, qualify, reference };
}

type Prepared = ReturnType<typeof prepareManagedAuthorityReview>;
type Input = { contextId: string; caseId: string };
export interface ManagedAuthorityReviewReceiver {
  runManagedAuthorityReviewTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyManagedAuthorityReview(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedAuthorityReviewMethods =
  createReceiverRpcMethods<ManagedAuthorityReviewReceiver>([
    "runManagedAuthorityReviewTeacher",
    "qualifyManagedAuthorityReview",
  ]);
