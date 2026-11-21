import { executionArtifactRefSchema } from "@vibestudio/service-schemas/build";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { DevelopmentRun, DevelopmentRunEvent, DevelopmentSession } from "@vibestudio/service-schemas/development";
import type { DevelopmentAuditWorld } from "./open-goal-development-audit-worlds.js";

const hash = sha256HexSyncText;
const noRepair = new Set(["accepted", "installing", "ready", "cancelled", "stopped", "succeeded"]);
export function developmentAuditSeed(world: DevelopmentAuditWorld, key: string) {
  const scope = `owned-development-${key}`;
  const primary = scope + "-primary";
  const ids = { requested: key + "-requested", alternate: key + "-alternate" };
  const digests = { requested: hash(ids.requested), alternate: hash(ids.alternate), older: hash(key + "-old") };
  const sessions = new Map<string, DevelopmentSession>();
  const entries: { run: DevelopmentRun; journal: Omit<DevelopmentRunEvent, "sequence">[] }[] = [];
  for (const side of ["requested", "alternate"] as const) {
    const variant = world[side];
    if (variant.missing) continue;
    const sessionId = variant.foreign ? scope + "-neighbor" : variant.wrongSession ? scope + "-other" : primary;
    const runtimeId = variant.foreign ? scope + "-private" : scope;
    const contextId = sessionId + "-child";
    if (!sessions.has(sessionId)) sessions.set(sessionId, {
      sessionId, idempotencyKey: sessionId, createdAt: 10, updatedAt: 10,
      state: variant.sessionState ?? "ready", mode: "semantic", nativeTool: null, native: null,
      repository: { repositoryId: key, repoPath: "projects/fixture" },
      contextId, parentContextId: "fixture-parent",
      basis: { parentWorkingHead: { kind: "event", eventId: "fixture-parent-base" }, childBaseState: { kind: "event", eventId: "fixture-child-base" } },
      owner: { runtimeId, runtimeKind: "worker", userId: null },
      contextEffect: variant.contextEffect ?? "owned", repairAttention: null, primaryFailure: null, cleanupFailures: [],
    });
    const runId = ids[side], digest = digests[side], at = side === "requested" ? 100 : 20;
    const state = variant.state ?? "requires-repair";
    const stamp = (label: string) => hash(runId + label);
    const repository = (name: string) => ({
      repositoryId: `repository:${name}`, repoPath: `projects/${name}`,
      repositoryState: { kind: "application" as const, applicationId: `application:${name}` },
      repositoryManifestDigest: stamp(name + "manifest"), materializedTreeDigest: stamp(name + "tree"),
      contentRoot: `state:${stamp(name + "root")}`, sourcePlanDigest: stamp(name + "plan"),
    });
    const target = { kind: "build-only" } as const;
    const environment = { CI: "1", NODE_ENV: "production" } as const;
    const failure = (code: string) => ({ code, message: code, errorKind: "application" as const });
    const commitPoint = variant.commit ?? "snapshot-retained";
    const placedArtifact = ["artifacts-verified", "instance-registered", "ready"].includes(commitPoint) && variant.artifact !== "unknown";
    const run: DevelopmentRun = {
      version: 1, runId, sessionId, ownerRuntimeId: runtimeId, ownerRuntimeKind: "worker", ownerUserId: null,
      attachedHostAuthorityCeiling: null, target,
      recipe: {
        version: 1, recipeId: "retained-fixture", label: "Retained local record", target, executor: "node-pnpm",
        install: { lockfiles: ["pnpm-lock.yaml"], mode: "frozen", network: "approved-registry", registry: "https://registry.npmjs.org" },
        commands: [{ id: "install-root", executable: "pnpm", args: [] }, { id: "build-host", executable: "pnpm", args: [] }],
        declaredEnvironment: environment, platform: "linux", arch: "x64", reviewDigest: stamp("review"),
      },
      snapshot: {
        version: 1, sessionId, contextId: variant.wrongContext ? contextId + "-previous" : contextId,
        pair: { kind: "combined", host: repository("host"), base: repository("base"), personal: repository("personal"),
          system: repository("system"), pairDigest: stamp("pair") },
        recipeDigest: stamp("recipe"), toolchain: { executorId: stamp("executor"),
          node: { version: "22", digest: stamp("node"), platform: "linux", arch: "x64" },
          pnpm: { version: "10", digest: stamp("pnpm") }, hostSourceBuild: { digest: stamp("host-source") } },
        declaredEnvironment: environment, environmentDigest: stamp("environment"), lockfileDigest: stamp("lock"), snapshotDigest: digest,
      },
      state, commitPoint,
      artifact: placedArtifact ? executionArtifactRefSchema.parse({
        version: 1,
        sourceState: { kind: "workspace", workspaceId: contextId, effectiveVersion: stamp("workspace-version"),
          state: { kind: "event", eventId: "fixture-child-base" },
          contentRoots: [{ repoPath: "projects/fixture", stateHash: `state:${stamp("root")}` }],
          sourceClosureDigest: stamp("source-closure") },
        recipeDigest: stamp("recipe"), buildKey: stamp("build-key"), artifactDigest: stamp("output"), executionDigest: stamp("execution"),
      }) : null,
      instance: commitPoint === "instance-registered" || commitPoint === "ready" ? {
        instanceId: "fixture-instance", generationId: stamp("generation").slice(0, 32), lifecycle: "ephemeral",
        state: commitPoint === "ready" ? "ready" : "registered", executionDigest: stamp("execution"), serverBuildId: stamp("build-key"),
        serverId: null, serverBootId: null, workspaceId: null, workspaceName: null, gatewayUrl: null,
        registeredAt: at + 6, readyAt: commitPoint === "ready" ? at + 7 : null, stoppedAt: null,
      } : null,
      hostReadiness: null, client: null, attachedHost: null,
      repair: noRepair.has(state) ? null : {
        phase: variant.phase ?? "building", primaryFailure: failure(variant.primary ?? "BUILD_EXIT"),
        cleanupFailures: variant.cleanup && variant.cleanup !== "resolved" ? [failure("TEARDOWN_EXIT")] : [],
        retryable: true, attention: variant.kept ? "kept" : "actionable",
        knownEffects: { executionRoot: variant.root ?? "owned", process: variant.process ?? "absent", artifact: variant.artifact ?? "absent" },
      },
      createdAt: at, updatedAt: at + 9,
      terminalAt: ["cancelled", "stopped", "succeeded", "failed"].includes(state) ? at + 9 : null,
    };
    const payload = (code: string, snapshot: string) => ({ code, snapshot });
    const journal: Omit<DevelopmentRunEvent, "sequence">[] = [
      { at: at + 1, kind: "log", payload: payload("REQUEST_SEEN", digest) },
    ];
    if (["stale", "superseded"].includes(variant.checkpoint ?? ""))
      journal.push({ at: at + 2, kind: "diagnostic", payload: payload("CHECKPOINT", digests.older) });
    if (variant.checkpoint !== "none" && variant.checkpoint !== "stale")
      journal.push({ at: at + 3, kind: "diagnostic", payload: payload("CHECKPOINT", digest) });
    if (run.repair) journal.push({ at: at + 4, kind: "diagnostic", payload: payload(run.repair.primaryFailure.code!, digest) });
    if (variant.cleanup === "stale" || variant.cleanup === "resolved")
      journal.push({ at: at + 5, kind: "cleanup", payload: payload("CLEANUP", digests.older) });
    if (variant.cleanup === "same" || variant.cleanup === "resolved")
      journal.push({ at: at + 6, kind: "cleanup", payload: payload("CLEANUP", digest) });
    entries.push({ run, journal });
  }
  const assignment = {
    goal: world.goal, project: world.project, session: primary, requested: ids.requested, alternate: ids.alternate,
    allowAlternate: world.allowAlternate, approval: world.approval === "none" ? null : digests[world.approval],
    permission: world.permission,
  };
  return { assignment, seed: { scope, sessions: [...sessions.values()], entries } };
}
