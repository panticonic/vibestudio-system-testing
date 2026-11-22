import { isDeepStrictEqual } from "node:util";
import { contextId as actualContextId } from "@workspace/runtime";
import type {
  RemoteCommissionIdentity,
  RemoteCommissionStages,
  RemoteDeploymentObservation,
  RemoteDeploymentStages,
} from "@vibestudio/shared/deviceDriver";
import { openClientDevice } from "./tests/_client-device.js";
import {
  operatorGoalWorlds,
  type OperatorGoalWorld,
} from "./open-goal-operator-worlds.js";

type Input = { contextId: string; caseId: string };
type Target = Omit<OperatorGoalWorld["target"], "initial">;
type Action = "start" | "restart";
type Baseline = {
  target: Target;
  identity: RemoteCommissionIdentity | null;
  state: RemoteDeploymentObservation["state"];
  receipt: string;
};
type OperatorReport = {
  status: OperatorGoalWorld["expected"]["status"];
  reason: OperatorGoalWorld["expected"]["reason"] | null;
  targetId: string;
  identity: RemoteCommissionIdentity | null;
  evidenceIds: string[];
};
type ProfileProof = { stableDeployment: boolean; persistedNewProfile: boolean };
type DeploymentSession = {
  kind: "deployment";
  initial: RemoteDeploymentObservation;
  baseline(): Promise<RemoteDeploymentStages["baseline"]>;
  apply(receipt: string): Promise<RemoteDeploymentStages["apply"]>;
  verify(receipt: string): Promise<RemoteDeploymentStages["verify"]>;
  finish(): Promise<RemoteDeploymentObservation>;
};
type ProfileSession = {
  kind: "terminal-profile";
  initial: RemoteDeploymentObservation;
  baseline(): Promise<RemoteCommissionStages["baseline"]>;
  profile(receipt: string): Promise<RemoteCommissionStages["profile"]>;
  pair(receipt: string): Promise<RemoteCommissionStages["pair"]>;
  open(receipt: string): Promise<RemoteCommissionStages["route"]>;
  verify(receipt: string): Promise<RemoteCommissionStages["child"]>;
  finish(): Promise<ProfileProof>;
};
type Session = DeploymentSession | ProfileSession;
type DomainReport = {
  status: "workspace-skill-reviewed";
  skill: "operator";
  outcome: OperatorReport;
};

