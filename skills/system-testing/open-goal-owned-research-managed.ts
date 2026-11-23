import { readCachedWebRange, readVerifiedCachedPage } from "./verified-web-cache.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { contextId, extensions, vcs, web } from "@workspace/runtime";
import type {} from "@workspace-extensions/shell";
import { attachTerminalScreen } from "./tests/_terminal-screen.js";
import { prepareWorkspaceGoal } from "./open-goal-managed.js";
import { openOwnedResearchWorlds, type OwnedResearchPage } from "./open-goal-owned-research-worlds.js";
import { ownedResearchEndpointInput, ownedResearchServerProgram } from "./open-goal-owned-research-http.js";

type NativeWeb = Pick<typeof web, "fetch" | "read">;
type Page = Awaited<ReturnType<NativeWeb["fetch"]>>;
type Read = Awaited<ReturnType<NativeWeb["read"]>>;
type Citation = { url: string; quote: string; retrieved: string };
type Brief = { status: string; question: string; statements: { text: string; cites: Citation[] }[] };
type Result = { status?: string; research?: Brief; path?: string; version?: string };
type Endpoint = { origin: string; nonce: string; close(): Promise<void> };
type Ports = { contextId: string | null; web: NativeWeb; status: typeof vcs.status; start(pages: OwnedResearchPage[], contextId: string): Promise<Endpoint> };
const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
const maxPageBytes = 9500;

async function startEndpoint(pages: OwnedResearchPage[], ownedContext: string): Promise<Endpoint> {
  const nonce = crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  const shell = extensions.use("@workspace-extensions/shell");
  const session = await shell.open({
    contextId: ownedContext, command: "node", args: ["--eval", ownedResearchServerProgram, ownedResearchEndpointInput(pages, nonce)],
    label: "Owned research endpoint", cols: 110, rows: 12,
  });
  const { sessionId } = session;
  let attachment: Awaited<ReturnType<typeof attachTerminalScreen>> | undefined;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (attachment) await attachment.detach();
    } finally {
      await shell.dispose(sessionId);
    }
  }
  try {
    attachment = await attachTerminalScreen(shell, sessionId, { cols: 110, rows: 12 });
    const ready = /OWNED_RESEARCH_READY ([1-9]\d{0,4}) END/u;
    const screen = await attachment.screen.waitFor(ready, { signal: AbortSignal.timeout(12_000) });
    const port = Number(ready.exec(screen)?.[1]);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Owned research endpoint did not bind a valid port");
    return { origin: `http://127.0.0.1:${port}`, nonce, close };
  } catch (error) {
    await close();
    throw error;
  }
}
const nativePorts = (): Ports => ({ contextId, web, status: (input) => vcs.status(input), start: startEndpoint });

