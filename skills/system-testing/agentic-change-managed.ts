import { requireAssignedWorld } from "./assigned-world.js";
import { isDeepStrictEqual } from "node:util";
import { bindAgenticChangePlan } from "@workspace-skills/agentic-development/workflow";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { vcs } from "@workspace/runtime";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { managedAgenticChangeWorlds } from "./agentic-change-worlds.js";

type Binding = ReturnType<typeof bindAgenticChangePlan>;
type Source = Awaited<
  ReturnType<Binding["services"]["agenticChangeSource"]["read"]>
>;
type Plan = {
  contextId: string;
  revision: string;
  impact: {
    owner: string | null;
    consumers: string[];
    persistedContract: boolean;
    retainedHistoryChecks: string[];
    blockers: string[];
  };
  builds: { focusedTests: string[]; rebuild: string[] } | null;
  canary: {
    surface: string;
    probe: string;
    observations: string[];
    cleanup: string[];
  } | null;
};

function sameUnits(
  observed: string[] | undefined,
  expected: readonly string[],
) {
  return (
    Array.isArray(observed) &&
    isDeepStrictEqual([...observed].sort(), [...expected].sort())
  );
}

export async function prepareManagedAgenticChange(
  contextId: string,
  caseId: string,
) {
  const world = requireAssignedWorld(
    managedAgenticChangeWorlds,
    caseId,
    "Unknown agentic change assignment",
  );
  const { workingHead } = await vcs.status({ contextId });
  const revision =
    workingHead.kind === "event"
      ? workingHead.eventId
      : workingHead.applicationId;
  const binding = bindAgenticChangePlan({ contextId, goal: world.goal });
  const observations: Source[] = [];
  const services: Binding["services"] = {
    agenticChangeSource: {
      async read(context) {
        const source = await binding.services.agenticChangeSource.read(context);
        observations.push(structuredClone(source));
        return source;
      },
    },
  };

  async function verify(plan: Plan | null) {
    const [source] = observations;
    const after = await vcs.status({ contextId });
    const checks = {
      source:
        observations.length >= 1 &&
        source?.contextId === contextId &&
        source.revision === revision &&
        [world.owner, ...world.consumers].every((unit) =>
          source.guides.some(
            (guide) => guide.unit === unit && Boolean(guide.excerpt),
          ),
        ),
      unchanged: isDeepStrictEqual(after.workingHead, workingHead),
      ownership:
        plan?.contextId === contextId &&
        plan.revision === revision &&
        plan.impact.owner === world.owner &&
        sameUnits(plan.impact.consumers, world.consumers) &&
        plan.impact.blockers.length === 0,
      verification:
        plan?.impact.persistedContract === world.persistedContract &&
        (world.persistedContract
          ? plan.impact.retainedHistoryChecks.length >= 2
          : plan.impact.retainedHistoryChecks.length === 0) &&
        sameUnits(plan.builds?.focusedTests, [
          world.owner,
          ...world.consumers,
        ]) &&
        sameUnits(plan.builds?.rebuild, world.rebuild) &&
        plan.canary?.surface === world.surface &&
        plan.canary.probe.trim().length > 0 &&
        plan.canary.observations.length > 0 &&
        plan.canary.cleanup.length > 0,
    };
    return {
      passed: Object.values(checks).every(Boolean),
      caseId,
      request: binding.request,
      source,
      checks,
    };
  }

  async function qualify() {
    let rejectedForeignContext = false;
    try {
      await services.agenticChangeSource.read(contextId + "-foreign");
    } catch (error) {
      rejectedForeignContext =
        error instanceof Error &&
        /assigned agentic development context/.test(error.message);
    }
    const source = await services.agenticChangeSource.read(contextId);
    const reference: Plan = {
      contextId,
      revision: source.revision,
      impact: {
        owner: world.owner,
        consumers: [...world.consumers],
        persistedContract: world.persistedContract,
        retainedHistoryChecks: world.persistedContract
          ? [
              "Reduce representative persisted terminal outcomes.",
              "Produce a fresh outcome and compare durable replay with transcript rendering.",
            ]
          : [],
        blockers: [],
      },
      builds: {
        focusedTests: [world.owner, ...world.consumers],
        rebuild: [...world.rebuild],
      },
      canary: {
        surface: world.surface,
        probe: world.probe,
        observations: [...world.observations],
        cleanup: [
          "Close the canary surface and retire only its owned registrations and diagnostics.",
        ],
      },
    };
    const verification = await verify(reference);
    const wrongRevision = await verify({
      ...reference,
      revision: "another-revision",
    });
    return {
      verification,
      rejectedForeignContext,
      rejectedWrongRevision: !wrongRevision.passed,
    };
  }
  return { request: binding.request, services, verify, qualify };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedAgenticChange>>;
type Input = { contextId: string; caseId: string };
export interface ManagedAgenticChangeReceiver {
  runManagedAgenticChangeTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedAgenticChange(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedAgenticChangeMethods =
  createReceiverRpcMethods<ManagedAgenticChangeReceiver>([
    "runManagedAgenticChangeTeacher",
    "qualifyManagedAgenticChange",
  ]);
