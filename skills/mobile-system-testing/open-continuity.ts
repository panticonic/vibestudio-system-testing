import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { ReadyClientSchema } from "@vibestudio/service-schemas/clients";
import {
  clientUnitManifestDescriptor,
  extensionUnitManifestDescriptor,
  validateUnitManifest,
} from "@vibestudio/shared/unitManifest";
import type { RuntimeFs, VcsClient } from "@workspace/runtime";
import { bindMobileScenario, INTERNAL_PACKAGE } from "./bindings.js";
import {
  observeFixtureCache,
  observeFixtureRoutes,
  observeFixtureTransport,
} from "./continuity.js";
import type {
  BuildCase,
  OpenMobileContinuityWorld,
} from "@workspace-skills/system-testing/open-goal-mobile-continuity-worlds";

const clientSource = "clients/mobile-browser";
const providerSource = "extensions/react-native";
type ManifestConfig = {
  name: string;
  vibestudio: {
    client: {
      id: string;
      runtime: string;
      hostAbi: string;
      capabilities: { required: string[] };
    };
  };
};
type ProviderConfig = {
  name: string;
  vibestudio: { extension: { contributes: { buildTargets: string[] } } };
};
type Profile = {
  id: string;
  title: string;
  workspace: string;
  device: string;
  edition: "current" | "archive";
  server: string;
  packageName: string;
  adbState: "ready" | "offline";
  expectedBuild: string;
};
type Seed = OpenMobileContinuityWorld["fixture"];
type FixtureRecord = { profile: Profile; replay: Seed; launch: unknown };
type Ports = {
  contextId: string | null;
  fs: Pick<RuntimeFs, "readFile" | "writeFile" | "mkdtemp" | "rm" | "readdir">;
  vcs: Pick<VcsClient, "status">;
};
type Effect = {
  service: "mobileContinuity";
  method: string;
  args: unknown[];
  result: unknown;
};
type Evidence = {
  build: Awaited<ReturnType<typeof observeBuild>>;
  cache: Awaited<ReturnType<typeof observeFixtureCache>> & { id: string };
  transport: Awaited<ReturnType<typeof observeFixtureTransport>> & {
    id: string;
    failureKind: string | null;
  };
  routes: ReturnType<typeof observeFixtureRoutes> & { id: string };
};
type Outcome = {
  profile: string;
  action: string;
  scope: string;
  reason: string;
  evidence: Evidence;
};
const issue = {
  exact: null,
  "wrong-package": "package",
  offline: "offline",
  abi: "host-abi",
  capability: "required-capability",
  "old-build": "build",
  "invalid-artifact": "artifact-record",
} satisfies { [K in BuildCase]: string | null };

async function readDeclaration(fs: Ports["fs"]) {
  const [clientRaw, providerRaw] = await Promise.all([
    fs.readFile("/" + clientSource + "/package.json", "utf8"),
    fs.readFile("/" + providerSource + "/package.json", "utf8"),
  ]);
  const clientText = String(clientRaw);
  const providerText = String(providerRaw);
  const client = JSON.parse(clientText) as ManifestConfig;
  const provider = JSON.parse(providerText) as ProviderConfig;
  validateUnitManifest(clientUnitManifestDescriptor, client.vibestudio, {
    unitName: client.name,
  });
  validateUnitManifest(extensionUnitManifestDescriptor, provider.vibestudio, {
    unitName: provider.name,
  });
  const declaration = client.vibestudio.client;
  if (
    declaration.runtime !== "react-native" ||
    !provider.vibestudio.extension.contributes.buildTargets.includes(
      declaration.runtime,
    )
  )
    throw new Error(
      "The installed mobile app and local React Native provider do not agree",
    );
  return {
    declaration,
    clientManifestDigest: sha256HexSyncText(clientText),
    providerManifestDigest: sha256HexSyncText(providerText),
  };
}

function launchRecord(
  profile: Profile,
  replay: Seed,
  config: Awaited<ReturnType<typeof readDeclaration>>,
) {
  const declaration = config.declaration;
  return {
    source: clientSource,
    id: declaration.id,
    runtime: declaration.runtime,
    hostAbi: replay.build === "abi" ? "rn-host-1" : declaration.hostAbi,
    title: profile.title,
    buildKey:
      replay.build === "old-build"
        ? "retired-" + profile.expectedBuild
        : profile.expectedBuild,
    executionDigest: sha256HexSyncText(profile.id + ":execution"),
    effectiveVersion: "release:" + profile.expectedBuild,
    artifacts: [
      {
        path: "index.android.bundle",
        role: "bundle",
        platform: "android",
        contentType: "application/javascript",
        integrity:
          replay.build === "invalid-artifact"
            ? "missing-sha"
            : "sha256-" + sha256HexSyncText(profile.expectedBuild + ":bundle"),
      },
    ],
    grantedCapabilities:
      replay.build === "capability"
        ? declaration.capabilities.required.slice(1)
        : declaration.capabilities.required,
    deniedOptional: [],
  };
}

