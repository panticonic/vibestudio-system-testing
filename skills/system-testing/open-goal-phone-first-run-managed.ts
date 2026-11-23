import { isDeepStrictEqual } from "node:util";
import { workspaceReadinessFromLog } from "@vibestudio/shared/mobileWorkspaceReadiness";
import { PhoneProviderSchema } from "@vibestudio/service-schemas/phoneProvisioning";
import { parseWorkspaceSystemEpochEnvelope } from "@vibestudio/workspace/configParser";
import { parseTemplateManifestContent } from "@vibestudio/workspace/templateManifest";
import {
  CURRENT_HOST_ABI,
  isClientRuntime,
} from "@vibestudio/workspace-contracts/clients";
import type { bindPhoneSetup } from "@workspace-skills/phone-setup/workflow";
import type { eligiblePhoneDesktops } from "@workspace-skills/phone-setup/eligibility";
import type { workspacePhoneReadiness } from "@workspace-clients/mobile-browser/phone-readiness";
import type { VcsClient } from "@workspace/runtime";
import type { PhoneFirstRunWorld } from "./open-goal-phone-first-run-worlds.js";

type Ports = {
  contextId: string | null;
  vcs: Pick<VcsClient, "status" | "resolveRepository" | "readFile">;
  workspacePhoneReadiness: typeof workspacePhoneReadiness;
  bindPhoneSetup: typeof bindPhoneSetup;
  eligiblePhoneDesktops: typeof eligiblePhoneDesktops;
};
type Journal = {
  service: string;
  method: string;
  args: unknown[];
  result: unknown;
};
type Session = NonNullable<Parameters<typeof workspacePhoneReadiness>[0]>;

function visibleSession(world: PhoneFirstRunWorld): Session | undefined {
  switch (world.session ?? "missing") {
    case "missing":
      return undefined;
    case "await-approval":
      return {
        state: "ready",
        readiness: "shell-ready",
        transport: "connected",
      };
    case "reconciled":
      return {
        state: "ready",
        readiness: "reconciled",
        transport: "connected",
      };
    case "disconnected":
      return {
        state: "ready",
        readiness: "reconciled",
        transport: "disconnected",
      };
    case "owned-error":
      return {
        state: "failed",
        readiness: "reconciled",
        transport: "connected",
        error: "The assigned workspace rejected its initialization.",
      };
    case "reconcile-error":
      return {
        state: "ready",
        readiness: "failed",
        transport: "connected",
        error: "First authoritative reconciliation failed.",
      };
    case "starting":
      return {
        state: "opening",
        readiness: "connecting",
        transport: "connected",
      };
  }
}

function readPhases(world: PhoneFirstRunWorld, id: string, targetId: string) {
  const assignedPid = "503";
  const since = 1_000_000;
  const source = world.logs ?? "none";
  const evidence = {
    id,
    status: "unavailable" as
      | "unavailable"
      | "rejected"
      | "await-shell"
      | "await-connection"
      | "complete"
      | "failed",
    observedConnection: false,
    observedShell: false,
    observedPanel: false,
    issues: [] as string[],
  };
  if (source === "none") return evidence;
  const lines = {
    older: [
      "998 phase=workspace-shell-ready",
      "999 phase=workspace-iroh-connected",
    ],
    connected: ["1001 phase=workspace-iroh-connected"],
    shell: ["1001 phase=workspace-shell-ready"],
    both: [
      "1001 phase=workspace-iroh-connected",
      "1002 phase=workspace-shell-ready",
    ],
    panel: [
      "1001 phase=workspace-iroh-connected",
      "1002 phase=workspace-shell-ready",
      "1003 phase=workspace-panel-webview-loaded",
    ],
    "login-error": [
      "1001 phase=workspace-iroh-connected",
      "1002 phase=workspace-shell-ready",
      "1003 phase=workspace-login-error owned setup denied",
    ],
    "webview-error": [
      "1001 phase=workspace-iroh-connected",
      "1002 phase=workspace-shell-ready",
      "1003 phase=workspace-panel-webview-http-error 503",
    ],
    corrupt: [
      "1001 phase=workspace-iroh-connected",
      "1002 invalid distance code",
    ],
    "foreign-process": [
      "1001 phase=workspace-iroh-connected",
      "1002 phase=workspace-shell-ready",
    ],
  }[source];
  const capture = {
    targetId,
    stream: "workspace-logcat-epoch",
    pid: source === "foreign-process" ? "901" : assignedPid,
    text: lines.join("\n"),
  };
  if (
    capture.pid !== assignedPid ||
    capture.targetId !== targetId ||
    capture.stream !== "workspace-logcat-epoch" ||
    lines.some((line) => !/^\d+(?:\.\d+)?\s/u.test(line))
  ) {
    return { ...evidence, status: "rejected" as const };
  }
  const parsed = workspaceReadinessFromLog(capture.text, since);
  return {
    id,
    status: parsed.issues.length
      ? ("failed" as const)
      : parsed.ready
        ? ("complete" as const)
        : parsed.panelHostReady
          ? ("await-connection" as const)
          : ("await-shell" as const),
    observedConnection: parsed.workspaceConnected,
    observedShell: parsed.panelHostReady,
    observedPanel: parsed.panelWebViewLoaded,
    issues: parsed.issues,
  };
}

