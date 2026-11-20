import type { RemoteRouteReceiver } from "../remote-route-managed.js";
import { remoteRouteWorlds } from "../remote-route-worlds.js";
import type { TestCase } from "../types.js";

type Capture = Awaited<
  ReturnType<RemoteRouteReceiver["runRemoteRouteTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<RemoteRouteReceiver["qualifyRemoteRoute"]>
>;
const settings = {
  category: "skills",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["skills/remote-access"],
};

export const remoteRouteTests = remoteRouteWorlds.flatMap(
  (world): TestCase[] => [
    {
      ...settings,
      name: `remote-route-live-${world.id}`,
      description:
        "Review a real workspace gateway against the assigned remote identity",
      prompt: world.goal,
      async orchestrate({ runner, signal }) {
        const start = Date.now();
        const result = await runner.runRemoteRoute(world.id, false, signal);
        if (result.kind !== "teacher")
          throw new Error("Expected a remote route capture");
        const { teacher, ...fixture } = result.value;
        return {
          messages: [],
          duration: Date.now() - start,
          provenance: {
            contextId: fixture.contextId,
            channelId: null,
            branchId: null,
            agentEntityId: null,
            agentTargetId: null,
          },
          diagnostics: { natlangTeacher: teacher, remoteRoute: fixture },
        };
      },
      validate(result) {
        const teacher = result.diagnostics?.["natlangTeacher"] as
          | Capture["teacher"]
          | undefined;
        const fixture = result.diagnostics?.["remoteRoute"] as
          | Omit<Capture, "teacher">
          | undefined;
        return {
          passed:
            teacher?.trainingEligible === true &&
            fixture?.verification.passed === true,
          details: fixture?.verification.checks,
        };
      },
    },
    {
      ...settings,
      name: `remote-route-oracle-qualification-${world.id}`,
      description:
        "Verify one native workspace identity readback without model calls",
      prompt: world.goal,
      async orchestrate({ runner, signal }) {
        const start = Date.now();
        const result = await runner.runRemoteRoute(world.id, true, signal);
        if (result.kind !== "reference")
          throw new Error("Remote route qualification invoked a model");
        return {
          messages: [],
          duration: Date.now() - start,
          diagnostics: { remoteRoute: result.value },
        };
      },
      validate(result) {
        const qualification = result.diagnostics?.["remoteRoute"] as
          | Qualification
          | undefined;
        return {
          passed:
            qualification?.caseId === world.id && qualification.passed === true,
          details: qualification?.checks,
        };
      },
    },
  ],
);
