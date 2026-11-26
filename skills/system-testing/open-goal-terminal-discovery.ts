import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText, stableSha256Hex } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { rpc } from "@workspace/runtime";
import sections from "@workspace-skills/sandbox/doc-sections";
import rank from "@workspace-skills/sandbox/doc-ranking";
import searchTerms from "@workspace-skills/sandbox/doc-search-terms";
import type { RecoveryKnowledge, RecoveryRoute, RecoverySkill, TerminalDiscovery } from "@workspace-skills/open-terminal-operator/types";
import type { DiscoveryExpectation } from "./open-goal-terminal-worlds.js";

export function bindTerminalDiscovery(rpc: Pick<typeof rpc, "call">, admit: () => void, observe:(operation:string,result:unknown)=>void=()=>{}) {
  let installed: RecoverySkill[] | null = null;
  const searchReceipts: { query: string; result: { id: string; qualifiedName: string; description: string }[] }[] = [];
  const loadReceipts: { dirPath: string; focus: string[]; result: RecoveryKnowledge }[] = [];
  const routes = new Map<string, RecoveryRoute>();
  const knowledge = new Map<string, RecoveryKnowledge>();

  async function nativeIndex() {
    return (await rpc.call("main", mainRpcMethods["workspace.listSkills"], [])).map(row => ({
      dirPath: row.dirPath, skillPath: row.skillPath, name: row.name, description: row.description,
    }));
  }
  async function nativeRoute(id: string) {
    const row = await rpc.call("main", mainRpcMethods["docs.describe"], [id]);
    if (!row || row.id !== id || row.surface !== "service") return null;
    const schema = await rpc.call("main", mainRpcMethods["docs.getSchema"], [id]);
    if (!schema || !isDeepStrictEqual(schema.argsSchema, row.argsSchema) ||
        !isDeepStrictEqual(schema.returnsSchema, row.returnsSchema)) return null;
    return { id, qualifiedName: row.qualifiedName, description: row.description ?? "",
      argumentNames: row.argumentNames ?? [], sha256: stableSha256Hex({ row, schema }) };
  }
  async function rawGuide(dirPath: string) {
    const raw = await rpc.call("main", mainRpcMethods["workspace.readSkill"], [dirPath]);
    return raw || null;
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
      if (typeof query !== "string" || !query.trim()) return [];
      const rows = await rpc.call("main", mainRpcMethods["docs.search"], [query, { surface: "service", limit: 8 }]);
      const result = rows.map(row => {
        return { id: row.id, qualifiedName: row.qualifiedName, description: row.description ?? "" };
      });
      searchReceipts.push({ query, result });
      observe("search",{query,result});
      return result;
    },
    async open(id: string) {
      admit();
      if (typeof id !== "string" || !id.startsWith("service:")) return null;
      const route = await nativeRoute(id);
      if (route) routes.set(id, route);
      observe("open",{id,result:route});
      return route;
    },
    async installed() {
      admit();
      installed ??= await nativeIndex();
      observe("installed",installed);
      return installed;
    },
    async load(dirPath: string, focus: string[]) {
      admit();
      installed ??= await nativeIndex();
      const skill = installed.find(item => item.dirPath === dirPath && item.skillPath === `${dirPath}/SKILL.md`);
      if (!skill || !Array.isArray(focus) || !focus.length ||
          focus.some(term => typeof term !== "string")) return null;
      const raw = await rawGuide(dirPath);
      if (!raw) return null;
      const passages = rank(searchTerms(focus), sections(raw, 760).map(({ heading, text }) =>
        ({ source: skill.skillPath, section: heading, text }))).slice(0, 5).map(({ text }) => text);
      if (!passages.length) return null;
      const receipt = { skillPath: skill.skillPath, sha256: sha256HexSyncText(raw), passages };
      knowledge.set(receipt.skillPath, receipt);
      loadReceipts.push({ dirPath, focus: [...focus], result: receipt });
      observe("load",{dirPath,focus,result:receipt});
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
  async function verify(actual: TerminalDiscovery | null) {
    if (!actual) return routes.size === 0 && knowledge.size === 0;
    if (!Array.isArray(actual.routes) || !Array.isArray(actual.guidance)) return false;
    const conformedRoutes = await Promise.all(actual.routes.map(async report => {
      const fresh = await nativeRoute(report.id);
      return !!fresh && isDeepStrictEqual(report, fresh) && isDeepStrictEqual(routes.get(report.id), fresh);
    }));
    const freshSkillIndex = actual.guidance.length ? await nativeIndex() : [];
    const conformedSkills = await Promise.all(actual.guidance.map(async citation => {
      const fresh = freshSkillIndex.find(item => item.skillPath === citation?.skillPath);
      if (!fresh || typeof citation.quote !== "string" || !citation.quote.trim()) return false;
      const [loaded, raw] = [loadReceipts.map(receipt=>receipt.result).filter(result=>result.skillPath===fresh.skillPath), await rawGuide(fresh.dirPath)];
      return !!raw && citation.sha256 === sha256HexSyncText(raw) &&
        raw.includes(citation.quote) && loaded.some(result=>result.sha256===citation.sha256&&result.passages.some(passage => passage.includes(citation.quote)));
    }));
    return conformedRoutes.every(Boolean) && conformedSkills.every(Boolean);
  }
  async function verifyObserved(){
    return verify({routes:[...routes.values()],guidance:[...knowledge.values()].flatMap(loaded=>loaded.passages.map(quote=>({skillPath:loaded.skillPath,sha256:loaded.sha256,quote})))});
  }
  return { services, qualify, verify, verifyObserved, evidence };
}