export function bindOpenGoalOperator(
  input: Input,
  world: OperatorGoalWorld,
  session: Session,
) {
  if (input.caseId !== world.id || world.target.surface !== session.kind)
    throw new Error("The operator goal must match its owned terminal target");
  const { id, label, surface, grant } = world.target;
  const target: Target = { id, label, surface, grant };
  const initial = structuredClone(session.initial);
  let listed = false;
  let baseline: Baseline | undefined;
  let profile: RemoteCommissionStages["profile"] | undefined;
  let pairing: RemoteCommissionStages["pair"] | undefined;
  let route: RemoteCommissionStages["route"] | undefined;
  let child: RemoteCommissionStages["child"] | undefined;
  let installation: RemoteDeploymentStages["apply"] | undefined;
  let deployment: RemoteDeploymentStages["verify"] | undefined;
  let requestedOperation: Action | undefined;
  let finishResult:
    | Promise<RemoteDeploymentObservation | ProfileProof>
    | undefined;
  let active: Promise<unknown> | undefined;

  async function exclusively<T>(operation: () => Promise<T>): Promise<T> {
    if (finishResult) throw new Error("The owned terminal session has already finalized");
    const previous = active;
    const pending = (previous ?? Promise.resolve()).catch(() => undefined).then(operation);
    active = pending;
    try {
      return await pending;
    } finally {
      if (active === pending) active = undefined;
    }
  }

  const services = {
    operatorDiscovery: {
      async list() {
        listed = true;
        return [structuredClone(target)];
      },
      observe(targetId: string) {
        return exclusively(async () => {
          if (!listed || targetId !== target.id)
            throw new Error("Read a discovered terminal target");
          if (baseline) return structuredClone(baseline);
          const observed = await session.baseline();
          const identity =
            observed.state === initial.state &&
            observed.hasPriorIdentity === Boolean(initial.identity)
              ? initial.identity
              : null;
          const state =
            observed.state === "ready" && !identity
              ? "unverified"
              : observed.state;
          baseline = { target, identity, state, receipt: observed.receipt };
          return structuredClone(baseline);
        });
      },
    },
    operatorDeployment: {
      apply(receipt: string, operation: Action) {
        return exclusively(async () => {
          if (
            session.kind !== "deployment" ||
            !baseline ||
            requestedOperation ||
            receipt !== baseline.receipt ||
            target.grant !== operation ||
            !(
              (operation === "start" &&
                baseline.state === "inactive" &&
                !baseline.identity) ||
              (operation === "restart" &&
                baseline.state === "ready" &&
                baseline.identity)
            )
          )
            throw new Error(
              "Apply only the granted operation to the selected live baseline",
            );
          requestedOperation = operation;
          installation = await session.apply(receipt);
          return structuredClone(installation);
        });
      },
      verify(receipt: string) {
        return exclusively(async () => {
          if (
            session.kind !== "deployment" ||
            installation?.state !== "applied" ||
            receipt !== installation.receipt
          )
            throw new Error("Verify the current installer receipt");
          if (deployment) return structuredClone(deployment);
          deployment = await session.verify(receipt);
          return structuredClone(deployment);
        });
      },
    },
    operatorProfile: {
      inspect(receipt: string) {
        return exclusively(async () => {
          if (
            session.kind !== "terminal-profile" ||
            baseline?.state !== "ready" ||
            receipt !== baseline.receipt ||
            profile
          )
            throw new Error(
              "Inspect the terminal profile for the observed live hub",
            );
          const observed = await session.profile(receipt);
          profile = {
            ...observed,
            inviteAssigned: grant === "pair" && observed.inviteAssigned,
          };
          return structuredClone(profile);
        });
      },
      pair(receipt: string) {
        return exclusively(async () => {
          if (
            session.kind !== "terminal-profile" ||
            grant !== "pair" ||
            profile?.state !== "unpaired" ||
            !profile.inviteAssigned ||
            receipt !== profile.receipt ||
            pairing
          )
            throw new Error("Pair only the granted, observed terminal profile");
          pairing = await session.pair(receipt);
          return structuredClone(pairing);
        });
      },
      open(receipt: string) {
        return exclusively(async () => {
          if (
            session.kind !== "terminal-profile" ||
            pairing?.state !== "paired" ||
            receipt !== pairing.receipt ||
            route
          )
            throw new Error("Open the profile with its actual pairing receipt");
          route = await session.open(receipt);
          return structuredClone(route);
        });
      },
      verify(receipt: string) {
        return exclusively(async () => {
          if (
            session.kind !== "terminal-profile" ||
            route?.state !== "routed" ||
            receipt !== route.receipt
          )
            throw new Error("Verify the actual routed child");
          if (child) return structuredClone(child);
          child = await session.verify(receipt);
          return structuredClone(child);
        });
      },
    },
  };

  function finish() {
    finishResult ??= (async () => {
      try {
        await active;
      } catch {
        // A rejected operation still leaves an owned terminal attempt to retire.
      }
      return session.finish();
    })();
    return finishResult;
  }

  function expectedReport(): OperatorReport {
    const identity = deployment?.identity ?? baseline?.identity ?? null;
    return {
      status: world.expected.status,
      reason: world.expected.reason ?? null,
      targetId: target.id,
      identity,
      evidenceIds: [
        baseline,
        installation,
        deployment,
        profile,
        pairing,
        route,
        child,
      ].flatMap((value) => (value ? [value.receipt] : [])),
    };
  }

  async function verify(value: unknown) {
    const final = await finish();
    const report = value as DomainReport | null;
    const grantedDeployment =
      world.expected.status === "deployed"
        ? "start"
        : world.expected.status === "restarted"
          ? "restart"
          : undefined;
    const shouldPair = world.expected.status === "paired";
    const shouldInspectProfile = session.kind === "terminal-profile";
    const expectedInitial =
      world.target.surface === "deployment" ? world.target.initial : "ready";
    const checks = {
      discoveredOwnedTarget:
        listed && isDeepStrictEqual(baseline?.target, target),
      observedCurrentHub:
        baseline?.state === expectedInitial &&
        initial.state === expectedInitial &&
        isDeepStrictEqual(baseline.identity, initial.identity) &&
        (expectedInitial === "ready"
          ? Boolean(
              initial.identity?.serverId &&
              initial.identity.workspaceId &&
              initial.identity.bootId &&
              initial.identity.buildId,
            )
          : initial.identity === null),
      respectedOperatorAuthority:
        requestedOperation === grantedDeployment &&
        (grantedDeployment !== undefined) === Boolean(installation) &&
        (grantedDeployment !== undefined) === Boolean(deployment) &&
        shouldInspectProfile === Boolean(profile) &&
        shouldPair === Boolean(pairing) &&
        shouldPair === Boolean(route) &&
        shouldPair === Boolean(child),
      verifiedServiceOutcome:
        "state" in final
          ? grantedDeployment
            ? final.state === "ready" &&
              installation?.state === "applied" &&
              deployment?.state === "verified" &&
              isDeepStrictEqual(final.identity, deployment.identity) &&
              (grantedDeployment === "start" ||
                (initial.state === "ready" &&
                  initial.identity.serverId === final.identity.serverId &&
                  initial.identity.workspaceId === final.identity.workspaceId &&
                  initial.identity.bootId !== final.identity.bootId))
            : isDeepStrictEqual(final, initial)
          : final.stableDeployment &&
            final.persistedNewProfile === shouldPair &&
            profile?.state === "unpaired" &&
            (!shouldPair ||
              (pairing?.state === "paired" &&
                route?.state === "routed" &&
                child?.state === "verified" &&
                child.workspaceId === initial.identity?.workspaceId)),
      boundOperatorReport:
        report?.status === "workspace-skill-reviewed" &&
        report.skill === "operator" &&
        isDeepStrictEqual(report.outcome, expectedReport()),
    };
    return {
      ...input,
      goal: world.goal,
      target,
      initial,
      baseline,
      final,
      requestedOperation,
      installation,
      deployment,
      profile,
      pairing,
      route,
      child,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  async function qualify() {
    await services.operatorDiscovery.list();
    const observed = await services.operatorDiscovery.observe(target.id);
    let rejectedAlias = false;
    if (surface === "terminal-profile") {
      rejectedAlias = await services.operatorProfile
        .inspect("another-hub-receipt")
        .then(
          () => false,
          () => true,
        );
      const inspected = await services.operatorProfile.inspect(
        observed.receipt,
      );
      if (world.reference === "pair") {
        const refusedPair = await services.operatorProfile
          .pair("another-terminal-receipt")
          .then(
            () => false,
            () => true,
          );
        rejectedAlias = rejectedAlias && refusedPair;
        if (grant === "pair") {
          const paired = await services.operatorProfile.pair(inspected.receipt);
          const routed = await services.operatorProfile.open(paired.receipt);
          await services.operatorProfile.verify(routed.receipt);
        }
      }
    } else if (
      (world.reference === "restart" &&
        observed.state === "ready" &&
        grant === "restart") ||
      (world.reference === "ensure-ready" &&
        observed.state === "inactive" &&
        grant === "start")
    ) {
      const operation = grant;
      rejectedAlias = await services.operatorDeployment
        .apply("another-hub-receipt", operation)
        .then(
          () => false,
          () => true,
        );
      const applied = await services.operatorDeployment.apply(
        observed.receipt,
        operation,
      );
      await services.operatorDeployment.verify(applied.receipt);
    } else {
      rejectedAlias = await services.operatorDeployment
        .apply("another-hub-receipt", "start")
        .then(
          () => false,
          () => true,
        );
    }
    const proof = await verify({
      status: "workspace-skill-reviewed",
      skill: "operator",
      outcome: expectedReport(),
    });
    return { ...proof, rejectedAlias, passed: proof.passed && rejectedAlias };
  }

  return {
    goal: world.goal,
    services,
    verify,
    qualify,
    close: async () => {
      await finish();
    },
  };
}

export async function prepareOpenGoalOperator(input: Input) {
  if (input.contextId !== actualContextId)
    throw new Error("The operator goal belongs to another context");
  const world = operatorGoalWorlds.find(({ id }) => id === input.caseId);
  if (!world) throw new Error("Unknown open operator goal");
  const terminal = await openClientDevice("terminal");
  if (world.target.surface === "terminal-profile") {
    const { operationId, identity } = await terminal.call(
      "remoteCommissionBegin",
      {},
    );
    const step = async <Stage extends keyof RemoteCommissionStages>(
      step: Stage,
      evidence: string,
    ) =>
      (await terminal.call("remoteCommissionStep", {
        operationId,
        step,
        evidence,
      })) as RemoteCommissionStages[Stage];
    return bindOpenGoalOperator(input, world, {
      kind: "terminal-profile",
      initial: { state: "ready", identity },
      baseline: () => step("baseline", operationId),
      async profile(receipt) {
        const handoff = await step("handoff", receipt);
        if (handoff.state !== "assigned" || !handoff.operationId)
          throw new Error(
            "The observed hub no longer admits this terminal profile",
          );
        return step("profile", handoff.operationId);
      },
      pair: (receipt) => step("pair", receipt),
      open: (receipt) => step("route", receipt),
      verify: (receipt) => step("child", receipt),
      finish: () => terminal.call("remoteCommissionFinish", { operationId }),
    });
  }
  const intent = world.target.initial === "ready" ? "update" : "deploy";
  const { operationId, initial } = await terminal.call(
    "remoteDeploymentBegin",
    { intent },
  );
  const step = async <Stage extends keyof RemoteDeploymentStages>(
    step: Stage,
    evidence: string,
  ) =>
    (await terminal.call("remoteDeploymentStep", {
      operationId,
      step,
      evidence,
    })) as RemoteDeploymentStages[Stage];
  return bindOpenGoalOperator(input, world, {
    kind: "deployment",
    initial,
    baseline: () => step("baseline", operationId),
    apply: (receipt) => step("apply", receipt),
    verify: (receipt) => step("verify", receipt),
    finish: () => terminal.call("remoteDeploymentFinish", { operationId }),
  });
}
