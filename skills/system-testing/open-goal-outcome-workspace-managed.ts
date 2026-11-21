import { sha256HexSyncText, stableSha256Hex } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { contextId, fs, rpc } from "@workspace/runtime";
import type { IntentDescription, IntentNotice, IntentObservation } from "@workspace-skills/open-intent-discovery/types";
import type { OutcomeWorkspaceWorld } from "./open-goal-outcome-workspace-worlds.js";

const readMethod = "service:fs.readBytes";
const maxDocumentLength = 10_000;
type Input = { contextId: string; caseId: string };
type WriteResult = { status: "written"; version: string } | { status: "changed" | "unavailable" };
type Report = {
  status?: string;
  path?: string;
  version?: string;
  outcome?: { summary?: string; explanation?: string; evidence?: unknown; outcome?: { summary?: string } };
};

const readText = async (path: string) => {
  const value = await fs.readFile(path, "utf8");
  if (typeof value !== "string") throw new Error("Expected workspace text");
  return value;
};

async function prepareWorkspace(input: Input, world: OutcomeWorkspaceWorld) {
  const directory = await fs.mkdtemp("outcome-workspace");
  const close = () => fs.rm(directory, { recursive: true, force: true });
  const filenames = Object.keys(world.files).sort();
  const locations = new Map(filenames.map(name => [name, `${directory}/${name}`]));
  const fullPath = (name: string) => {
    const location = locations.get(name);
    if (!location) throw new Error("Document is outside the fixture");
    return location;
  };
  try {
    await Promise.all(filenames.map(name => fs.writeFile(fullPath(name), world.files[name]!)));
  } catch (error) {
    await close();
    throw error;
  }

  const notePath = fullPath(world.authority);
  const notice: IntentNotice = {
    title: "Lantern Room current facilitator handoff",
    contextId: input.contextId,
    notePath,
    skillName: "open-intent-discovery",
    workerKey: "",
  };
  const observations = new Set<string>();
  const acceptedWrites: { path: string; previous: string; version: string }[] = [];
  let concurrentVersion: string | undefined;
  let writing = false;

  async function read(name: string) {
    const path = locations.get(name);
    if (!path) return null;
    const text = await readText(path);
    const version = sha256HexSyncText(text);
    observations.add(`${name}:${version}`);
    return { path: name, version, text };
  }

  const services = {
    goalWorkspace: {
      list: async () => (await fs.readdir(directory)).sort(),
      read,
      async revise(name: string, version: string, text: string): Promise<WriteResult> {
        if (writing || name !== world.target || typeof text !== "string" || text.length > maxDocumentLength)
          return { status: "unavailable" };
        writing = true;
        try {
          const path = fullPath(name);
          const current = await readText(path);
          if (sha256HexSyncText(current) !== version) return { status: "changed" };
          if (world.concurrentAddition && !concurrentVersion) {
            const concurrentRevision = current + world.concurrentAddition;
            await fs.writeFile(path, concurrentRevision);
            concurrentVersion = sha256HexSyncText(concurrentRevision);
            return { status: "changed" };
          }
          const nextVersion = sha256HexSyncText(text);
          await fs.writeFile(path, text);
          acceptedWrites.push({ path: name, previous: version, version: nextVersion });
          return { status: "written", version: nextVersion };
        } finally {
          writing = false;
        }
      },
    },
    nativeIntentDiscovery: {
      notice: async () => structuredClone(notice),
      async search(query: string) {
        if (typeof query !== "string" || !query.trim() || query.length > 128) return [];
        const hits = await rpc.call("main", mainRpcMethods["docs.search"], [query, { surface: "service", limit: 8 }]);
        return hits.map(hit => ({ id: hit.id, name: hit.qualifiedName, description: hit.description?.slice(0, 210) ?? "" }));
      },
      async describe(id: string): Promise<IntentDescription | null> {
        if (id !== readMethod) return null;
        const entry = await rpc.call("main", mainRpcMethods["docs.describe"], [id]);
        if (entry?.id !== id) return null;
        return { id, name: entry.qualifiedName, description: entry.description?.slice(0, 260) ?? "", digest: stableSha256Hex(entry) };
      },
      async inspect(methodId: string, scope: string): Promise<IntentObservation | null> {
        if (methodId !== readMethod || scope !== notePath) return null;
        const note = await read(world.authority);
        if (!note) return null;
        return { methodId, scope, status: "observed", coordinate: notePath, details: [note.text], digest: note.version };
      },
    },
    nativeIntentHandoff: { stage: async () => null },
  };

  const expectedGuide = world.target === null ? null :
    world.files[world.target]!.replace(/^Doors open: \d{2}:\d{2}$/mu, `Doors open: ${world.doors}`) + (world.concurrentAddition ?? "");
  async function verify(value: unknown) {
    const report = value as Report | null;
    const names = (await fs.readdir(directory)).sort();
    const contents = Object.fromEntries(await Promise.all(filenames.map(async name => {
      const path = fullPath(name);
      return [name, await fs.exists(path) ? await readText(path) : null] as const;
    })));
    const sourceDigest = sha256HexSyncText(world.files[world.authority]!);
    const guide = world.target === null ? null : contents[world.target];
    const revision = typeof guide === "string" ? sha256HexSyncText(guide) : null;
    const summary = report?.outcome?.outcome?.summary ?? report?.outcome?.summary ?? report?.outcome?.explanation;
    const openingTime = new RegExp(`(?:doors?[^.\\n]{0,36}${world.doors}|${world.doors}[^.\\n]{0,36}doors?)`, "iu");
    const checks = {
      currentAuthorityObserved: observations.has(`${world.authority}:${sourceDigest}`),
      protectedWorkspace: names.length === filenames.length && names.every((name, i) => name === filenames[i]) &&
        filenames.every(name => name === world.target || contents[name] === world.files[name]),
      requestedOutcome: world.target === null
        ? acceptedWrites.length === 0 && typeof summary === "string" &&
          openingTime.test(summary) && /(?:current (?:facilitator )?handoff|venue team|current-handoff\.md)/iu.test(summary)
        : guide === expectedGuide && acceptedWrites.some(write => write.path === world.target && write.version === revision) &&
          report?.status === "edited" && report.path === world.target && report.version === revision,
      retainedConcurrentWork: !world.concurrentAddition || (concurrentVersion !== undefined &&
        typeof guide === "string" && guide.includes(world.concurrentAddition)),
    };
    return {
      caseId: input.caseId, contextId: input.contextId, goal: world.goal,
      checks, passed: Object.values(checks).every(Boolean),
      authority: { path: world.authority, sha256: sourceDigest },
      target: world.target === null ? null : { path: world.target, sha256: revision },
      contents, acceptedWrites: structuredClone(acceptedWrites),
    };
  }
  return { services, verify, close, notePath, expectedGuide };
}