export async function prepareOpenOwnedResearch(input: { contextId: string; caseId: string }, ports = nativePorts()) {
  const world = openOwnedResearchWorlds.find(item => item.id === input.caseId);
  if (!world || ports.contextId !== input.contextId) throw new Error("Owned research needs the assigned workspace context");
  const before = await ports.status();
  const edit = world.edit ? await prepareWorkspaceGoal(input, world.edit) : null;
  const endpoint = await ports.start(world.pages, input.contextId);
  if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/u.test(endpoint.origin) || !/^[a-f0-9]{24}$/u.test(endpoint.nonce)) {
    await endpoint.close();
    throw new Error("Owned research endpoint must be the exact loopback fixture");
  }

  const snapshot = Date.now();
  const date = new Date(snapshot).toISOString().slice(0, 10);
  const url = (id: string) => `${endpoint.origin}/${endpoint.nonce}/${id}`;
  const entries = new Map(world.pages.map(page => [url(page.id), { page, index: words(`${page.title} ${page.summary}`) }]));
  const pages = new Map<string, Page>();
  type SearchRows = { query: string; text: string; sources: { url: string; title: string; snippet: string }[] }[];
  const searches: { queries: string[]; urls: string[]; result: SearchRows }[] = [];
  const fetchReceipts: { args: [Parameters<NativeWeb["fetch"]>[0]]; result: Page }[] = [];
  const cacheReceipts: { args: [Parameters<NativeWeb["read"]>[0]]; result: Read }[] = [];
  const attempted: { requested: string; url: string | null; digest: string | null }[] = [];
  const reads: { digest: string; offset: number; bytes: number }[] = [];

  async function search(queries: string[]) {
    if (!Array.isArray(queries) || !queries.length || queries.length > 5 ||
        queries.some(query => typeof query !== "string" || !query.trim() || query.length > 260))
      throw new Error("Use bounded queries for the owned research catalog");
    const rows = queries.map(query => {
      const terms = [...words(query)];
      const candidates = [...entries.entries()].map(([url, entry]) =>
        ({ url, ...entry, count: terms.filter(term => entry.index.has(term)).length }))
        .filter(row => row.count > 0).sort((left, right) => right.count - left.count || left.url.localeCompare(right.url));
      const sources = candidates.slice(0, 4).map(({ url, page }) => {
        return { url, title: page.title, snippet: page.summary };
      });
      return { query, text: sources.map(source => `${source.title}. ${source.snippet}`).join("\n"), sources };
    });
    searches.push({ queries: [...queries], urls: rows.flatMap(row => row.sources.map(source => source.url)), result: rows });
    return rows;
  }
  const services = {
    goalDiscovery: { search, snapshotTime: () => snapshot },
    web: {
      async search({ queries }: { queries: string[] }) {
        return { results: await search(queries) };
      },
      async fetch(options: Parameters<NativeWeb["fetch"]>[0]) {
        if (!options || (options.session && options.session !== "public") || !entries.has(options.url))
          throw new Error("Use an authorized owned HTTP page and the public session");
        const effect: typeof attempted[number] = { requested: options.url, url: null, digest: null };
        attempted.push(effect);
        const page = await ports.web.fetch({ url: options.url, session: "public",
          network: { kind: "loopback", origin: endpoint.origin } });
        if (page.url !== options.url || page.session !== "public" || page.size < 1 || page.size > maxPageBytes)
          throw new Error("The native page did not retain its exact owned URL and bounded public receipt");
        pages.set(page.digest, page);
        effect.url = page.url;
        effect.digest = page.digest;
        fetchReceipts.push({ args: [options], result: page });
        return page;
      },
      async read(input: Parameters<NativeWeb["read"]>[0]) {
        const page = pages.get(input?.digest);
        if (!page || !Number.isInteger(input.offset) || input.offset! < 0 ||
            !Number.isInteger(input.limit) || input.limit! < 1 || input.limit! > maxPageBytes)
          throw new Error("Read only a bounded range of observed owned evidence");
        const actual = await ports.web.read(input);
        reads.push({ digest: actual.digest, offset: actual.offset, bytes: actual.bytes });
        cacheReceipts.push({ args: [input], result: actual });
        return actual;
      },
    },
    ...(edit ? { goalWorkspace: edit.services.goalWorkspace } : {}),
  };

  async function exactPage(page: Page) {
    const bytes = await readVerifiedCachedPage(input => ports.web.read(input), page);
    return { url: page.url, digest: page.digest, text: bytes.text, size: page.size, exact: bytes.exact };
  }
  async function verify(value: unknown) {
    const report = value as Result | null;
    const research = report?.research;
    const statements = Array.isArray(research?.statements) ? research.statements : [];
    const cites = statements.flatMap(statement => statement.cites ?? []);
    const readback = await Promise.all([...pages.values()].map(exactPage));
    const protectedScope = await ports.status();
    const citationsExact = cites.length > 0 && cites.every(citation => typeof citation.quote === "string" &&
      normalize(citation.quote).length >= 20 && citation.retrieved === date &&
      readback.some(page => page.url === citation.url && normalize(page.text).includes(normalize(citation.quote))));
    const document = edit ? await edit.verify(value) : null;
    const checks = {
      discoveredOwnedSources: pages.size > 0 &&
        attempted.every(({ requested }) => entries.has(requested)),
      exactOwnedPageReadback: readback.length > 0 && readback.every(page => page.exact),
      groundedOwnedCitations: citationsExact,
      readOwnedCacheContinuation: reads.every(read => [...pages.values()].some(page =>
        read.digest === page.digest && read.offset >= 0 && read.bytes >= 0 && read.offset + read.bytes <= page.size)),
      answeredOwnedGoal: report?.status === (edit ? "edited" : "answered") && research?.status === "answered" &&
        research.question === world!.goal && statements.length > 0 &&
        statements.every(statement => Boolean(statement.text?.trim()) && statement.cites?.length > 0),
      protectedOwnedResearchScope: protectedScope.mainEventId === before.mainEventId &&
        isDeepStrictEqual(protectedScope.workingHead, before.workingHead),
      ...(document?.checks ?? {}),
    };
    return { contextId: input.contextId, caseId: input.caseId, goal: world!.goal, checks,
      passed: Object.values(checks).every(Boolean), origin: endpoint.origin, searches, attempted, reads,
      fetched: [...pages.values()], fetchReceipts, cacheReceipts, readback, document,
      semanticReviewRequired:true,semanticReviewInput:{kind:"public-claims",actual:{goal:world!.goal,
        answer:JSON.stringify(research??null),citations:cites.map(({url,quote})=>({url,quote})),
        sourceScope:[...entries.keys()],sources:readback.map(source=>({url:source.url,
          title:[...pages.values()].find(page=>page.url===source.url)?.title??"",retrieved:date,sha256:source.digest,text:source.text}))}} };
  }

  async function qualify() {
    let rejectedForeign = false;
    try { await services.web.fetch({ url: `${endpoint.origin}/${endpoint.nonce}/unobserved` }); }
    catch (error) { rejectedForeign = error instanceof Error && /authorized owned HTTP page/u.test(error.message); }
    const citations: Citation[] = [];
    for (const expected of world!.required) {
      const expectedUrl = url(expected.page);
      const metadata = entries.get(expectedUrl)!;
      await search([metadata.page.title]);
      const page = await services.web.fetch({ url: expectedUrl });
      let text = page.head;
      if (page.truncated) {
        text += await readCachedWebRange(services.web.read, page.digest, page.headBytes, page.size);
      }
      const canonical = normalize(text);
      const at = canonical.toLowerCase().indexOf(expected.phrase.toLowerCase());
      if (at < 0) throw new Error("Authoritative owned fixture evidence did not reach the extracted cache");
      citations.push({ url: page.url, quote: canonical.slice(at, at + expected.phrase.length), retrieved: date });
    }
    const research: Brief = { question: world!.goal, status: "answered", statements: [{ text: world!.referenceAnswer, cites: citations }] };
    const editProof = edit ? await edit.qualify() : null;
    const result: Result = { status: edit ? "edited" : "answered", research,
      ...(editProof && world!.edit ? { path: world!.edit.destination, version: sha256HexSyncText(editProof.contents[world!.edit.destination]!) } : {}) };
    const accepted = await verify(result);
    const fabricated = await verify({ ...result, research: { ...research, statements: [{ text: world!.referenceAnswer,
      cites: citations.map(citation => ({ ...citation, quote: "A fabricated statement that never appeared." })) }] } });
    return { ...accepted, passed: accepted.passed && rejectedForeign && !fabricated.passed };
  }
  return { goal: world.goal, services, verify, qualify, close: endpoint.close };
}
