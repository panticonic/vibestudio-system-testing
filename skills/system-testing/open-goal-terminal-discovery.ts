import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText, stableSha256Hex } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { rpc } from "@workspace/runtime";
import sections from "@workspace-skills/sandbox/doc-sections";
import rank from "@workspace-skills/sandbox/doc-ranking";
import searchTerms from "@workspace-skills/sandbox/doc-search-terms";
import type { RecoveryKnowledge, RecoveryRoute, RecoverySkill, TerminalDiscovery } from "@workspace-skills/open-terminal-operator/types";
import type { DiscoveryExpectation } from "./open-goal-terminal-worlds.js";

const maxCalls = 6;
const bytes = new TextEncoder();
const bounded = (text: string, max: number) => bytes.encode(text).length <= max;

export function bindTerminalDiscovery(rpc: Pick<typeof rpc, "call">, admit: () => void) {
  let searches = 0;
  let descriptions = 0;
  let loads = 0;
  let installed: RecoverySkill[] | null = null;
  const hits = new Set<string>();
  const searchReceipts: { query: string; result: { id: string; qualifiedName: string; description: string }[] }[] = [];
  const loadReceipts: { dirPath: string; focus: string[]; result: RecoveryKnowledge }[] = [];
  const routes = new Map<string, RecoveryRoute>();
  const knowledge = new Map<string, RecoveryKnowledge>();

  async function nativeIndex() {
    return (await rpc.call("main", mainRpcMethods["workspace.listSkills"], [])).map(row => ({
      dirPath: row.dirPath, skillPath: row.skillPath, name: row.name, description: row.description.slice(0, 160),
    }));
  }
  async function nativeRoute(id: string) {
    const row = await rpc.call("main", mainRpcMethods["docs.describe"], [id]);
    if (!row || row.id !== id || row.surface !== "service") return null;
    const schema = await rpc.call("main", mainRpcMethods["docs.getSchema"], [id]);
    if (!schema || !isDeepStrictEqual(schema.argsSchema, row.argsSchema) ||
        !isDeepStrictEqual(schema.returnsSchema, row.returnsSchema)) return null;
    return { id, qualifiedName: row.qualifiedName, description: row.description?.slice(0, 360) ?? "",
      argumentNames: row.argumentNames ?? [], sha256: stableSha256Hex({ row, schema }) };
  }
  async function rawGuide(dirPath: string) {
    const raw = await rpc.call("main", mainRpcMethods["workspace.readSkill"], [dirPath]);
    return raw && bounded(raw, 96 * 1024) ? raw : null;
  }
  function evidence() {
    return {
      routes: [...routes.values()],
      installed: installed !== null,
      searchReceipts, loadReceipts,
      knowledge: [...knowledge.values()].map(({ skillPath, sha256 }) => ({ skillPath, sha256 })),
    };
  }
  const services = {
    async search(query: string) {
      admit();
      if (++searches > maxCalls || typeof query !== "string" || !query.trim() || !bounded(query, 120)) return [];
      const rows = await rpc.call("main", mainRpcMethods["docs.search"], [query, { surface: "service", limit: 8 }]);
      const result = rows.map(row => {
        hits.add(row.id);
        return { id: row.id, qualifiedName: row.qualifiedName, description: row.description?.slice(0, 280) ?? "" };
      });
      searchReceipts.push({ query, result });
      return result;
    },
    async open(id: string) {
      admit();
      if (++descriptions > maxCalls || !hits.has(id)) return null;
      const route = await nativeRoute(id);
      if (route) routes.set(id, route);
      return route;
    },
    async installed() {
      admit();
      installed ??= (await nativeIndex()).slice(0, 96);
      return installed;
    },
    async load(dirPath: string, focus: string[]) {
      admit();
      const skill = installed?.find(item => item.dirPath === dirPath && item.skillPath === `${dirPath}/SKILL.md`);
      if (++loads > 4 || !skill || !Array.isArray(focus) || !focus.length || focus.length > 6 ||
          focus.some(term => typeof term !== "string" || !bounded(term, 64))) return null;
      const raw = await rawGuide(dirPath);
      if (!raw) return null;
      const passages = rank(searchTerms(focus), sections(raw, 760).map(({ heading, text }) =>
        ({ source: skill.skillPath, section: heading, text }))).slice(0, 5).map(({ text }) => text);
      if (!passages.length) return null;
      const receipt = { skillPath: skill.skillPath, sha256: sha256HexSyncText(raw), passages };
      knowledge.set(receipt.skillPath, receipt);
      loadReceipts.push({ dirPath, focus: [...focus], result: receipt });
      return receipt;
    },
  };
  async function qualify(expected: DiscoveryExpectation): Promise<TerminalDiscovery> {
    const routes: RecoveryRoute[] = [];
    for (const method of expected.methods) {
      const id = `service:${method}`;
      await services.search(method);
      const route = await services.open(id);
      if (!route) throw new Error(`The recovery contract is not visible: ${method}`);
      routes.push(route);
    }
    await services.installed();
    const guidance: TerminalDiscovery["guidance"] = [];
    for (const guide of expected.guidance) {
      const loaded = await services.load(guide.dirPath, guide.focus);
      const passage = loaded?.passages.find(text => guide.rule.test(text));
      if (!loaded || !passage) throw new Error(`The installed recovery rule is not visible: ${guide.dirPath}`);
      const match = guide.rule.exec(passage)!;
      const quote = passage.slice(Math.max(0, match.index - 35), match.index + 130).trim();
      guidance.push({ skillPath: loaded.skillPath, sha256: loaded.sha256, quote });
    }
    return { routes, guidance };
  }
  async function verify(actual: TerminalDiscovery | null, expected: DiscoveryExpectation | undefined) {
    if (!expected) return actual === null && hits.size === 0 && installed === null;
    if (!installed || !actual || !Array.isArray(actual.routes) || !Array.isArray(actual.guidance) ||
        actual.routes.length !== expected.methods.length || actual.guidance.length !== expected.guidance.length) return false;
    const conformedRoutes = await Promise.all(expected.methods.map(async name => {
      const id = `service:${name}`;
      const fresh = await nativeRoute(id);
      const report = actual.routes.find(entry => entry?.id === id);
      return !!fresh && hits.has(id) && isDeepStrictEqual(report, fresh) && isDeepStrictEqual(routes.get(id), fresh);
    }));
    const freshSkillIndex = await nativeIndex();
    const conformedSkills = await Promise.all(expected.guidance.map(async guide => {
      const fresh = freshSkillIndex.find(item => item.dirPath === guide.dirPath);
      const citation = actual.guidance.find(entry => entry?.skillPath === fresh?.skillPath);
      if (!fresh || !citation || typeof citation.quote !== "string" || citation.quote.length < 12 || !bounded(citation.quote, 260) ||
          !guide.rule.test(citation.quote)) return false;
      const [loaded, raw] = [knowledge.get(fresh.skillPath), await rawGuide(fresh.dirPath)];
      return !!raw && !!loaded && citation.sha256 === loaded.sha256 && citation.sha256 === sha256HexSyncText(raw) &&
        raw.includes(citation.quote) && loaded.passages.some(passage => passage.includes(citation.quote));
    }));
    return conformedRoutes.every(Boolean) && conformedSkills.every(Boolean);
  }
  return { services, qualify, verify, evidence };
}
