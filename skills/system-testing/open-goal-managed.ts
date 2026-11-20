import { fs, panelTree, web } from "@workspace/runtime";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { openGoalWorlds } from "./open-goal-worlds.js";
import { browserGoalWorlds } from "./open-goal-browser-worlds.js";
import { prepareBrowserGoal } from "./open-goal-browser-managed.js";

type Input = { contextId: string; caseId: string; panelId?: string; source?: string };
type ResearchReport = {
  status: string;
  research?: {
    status: string;
    question: string;
    statements: { text: string; cites: { url: string; quote: string; retrieved: string }[] }[];
  };
};
const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();

export async function prepareOpenGoal({ contextId, caseId, panelId, source }: Input) {
  const browser = browserGoalWorlds.find((item) => item.id === caseId);
  if (browser) {
    if (!panelId || !source) throw new Error("The open browser goal needs its owned panel");
    return prepareBrowserGoal(panelTree.get(panelId), { contextId, caseId, source }, browser);
  }
  const world = openGoalWorlds.find((item) => item.id === caseId);
  if (!world) throw new Error("Unknown open user goal");
  if (world.kind === "workspace-edit") return prepareWorkspaceGoal({ contextId, caseId }, world);
  const research = preparePublicResearch({ contextId, caseId }, world);
  if (world.kind === "research") return research;
  const workspace = await prepareWorkspaceGoal({ contextId, caseId }, world);
  return {
    goal: world.goal,
    services: { ...research.services, goalWorkspace: workspace.services.goalWorkspace },
    async verify(value: unknown) {
      const [edit, publicEvidence] = await Promise.all([workspace.verify(value), research.verify(value)]);
      return { ...edit, searches: publicEvidence.searches, fetched: publicEvidence.fetched,
        checks: { ...edit.checks, ...publicEvidence.checks }, passed: edit.passed && publicEvidence.passed };
    },
  };
}

type World = (typeof openGoalWorlds)[number];
type ResearchWorld = Extract<World, { kind: "research" | "research-and-edit" }>;

function preparePublicResearch({ contextId, caseId }: Input, world: ResearchWorld) {
  const { goal, required } = world;
  const allowed = new Set<string>();
  const pages = new Map<string, Awaited<ReturnType<typeof web.fetch>>>();
  const searches: { queries: string[]; urls: string[] }[] = [];
  const fetched: { requested: string; url: string; digest: string }[] = [];
  const snapshotTime = Date.now();
  async function search(queries: string[]) {
    const result = await web.search({ queries });
    const urls = result.results.flatMap(({ sources }) => sources.map(({ url }) => url));
    for (const url of urls) allowed.add(url);
    searches.push({ queries: [...queries], urls });
    return result;
  }
  const services = {
    goalDiscovery: {
      async search(queries: string[]) { return (await search(queries)).results; },
      snapshotTime: () => snapshotTime,
    },
    web: {
      async search({queries}: {queries: string[]}) { return search(queries); },
      async fetch(options: Parameters<typeof web.fetch>[0]) {
        if ((options.session && options.session !== "public") || !allowed.has(options.url))
          throw new Error("Use the public session and a URL discovered in the current search");
        const page = await web.fetch({ ...options, session: "public" });
        pages.set(page.digest, page);
        fetched.push({ requested: options.url, url: page.url, digest: page.digest });
        return page;
      },
      async read(options: Parameters<typeof web.read>[0]) {
        if (!pages.has(options.digest)) throw new Error("Read a page fetched in this invocation");
        return web.read(options);
      },
    },
    goalWorkspace: {
      list: async () => [],
      read: async () => null,
      revise: async () => ({ status: "unavailable" }),
    },
  };
  async function verify(value: unknown) {
    const result = value as ResearchReport | null;
    const citations = result?.research?.statements?.flatMap(({ cites }) => cites) ?? [];
    const cache = await Promise.all([...pages.values()].map(async (page) => {
      const read = await web.read({ digest: page.digest, offset: 0, limit: page.size });
      return { url: page.url, digest: page.digest, text: normalize(read.text),
        exact: read.bytes === page.size && sha256HexSyncText(read.text) === page.digest };
    }));
    const date = new Date(snapshotTime).toISOString().slice(0, 10);
    const checks = {
      discoveredSources: searches.length > 0 && fetched.length > 0 && fetched.every(({ requested }) => allowed.has(requested)),
      exactPageReadback: cache.length > 0 && cache.every(({ exact }) => exact),
      answeredGoal: result?.status === (world.kind === "research" ? "answered" : "edited") &&
        result.research?.status === "answered" &&
        result.research.question === goal &&
        Boolean(result.research.statements?.length) &&
        result.research.statements.every(({ text, cites }) => Boolean(text.trim()) && cites.length > 0),
      groundedCitations: citations.length > 0 && citations.every(({ url, quote, retrieved }) =>
        retrieved === date && normalize(quote).length >= 20 &&
        cache.some((page) => page.url === url && page.text.includes(normalize(quote)))),
      requiredEvidence: required.every(({ host, phrase }) =>
        citations.some(({ url, quote }) => {
          const source = cache.find((page) => page.url === url);
          if (!source) return false;
          const actual = new URL(source.url).hostname;
          return (actual === host || actual.endsWith("." + host)) && normalize(quote).toLowerCase().includes(phrase);
        })),
    };
    return { passed: Object.values(checks).every(Boolean), caseId, contextId, goal, searches, fetched, checks };
  }
  return { goal, services, verify };
}

