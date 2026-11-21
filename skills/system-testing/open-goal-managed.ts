import { credentials, fs, panelTree, web } from "@workspace/runtime";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { openGoalWorlds, publicSourceOrigins, type PublicResearchWorld } from "./open-goal-worlds.js";
import { browserGoalWorlds } from "./open-goal-browser-worlds.js";
import { prepareBrowserGoal } from "./open-goal-browser-managed.js";
import { suiteGoalWorlds } from "./open-goal-suite-worlds.js";
import { attestPublicSearch, type PublicSearchReceipt } from "./open-public-search-evidence.js";
import { readVerifiedCachedPage } from "./verified-web-cache.js";
import { prepareOpenGoalSuite } from "./open-goal-suite-managed.js";
import type { WorkspaceEditFixture } from "./open-goal-owned-research-worlds.js";
import type { NewsInput } from "./news-contract.js";
import type { PortfolioFixtureIdentity } from "./open-goal-portfolio-managed.js";

type Input = { portfolioFixture?: PortfolioFixtureIdentity; regencyFixture?: { panelId: string; realm: string }; tendrilChannelId?: string; grimoireEstateKey?: string; contextId: string; caseId: string; panelId?: string; source?: string; reviewedRef?: `state:${string}`; recoveryPanels?: { surfaceId: string; panelId: string }[]; clientPanels?: { surfaceId: string; panelId: string }[] };
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
  const suite = suiteGoalWorlds.find((item) => item.id === caseId);
  if (suite) return prepareOpenGoalSuite({ contextId, caseId }, suite);
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
  const combine = (
    edit: Awaited<ReturnType<typeof workspace.verify>>,
    publicEvidence: Awaited<ReturnType<typeof research.verify>>,
  ) => ({
    ...edit, searches: publicEvidence.searches, fetched: publicEvidence.fetched,
    citationSources: publicEvidence.citationSources,
    checks: { ...edit.checks, ...publicEvidence.checks }, passed: edit.passed && publicEvidence.passed,
  });
  return {
    goal: world.goal,
    services: { ...research.services, goalWorkspace: workspace.services.goalWorkspace },
    async verify(value: unknown) {
      const [edit, publicEvidence] = await Promise.all([workspace.verify(value), research.verify(value)]);
      return combine(edit, publicEvidence);
    },
    async qualify() {
      const publicEvidence = await research.qualify();
      if (!publicEvidence.passed) throw new Error("The authority did not support the reference edit");
      return combine(await workspace.qualify(), publicEvidence);
    },
  };
}