export async function preparePhoneFirstRun(
  input: { contextId: string; caseId: string },
  world: PhoneFirstRunWorld,
  ports: Ports,
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("Phone rehearsal belongs to a different System context");
  const status = () => ports.vcs.status({ contextId: input.contextId });
  const baseline = await status();
  const state = { kind: "event" as const, eventId: baseline.mainEventId };
  const platform = world.platform ?? "android";
  const mode = world.mode ?? "auto";
  const id = crypto.randomUUID();
  const targetId = "rehearsal-device-" + id;
  const card = { id, title: world.name, edition: "current" as const };
  const archived = {
    id: crypto.randomUUID(),
    title: world.name + " archive",
    edition: "archive" as const,
  };
  const desktops = ports.eligiblePhoneDesktops(
    PhoneProviderSchema.array().parse(
      (world.providers ?? []).map((providerId) => {
        const hostPlatform = providerId.startsWith("mac") ? "darwin" : "linux";
        const platforms =
          hostPlatform === "darwin" ? ["android", "ios"] : ["android"];
        return {
          providerId,
          label: providerId,
          hostPlatform,
          platforms,
          sourcePlatforms: providerId.endsWith("source") ? platforms : [],
          appVersion: "fixture-declared",
        };
      }),
    ),
    { platform, mode, providerId: world.selected },
  );
  const assignedOwner = "rehearsal-owner-" + id;
  const priorPairing = world.paired
    ? {
        deviceId: targetId,
        owner:
          world.paired === "foreign"
            ? "another-rehearsal-owner"
            : assignedOwner,
        workspace:
          world.paired === "wrong-workspace"
            ? "another-system-context"
            : input.contextId,
      }
    : null;
  const paired =
    priorPairing === null
      ? ("none" as const)
      : priorPairing.owner !== assignedOwner
        ? ("foreign-owner" as const)
        : priorPairing.workspace !== input.contextId
          ? ("foreign-workspace" as const)
          : ("owned" as const);
  let unwantedOperations = 0;
  const denied = async (): Promise<never> => {
    unwantedOperations++;
    throw new Error(
      "The owned phone rehearsal has no preparation, installation or pairing authority",
    );
  };
  const ready = ports.workspacePhoneReadiness(visibleSession(world));
  const bound = await ports.bindPhoneSetup(
    { goal: world.goal, paired: { deviceId: targetId, platform } },
    {
      client: {
        providers: denied,
        prepare: denied,
        devices: denied,
        provision: denied,
        waitForWorkspace: denied,
        readiness: async (target) => {
          if (paired !== "owned" || target !== priorPairing?.deviceId)
            return denied();
          return ready;
        },
      },
    },
  );
  const assignment = {
    id,
    targetId,
    platform,
    mode,
    paired,
    desktops,
    installed: world.installed ?? "absent",
    setupRequest: paired === "owned" ? bound.request : null,
  };
  const journal: Journal[] = [];
  const keep = <T>(
    service: string,
    method: string,
    args: unknown[],
    result: T,
  ): T => {
    journal.push({
      service,
      method,
      args: structuredClone(args),
      result: structuredClone(result),
    });
    return result;
  };
  function requireDossier(key: string) {
    if (id !== key)
      throw new Error("Read only the assigned current phone rehearsal");
  }
  async function readText(repoPath: string, path: string) {
    const repo = await ports.vcs.resolveRepository({ state, repoPath });
    if (!repo || repo.repoPath !== repoPath)
      throw new Error("Missing installed System " + repoPath);
    const content = await ports.vcs.readFile({
      state,
      repositoryId: repo.repositoryId,
      file: { kind: "path", path },
    });
    if (content?.content.kind !== "text")
      throw new Error("Missing installed System " + repoPath + "/" + path);
    return { text: content.content.text, hash: content.contentHash };
  }
  async function buildEvidence() {
    const [workspace, clientFile] = await Promise.all([
      readText("meta", "vibestudio.yml"),
      readText("clients/mobile-browser", "package.json"),
    ]);
    const config = parseTemplateManifestContent(
      workspace.text,
      parseWorkspaceSystemEpochEnvelope(workspace.text),
    );
    const providers = config.top.runtimeExtensions?.["react-native"] ?? [];
    if (!providers.includes("extensions/react-native"))
      throw new Error("The System React Native provider is not declared");
    const provider = await readText("extensions/react-native", "package.json");
    const info = JSON.parse(clientFile.text).vibestudio?.client;
    const providerPackage = JSON.parse(provider.text).name;
    if (
      info?.id !== "browser" ||
      !isClientRuntime(info.runtime) ||
      typeof info.hostAbi !== "string" ||
      typeof providerPackage !== "string"
    )
      throw new Error(
        "Installed mobile client or provider declaration is invalid",
      );
    return {
      id,
      revision: baseline.mainEventId,
      client: "clients/mobile-browser",
      runtime: info.runtime,
      abi: info.hostAbi,
      expectedAbi: CURRENT_HOST_ABI["react-native"],
      provider: "extensions/react-native",
      providerPackage,
      manifestDigest: workspace.hash,
      clientDigest: clientFile.hash,
    };
  }
  const service = {
    async discover() {
      return keep("phoneFirstRun", "discover", [], [card, archived]);
    },
    async inspect(key: string) {
      requireDossier(key);
      return keep("phoneFirstRun", "inspect", [key], assignment);
    },
    async phases(key: string) {
      requireDossier(key);
      return keep(
        "phoneFirstRun",
        "phases",
        [key],
        readPhases(world, id, targetId),
      );
    },
    async provider(key: string) {
      requireDossier(key);
      return keep("phoneFirstRun", "provider", [key], await buildEvidence());
    },
  };
  const services = {
    phoneFirstRun: service,
    phoneSetupRead: {
      async start(operation: string) {
        if (paired !== "owned") return denied();
        return keep(
          "phoneSetupRead",
          "start",
          [operation],
          await bound.services.phoneSetupRead.start(operation),
        );
      },
      discover: denied,
      async readiness(receipt: string) {
        if (paired !== "owned") return denied();
        return keep(
          "phoneSetupRead",
          "readiness",
          [receipt],
          await bound.services.phoneSetupRead.readiness(receipt),
        );
      },
    },
    phoneSetupPrepare: { prepare: denied },
    phoneSetupPair: { provision: denied },
  };
  type ReadyReport = {
    status: string;
    pairedDeviceId: string;
    evidenceIds: string[];
    guidance: string | null;
  };
  type Outcome = {
    scope: string;
    decision: { action: string; reason: string };
    evidence: {
      card: typeof card;
      assignment: typeof assignment;
      startup: ReturnType<typeof readPhases>;
      build: Awaited<ReturnType<typeof buildEvidence>>;
      resume: ReadyReport | null;
    };
  };
  async function verify(report: unknown) {
    const envelope = report as {
      status?: string;
      skill?: string;
      outcome?: Outcome;
    } | null;
    const outcome = envelope?.outcome;
    const phases = readPhases(world, id, targetId);
    const build = await buildEvidence();
    const { expected } = world;
    const after = await status();
    const match = (
      name: string,
      method: string,
      args: unknown[],
      result: unknown,
    ) => {
      const rows = journal.filter(
        (row) => row.service === name && row.method === method,
      );
      return (
        rows.some((row) => isDeepStrictEqual(row.args, args) && isDeepStrictEqual(row.result, result))
      );
    };
    const start = journal.find((row) => row.method === "start")?.result as
      | Awaited<ReturnType<typeof services.phoneSetupRead.start>>
      | undefined;
    const readback = journal.find((row) => row.method === "readiness")
      ?.result as
      | Awaited<ReturnType<typeof services.phoneSetupRead.readiness>>
      | undefined;
    const resume = outcome?.evidence?.resume;
    const checks = {
      exactPhoneDesktopEligibility:
        match("phoneFirstRun", "discover", [], [card, archived]) &&
        match("phoneFirstRun", "inspect", [id], assignment) &&
        isDeepStrictEqual(
          desktops.map((value) => value.providerId),
          expected.eligible ?? [],
        ) &&
        isDeepStrictEqual(outcome?.evidence?.assignment, assignment) &&
        isDeepStrictEqual(outcome?.evidence?.card, card),
      preservedOwnedPairing:
        paired === "owned"
          ? Boolean(
              start &&
              readback &&
              start.pairedDeviceId === targetId &&
              match(
                "phoneSetupRead",
                "start",
                [bound.request.operationId],
                start,
              ) &&
              match("phoneSetupRead", "readiness", [start.receipt], readback) &&
              readback.state === expected.ready &&
              resume?.status === "workspace-" + expected.ready &&
              resume.pairedDeviceId === targetId &&
              isDeepStrictEqual(resume.evidenceIds, [
                start.receipt,
                readback.receipt,
              ]),
            )
          : start === undefined && readback === undefined && resume === null,
      exactScopedMobileDebugPhases:
        phases.status === (expected.phases ?? "unavailable") &&
        match("phoneFirstRun", "phases", [id], phases) &&
        isDeepStrictEqual(outcome?.evidence?.startup, phases),
      exactInstalledReactNativeDeclaration:
        build.runtime === "react-native" &&
        build.abi === build.expectedAbi &&
        build.providerPackage === "@workspace-extensions/react-native" &&
        match("phoneFirstRun", "provider", [id], build) &&
        isDeepStrictEqual(outcome?.evidence?.build, build),
      matchedReadOnlyPhoneDisposition:
        envelope?.status === "workspace-skill-reviewed" &&
        envelope.skill === "phoneFirstRun" &&
        outcome?.scope === "owned-phone-eligibility-rehearsal" &&
        outcome.decision?.action === expected.action &&
        typeof outcome.decision.reason === "string" &&
        Boolean(outcome.decision.reason.trim()) &&
        after.mainEventId === baseline.mainEventId &&
        isDeepStrictEqual(after.workingHead, baseline.workingHead) &&
        unwantedOperations === 0 &&
        (paired === "owned" || journal.every(({ service }) => service !== "phoneSetupRead")),
    };
    return {
      contextId: input.contextId,
      caseId: world.id,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      card,
      assignment,
      phases,
      build,
      resume,
      journal: structuredClone(journal),
      unwantedOperations,
    };
  }
  async function qualify() {
    const cards = await service.discover();
    let rejectedArchive = false;
    try {
      await service.inspect(cards[1]!.id);
    } catch {
      rejectedArchive = true;
    }
    await service.inspect(id);
    const startup = await service.phases(id);
    const build = await service.provider(id);
    let resume = null;
    if (paired === "owned") {
      const start = await services.phoneSetupRead.start(
        bound.request.operationId,
      );
      const current = await services.phoneSetupRead.readiness(start.receipt);
      resume = {
        status: "workspace-" + current.state,
        pairedDeviceId: targetId,
        evidenceIds: [start.receipt, current.receipt],
        guidance: null,
      };
    }
    const report = {
      status: "workspace-skill-reviewed",
      skill: "phoneFirstRun",
      outcome: {
        scope: "owned-phone-eligibility-rehearsal",
        evidence: { card, assignment, startup, build, resume },
        decision: {
          action: world.expected.action,
          reason: "Exact retained phone setup evidence.",
        },
      },
    };
    const result = await verify(report);
    const wrong = structuredClone(report);
    wrong.outcome.evidence.build.provider = "extensions/foreign";
    const rejectedForeignProof = !(await verify(wrong)).passed;
    const checks = { ...result.checks, rejectedArchive, rejectedForeignProof };
    return {
      ...result,
      checks,
      passed: Object.values(checks).every(Boolean),
      report,
    };
  }
  return { services, verify, qualify };
}