async function observeBuild(
  record: FixtureRecord,
  config: Awaited<ReturnType<typeof readDeclaration>>,
) {
  const { profile } = record;
  const parsed = ReadyClientSchema.safeParse(record.launch);
  const result = parsed.success ? parsed.data : null;
  const { declaration, clientManifestDigest, providerManifestDigest } = config;
  const failed: string[] = [];
  if (profile.packageName !== INTERNAL_PACKAGE) failed.push("package");
  if (profile.adbState !== "ready") failed.push("offline");
  if (!result) failed.push("artifact-record");
  if (
    result &&
    (result.source !== clientSource ||
      result.runtime !== declaration.runtime ||
      result.id !== declaration.id)
  )
    failed.push("client-identity");
  if (result && result.hostAbi !== declaration.hostAbi) failed.push("host-abi");
  if (result && result.buildKey !== profile.expectedBuild) failed.push("build");
  if (
    result &&
    declaration.capabilities.required.some(
      (capability) =>
        !(result.grantedCapabilities as string[]).includes(capability),
    )
  )
    failed.push("required-capability");
  return {
    id: profile.id + "/build",
    clientSource,
    providerSource,
    clientManifestDigest,
    providerManifestDigest,
    declaredAbi: declaration.hostAbi,
    expectedBuild: profile.expectedBuild,
    observedBuild: result?.buildKey ?? null,
    artifactIntegrity:
      result?.artifacts.find((artifact) => artifact.platform === "android")
        ?.integrity ?? null,
    granted: result?.grantedCapabilities ?? [],
    failed,
  };
}

function failureFor(seed: Seed) {
  return seed.failure === "none"
    ? null
    : { code: "CONNECTION_LOST", errorKind: seed.failure };
}

function expectedEvidence(record: FixtureRecord, evidence: Evidence) {
  const { profile, replay } = record;
  const knownIssue = issue[replay.build];
  const state =
    replay.transport === "revoked"
      ? "revoked"
      : ["server-swap", "no-hub"].includes(replay.transport)
        ? "closed"
        : "connected";
  const recoveries =
    state === "connected"
      ? [replay.transport === "cold" ? "cold-recover" : "resubscribe"]
      : [];
  const opens = ["retired-callback", "server-swap", "ordinary-close"].includes(
    replay.transport,
  )
    ? 2
    : 1;
  const rejected = ["old-schema", "invalid-tree"].includes(replay.cache);
  const cache =
    replay.cache === "exact" ? "loaded" : rejected ? "rejected" : "absent";
  const expectedRoutes = {
    owned:
      replay.routes === "empty"
        ? []
        : replay.routes === "foreign"
          ? ["panel:tree/notes"]
          : replay.routes === "mixed"
            ? ["panel:tree/overview"]
            : ["panel:tree/overview", "panel:tree/notes"],
    lost: replay.routes === "foreign" ? ["panel:tree/overview"] : [],
    unleased:
      replay.routes === "empty"
        ? ["panel:tree/overview", "panel:tree/notes"]
        : replay.routes === "mixed"
          ? ["panel:tree/notes"]
          : [],
    invalidated:
      replay.routes === "current-release" ? ["panel:tree/overview"] : [],
  };
  return {
    scopedMobileBuild:
      isDeepStrictEqual(
        evidence.build.failed,
        knownIssue ? [knownIssue] : [],
      ) && evidence.build.expectedBuild === profile.expectedBuild,
    verifiedMobileCacheBoundary:
      evidence.cache.status === cache &&
      evidence.cache.removedBadRecord === rejected &&
      evidence.cache.preferredSlot ===
        (cache === "loaded" ? "panel:tree/overview" : null) &&
      evidence.cache.treeRevision === (cache === "loaded" ? 10 : null),
    verifiedMobileReconnect:
      evidence.transport.state === state &&
      evidence.transport.opens === opens &&
      isDeepStrictEqual(evidence.transport.recovered, recoveries) &&
      evidence.transport.caller ===
        (state === "connected" ? "shell:" + profile.device : null) &&
      evidence.transport.server ===
        (replay.transport === "no-hub" ? null : profile.server) &&
      evidence.transport.transient ===
        (replay.failure === "none" ? null : replay.failure === "transport"),
    verifiedMobileRouteOwnership: isDeepStrictEqual(
      { ...evidence.routes, id: undefined },
      { ...expectedRoutes, id: undefined },
    ),
  };
}