export async function prepareOutcomeWorkspace(input: Input, world: OutcomeWorkspaceWorld) {
  if (input.contextId !== contextId || input.caseId !== world.id) throw new Error("Outcome workspace belongs to another case or context");
  const workspace = await prepareWorkspace(input, world);

  async function reference(target: Awaited<ReturnType<typeof prepareWorkspace>>, useIntent: boolean) {
    const { goalWorkspace, nativeIntentDiscovery } = target.services;
    const source = useIntent
      ? await nativeIntentDiscovery.inspect(readMethod, target.notePath)
      : await goalWorkspace.read(world.authority);
    if (!source) throw new Error("Current facilitator handoff is missing");
    if (world.target === null) {
      return { status: "workspace-skill-reviewed", skill: "intentDiscovery",
        outcome: { outcome: { status: "observed", summary: `The current facilitator handoff gives door time ${world.doors}.` } } };
    }
    const previous = await goalWorkspace.read(world.target);
    if (!previous || target.expectedGuide === null) throw new Error("Staff guide is missing");
    const first = await goalWorkspace.revise(world.target, previous.version, target.expectedGuide);
    const latest = first.status === "changed" ? await goalWorkspace.read(world.target) : null;
    const result = latest ? await goalWorkspace.revise(world.target, latest.version, target.expectedGuide) : first;
    if (result.status !== "written") throw new Error("Staff guide did not update");
    return { status: "edited", path: world.target, version: result.version };
  }

  async function qualify() {
    const unchanged = await workspace.verify(null);
    const positive = await workspace.verify(await reference(workspace, false));
    const alias = await prepareWorkspace(input, world);
    try {
      const alternate = await alias.verify(await reference(alias, true));
      const wrongResult = await alias.verify(world.target === null
        ? { outcome: { summary: "The archived note lists 10:15." } }
        : { status: "edited", path: world.target, version: "wrong-revision" });
      const unauthorizedWrite = await alias.services.goalWorkspace.revise(world.authority, alternate.authority.sha256, "altered");
      const checks = { ...positive.checks, alternateEvidenceRoute: alternate.passed,
        rejectedFalseSuccess: !unchanged.passed && !wrongResult.passed, protectedAuthority: unauthorizedWrite.status === "unavailable" };
      return { ...positive, checks, passed: Object.values(checks).every(Boolean) };
    } finally {
      await alias.close();
    }
  }

  return { services: workspace.services, verify: workspace.verify, close: workspace.close, qualify };
}