type EditWorld = Extract<World, { kind: "workspace-edit" | "research-and-edit" }>;

async function prepareWorkspaceGoal({ contextId, caseId }: Input, world: EditWorld) {
  const directory = await fs.mkdtemp("open-user-goal");
  const original: Record<string, string> = { ...world.files };
  const names = Object.keys(original);
  await Promise.all(names.map((name) => fs.writeFile(`${directory}/${name}`, original[name]!)));
  async function readText(path: string) {
    const value = await fs.readFile(path, "utf8");
    if (typeof value !== "string") throw new Error("Expected workspace text");
    return value;
  }
  const hash = sha256HexSyncText;
  const reads: { path: string; version: string }[] = [];
  const attempts: { path: string; version: string; status: string }[] = [];
  let changedVersion: string | undefined;
  let listed = false;
  let revising = false;
  const services = {
    goalDiscovery: { search: async () => [], snapshotTime: () => Date.now() },
    web: {
      search: async () => ({ results: [] }),
      fetch: async () => { throw new Error("Public fetching is unavailable in this workspace"); },
      read: async () => { throw new Error("Public cache is unavailable in this workspace"); },
    },
    goalWorkspace: {
      async list() {
        listed = true;
        return (await fs.readdir(directory)).sort();
      },
      async read(path: string) {
        if (!names.includes(path)) return null;
        const text = await readText(`${directory}/${path}`);
        const version = hash(text);
        reads.push({ path, version });
        return { path, version, text };
      },
      async revise(path: string, version: string, text: string) {
        const attempt = { path, version, status: "unavailable" };
        attempts.push(attempt);
        if (revising || path !== world.destination || typeof text !== "string" || text.length > 10_000)
          return { status: attempt.status };
        revising = true;
        try {
          const target = `${directory}/${path}`;
          const current = await readText(target);
          if (!changedVersion) {
            const changed = current + world.concurrentAddition;
            await fs.writeFile(target, changed);
            changedVersion = hash(changed);
            attempt.status = "changed";
            return { status: attempt.status };
          }
          if (version !== hash(current)) {
            attempt.status = "changed";
            return { status: attempt.status };
          }
          await fs.writeFile(target, text);
          attempt.status = "written";
          return { status: attempt.status, version: hash(text) };
        } finally {
          revising = false;
        }
      },
    },
  };
  async function verify(value: unknown) {
    const report = value as { status?: string; path?: string; version?: string } | null;
    const contents = Object.fromEntries(await Promise.all(names.map(async (name) =>
      [name, await readText(`${directory}/${name}`)] as const)));
    const version = hash(contents[world.destination]!);
    const checks = {
      discoveredWorkspace: listed && reads.some(({ path }) => path === world.source) &&
        reads.some(({ path, version }) => path === world.destination && version === hash(original[path]!)),
      recoveredConcurrentEdit: Boolean(changedVersion) && attempts.length === 2 &&
        attempts[0]?.path === world.destination && attempts[0].version === hash(original[world.destination]!) &&
        attempts[0].status === "changed" &&
        reads.some(({ path, version }) => path === world.destination && version === changedVersion) &&
        attempts[1]?.path === world.destination && attempts[1].version === changedVersion &&
        attempts[1].status === "written",
      exactDocumentReadback: contents[world.destination] === world.expected &&
        reads.some(({ path, version: read }) => path === world.destination && read === version),
      preservedOtherDocuments: Object.keys(contents).every((name) =>
        name === world.destination || contents[name] === original[name]),
      reportedStoredRevision: report?.status === "edited" && report.path === world.destination && report.version === version,
    };
    return { passed: Object.values(checks).every(Boolean), caseId, contextId, goal: world.goal,
      reads, attempts, contents, checks };
  }
  return { goal: world.goal, services, verify };
}

type Verification = Awaited<ReturnType<Awaited<ReturnType<typeof prepareOpenGoal>>["verify"]>>;
export interface OpenGoalReceiver {
  runOpenGoalTeacher(input: Input & { executorModel: string }): Promise<{ teacher: PanelTeacherResult; verification: Verification }>;
}
export const openGoalMethods = createReceiverRpcMethods<OpenGoalReceiver>(["runOpenGoalTeacher"]);