function preparePublicResearch({ contextId, caseId }: Input, world: PublicResearchWorld) {
  const { goal, required, conclusions, referenceAnswer } = world;
  const origins = new Set(publicSourceOrigins(world));
  const pages = new Map<string, Awaited<ReturnType<typeof web.fetch>>>();
  const searches: PublicSearchReceipt[] = [];
  const fetched: {
    requested: string;
    url: string;
    digest: string;
    searchIndex: number;
    provider: PublicSearchReceipt["provider"];
    input: Parameters<typeof web.fetch>[0];
    page: Awaited<ReturnType<typeof web.fetch>>;
  }[] = [];
  const snapshotTime = Date.now();
  async function search(queries: string[]) {
    const receipt = await attestPublicSearch({
      hasCredential: async origin => (await credentials.resolveCredential({ url: origin })) != null,
      search: queries => web.search({ queries }),
    }, queries);
    searches.push(receipt);
    return structuredClone(receipt.result);
  }
  const services = {
    goalDiscovery: {
      async search(queries: string[]) { return (await search(queries)).results; },
      snapshotTime: () => snapshotTime,
    },
    web: {
      async search({queries}: {queries: string[]}) { return search(queries); },
      async fetch(options: Parameters<typeof web.fetch>[0]) {
        const searchIndex = searches.findIndex(receipt => receipt.urls.includes(options.url));
        if ((options.session && options.session !== "public") || searchIndex < 0 ||
            !origins.has(new URL(options.url).origin))
          throw new Error("Use the public session and an authorized URL discovered in the current search");
        const page = await web.fetch({ ...options, session: "public" });
        if (page.session !== "public" || !origins.has(new URL(page.url).origin))
          throw new Error("The fetched evidence left the assigned public origins");
        pages.set(page.digest, structuredClone(page));
        fetched.push({ requested: options.url, url: page.url, digest: page.digest, searchIndex,
          provider: searches[searchIndex]!.provider, input: structuredClone(options), page: structuredClone(page) });
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
      const read = await readVerifiedCachedPage(input => web.read(input), page);
      return { url: page.url, digest: page.digest, text: normalize(read.text), exact: read.exact };
    }));
    const date = new Date(snapshotTime).toISOString().slice(0, 10);
    const answer = normalize(result?.research?.statements?.map(({ text }) => text).join(" ") ?? "");
    const citationSources = citations.flatMap(({ url, quote, retrieved }) => {
      const source = fetched.find(page => page.url === url && cache.some(readback =>
        readback.url === url && readback.digest === page.digest && readback.exact && readback.text.includes(normalize(quote))));
      return source ? [{ url, quote, retrieved, digest: source.digest, searchIndex: source.searchIndex, provider: source.provider }] : [];
    });
    const sourceAttested = fetched.every(({ requested, searchIndex, provider }) =>
      searches[searchIndex]?.provider === provider && searches[searchIndex]?.urls.includes(requested));
    const checks = {
      discoveredSources: searches.length > 0 && fetched.length > 0 && sourceAttested,
      attestedSearchProvider: searches.length > 0 && sourceAttested && citations.length > 0 && citationSources.length === citations.length,
      exactPageReadback: cache.length > 0 && cache.every(({ exact }) => exact),
      answeredGoal: result?.status === (world.kind === "research" ? "answered" : "edited") &&
        result.research?.status === "answered" &&
        result.research.question === goal &&
        Boolean(result.research.statements?.length) &&
        result.research.statements.every(({ text, cites }) => Boolean(text.trim()) && cites.length > 0),
      groundedCitations: citations.length > 0 && citations.every(({ url, quote, retrieved }) =>
        retrieved === date && normalize(quote).length >= 20 &&
        cache.some((page) => page.url === url && page.text.includes(normalize(quote)))),
      supportedConclusion: conclusions.every((pattern) => pattern.test(answer)),
      requiredEvidence: required.every(({ host, phrase }) =>
        citations.some(({ url, quote }) => {
          const source = cache.find((page) => page.url === url);
          if (!source) return false;
          const actual = new URL(source.url).hostname;
          return (actual === host || actual.endsWith("." + host)) && normalize(quote).toLowerCase().includes(phrase);
        })),
    };
    return { passed: Object.values(checks).every(Boolean), caseId, contextId, goal, searches, fetched, citationSources, checks };
  }
  async function qualify() {
    const statements = [];
    const retrieved = new Date(snapshotTime).toISOString().slice(0, 10);
    for (const { host, phrase } of required) {
      const result = await services.goalDiscovery.search([`site:${host} "${phrase}"`]);
      const candidates = new Set(result.flatMap(({ sources }) => sources.map(({ url }) => url)));
      let found = false;
      for (const url of [...candidates].slice(0, 5)) {
        const hostname = new URL(url).hostname;
        if (hostname !== host && !hostname.endsWith("." + host)) continue;
        const page = await services.web.fetch({ url });
        const read = await readVerifiedCachedPage(services.web.read, page);
        if (!read.exact) throw new Error("The reference public search could not verify the cached page digest");
        const text = normalize(read.text);
        const offset = text.toLowerCase().indexOf(phrase);
        if (offset < 0) continue;
        const quote = text.slice(offset, offset + phrase.length);
        statements.push({ text: referenceAnswer, cites: [{ url: page.url, quote, retrieved }] });
        found = true;
        break;
      }
      if (!found) throw new Error(`The reference public search did not yield evidence from ${host} for "${phrase}"`);
    }
    return verify({ status: world.kind === "research" ? "answered" : "edited",
      research: { status: "answered", question: goal, statements } });
  }
  return { goal, services, verify, qualify };
}

export async function prepareWorkspaceGoal({ contextId, caseId }: Input, world: WorkspaceEditFixture) {
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
  const attempts: { path: string; version: string; text: string; status: string }[] = [];
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
        const attempt = { path, version, text, status: "unavailable" };
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

  async function qualify() {
    const workspace = services.goalWorkspace;
    await workspace.list();
    const initial = await workspace.read(world.destination);
    if (!initial || !await workspace.read(world.source))
      throw new Error("The target and authority documents must be readable");
    const first = await workspace.revise(world.destination, initial.version, world.expected);
    if (first.status !== "changed") throw new Error("The concurrent edit was not observed");
    const fresh = await workspace.read(world.destination);
    if (!fresh || fresh.version === initial.version) throw new Error("No fresh document revision was available");
    const write = await workspace.revise(world.destination, fresh.version, world.expected);
    if (write.status !== "written" || !("version" in write)) throw new Error("The reference edit was not stored");
    const readback = await workspace.read(world.destination);
    if (readback?.version !== write.version) throw new Error("The stored document revision changed");
    return verify({ status: "edited", path: world.destination, version: write.version });
  }
  return { goal: world.goal, services, verify, qualify };
}

type Verification = Awaited<ReturnType<Awaited<ReturnType<typeof prepareOpenGoal>>["verify"]>>;
export type OpenGoalDomainVerification = {
  caseId: string;
  contextId: string;
  goal: string;
  passed: boolean;
  checks: Record<string, boolean>;
};
export interface OpenGoalReceiver {
  runOpenGoalTeacher(input: Input & { goal: string; executorModel: string; qualification?: boolean; news?: NewsInput }):
    Promise<{
      contextId: string;
      teacher: PanelTeacherResult | null;
      verification: Verification | OpenGoalDomainVerification | null;
      verificationErrors: { phase: "verification" | "retirement"; message: string }[];
    }>;
}
export const openGoalMethods = createReceiverRpcMethods<OpenGoalReceiver>(["runOpenGoalTeacher"]);