export async function prepareOpenMobileContinuity(
  input: { contextId: string; caseId: string },
  world: OpenMobileContinuityWorld,
  ports: Ports,
) {
  if (input.caseId !== world.id || input.contextId !== ports.contextId)
    throw new Error("Mobile continuity belongs to another owned context");
  const { fs, vcs } = ports;
  const workspaceHead = () => vcs.status({ contextId: input.contextId });
  const baseline = await workspaceHead();
  const config = await readDeclaration(fs);
  const prefix = sha256HexSyncText(input.contextId + ":" + world.id);
  const make = (
    edition: Profile["edition"],
    suffix: string,
    replay: Seed,
  ): FixtureRecord => {
    const profile: Profile = {
      id: edition + "-" + prefix.slice(0, 12),
      title: world.profile.title,
      workspace: world.profile.workspace + suffix,
      server: sha256HexSyncText(prefix + edition),
      device:
        "dev_" + sha256HexSyncText(prefix + ":device:" + edition).slice(0, 24),
      edition,
      packageName:
        replay.build === "wrong-package"
          ? "app.vibestudio.mobile"
          : INTERNAL_PACKAGE,
      adbState: replay.build === "offline" ? "offline" : "ready",
      expectedBuild: sha256HexSyncText(prefix + ":declared:" + edition),
    };
    return { profile, replay, launch: launchRecord(profile, replay, config) };
  };
  const current = make("current", "", world.fixture);
  const archived = make("archive", " previous account", {
    cache: "exact",
    build: "exact",
    transport: "warm",
    routes: "owned",
    failure: "none",
  });
  const directory = await fs.mkdtemp("mobile-continuity");
  const close = () => fs.rm(directory, { recursive: true, force: true });
  const scopedRecords = new Map(
    [archived, current].map((record) => [
      record.profile.id,
      JSON.stringify(record),
    ]),
  );
  const file = (id: string) => {
    if (!scopedRecords.has(id))
      throw new Error("Profile is outside the owned mobile fixture");
    return directory + "/" + id + ".json";
  };
  try {
    for (const [id, contents] of scopedRecords)
      await fs.writeFile(file(id), contents);
  } catch (error) {
    await close();
    throw error;
  }
  const read = async (id: string): Promise<FixtureRecord> => {
    const raw = String(await fs.readFile(file(id), "utf8"));
    if (raw !== scopedRecords.get(id))
      throw new Error(
        "The retained mobile fixture record changed before review",
      );
    return JSON.parse(raw) as FixtureRecord;
  };
  const evidenceFor = async (id: string) => {
    const record = await read(id);
    const { profile, replay } = record;
    const [build, cache, transport] = await Promise.all([
      observeBuild(record, config),
      observeFixtureCache(profile, replay.cache),
      observeFixtureTransport(profile, replay.transport, failureFor(replay)),
    ]);
    return {
      build,
      cache: { id: id + "/cache", ...cache },
      routes: {
        id: id + "/routes",
        ...observeFixtureRoutes(profile, replay.routes),
      },
      transport: {
        id: id + "/transport",
        ...transport,
        failureKind: failureFor(replay)?.errorKind ?? null,
      },
    };
  };
  const journal: Effect[] = [];
  const log = <T>(method: string, args: unknown[], result: T): T => {
    journal.push(
      structuredClone({ service: "mobileContinuity", method, args, result }),
    );
    return structuredClone(result);
  };
  let listed = false;
  const observedProfiles = new Set<string>();
  async function observed(id: string) {
    if (!observedProfiles.has(id))
      throw new Error("Read the matching owned mobile profile first");
    return read(id);
  }
  const services = {
    mobileContinuity: {
      async discover() {
        const records = await Promise.all([...scopedRecords.keys()].map(read));
        listed = true;
        return log(
          "discover",
          [],
          records.map(
            ({ profile: { id, title, workspace, device, edition } }) => ({
              id,
              title,
              workspace,
              device,
              edition,
            }),
          ),
        );
      },
      async profile(id: string) {
        if (!listed)
          throw new Error("Discover the owned mobile profiles first");
        const { profile } = await read(id);
        const impossible = async () => {
          throw new Error(
            "A mobile continuity fixture never dispatches install or pairing",
          );
        };
        const bound = bindMobileScenario(
          {
            goal: world.goal,
            workspace: profile.workspace,
            scenario: "development",
            deviceId: profile.device,
            authority: "inspect",
            reset: false,
          },
          {
            inventory: async () => ({
              workspace: profile.workspace,
              provider: null,
              foreground: false,
              tooling: false,
              devices: [{ id: profile.device, state: profile.adbState }],
            }),
            pair: impossible,
            workspace: impossible,
            install: impossible,
            app: impossible,
          },
        );
        const inventory = await bound.mobileInventory.read();
        if (
          inventory.workspace !== profile.workspace ||
          inventory.devices[0]?.id !== profile.device
        )
          throw new Error(
            "The owned Android inventory does not identify this fixture profile",
          );
        observedProfiles.add(id);
        return log("profile", [id], profile);
      },
      async build(id: string) {
        return log(
          "build",
          [id],
          await observeBuild(await observed(id), config),
        );
      },
      async cache(id: string) {
        const { profile, replay } = await observed(id);
        return log("cache", [id], {
          id: id + "/cache",
          ...(await observeFixtureCache(profile, replay.cache)),
        });
      },
      async transport(id: string) {
        const { profile, replay } = await observed(id);
        const failure = failureFor(replay);
        return log("transport", [id], {
          id: id + "/transport",
          ...(await observeFixtureTransport(
            profile,
            replay.transport,
            failure,
          )),
          failureKind: failure?.errorKind ?? null,
        });
      },
      async routes(id: string) {
        const { profile, replay } = await observed(id);
        return log("routes", [id], {
          id: id + "/routes",
          ...observeFixtureRoutes(profile, replay.routes),
        });
      },
    },
  };

  async function verify(value: unknown) {
    const envelope = value as {
      status?: string;
      skill?: string;
      outcome?: Outcome;
    } | null;
    const outcome = envelope?.outcome;
    const id = current.profile.id;
    const durable = await evidenceFor(id);
    const status = await workspaceHead();
    const independentRecordRead = await Promise.all(
      [...scopedRecords.keys()].map(read),
    );
    const originalDeclaration = await readDeclaration(fs);
    const checks = {
      ...expectedEvidence(current, durable),
      discoveredScopedMobileProfile:
        listed &&
        [...scopedRecords.keys()].every((id) => observedProfiles.has(id)) &&
        independentRecordRead.some((record) =>
          isDeepStrictEqual(record, current),
        ),
      joinedExactMobileObservations: [
        "build",
        "cache",
        "transport",
        "routes",
      ].every((method) => {
        const current = journal.filter((row) => row.method === method);
        return (
          current.length === 1 &&
          current[0]?.args[0] === id &&
          isDeepStrictEqual(
            current[0].result,
            durable[method as keyof Evidence],
          )
        );
      }),
      matchedBoundMobileDecision:
        envelope?.status === "workspace-skill-reviewed" &&
        envelope.skill === "mobileContinuity" &&
        outcome?.scope === "owned-fixture" &&
        outcome.profile === id &&
        outcome.action === world.expected.action &&
        isDeepStrictEqual(outcome.evidence, durable) &&
        typeof outcome.reason === "string" &&
        world.expected.terms.every((term) =>
          outcome.reason.toLowerCase().includes(term),
        ),
      preservedMobileSourceAndScope:
        isDeepStrictEqual(config, originalDeclaration) &&
        status.mainEventId === baseline.mainEventId &&
        isDeepStrictEqual(status.workingHead, baseline.workingHead) &&
        isDeepStrictEqual(
          (await fs.readdir(directory)).sort(),
          [...scopedRecords.keys()].map((id) => id + ".json").sort(),
        ),
    };
    return {
      contextId: input.contextId,
      caseId: input.caseId,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      profile: current.profile,
      observations: durable,
      journal,
    };
  }

  async function qualify() {
    const service = services.mobileContinuity;
    const profiles = await service.discover();
    let rejectedAlias = false;
    try {
      await service.profile("outside-device");
    } catch {
      rejectedAlias = true;
    }
    for (const profile of profiles) await service.profile(profile.id);
    const id = current.profile.id;
    const [build, cache, transport, routes] = await Promise.all([
      service.build(id),
      service.cache(id),
      service.transport(id),
      service.routes(id),
    ]);
    const outcome = {
      profile: id,
      scope: "owned-fixture",
      action: world.expected.action,
      reason: world.expected.terms.join(" "),
      evidence: { build, cache, transport, routes },
    };
    const proof = await verify({
      status: "workspace-skill-reviewed",
      skill: "mobileContinuity",
      outcome,
    });
    return {
      ...proof,
      passed: proof.passed && rejectedAlias,
      checks: { ...proof.checks, rejectedMobileProfileAlias: rejectedAlias },
    };
  }
  return { goal: world.goal, services, verify, qualify, close };
}
