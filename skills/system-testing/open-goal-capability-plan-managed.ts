import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText, stableSha256Hex } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { RuntimeFs, VcsClient, rpc as RuntimeRpc } from "@workspace/runtime";
import type {
  CapabilityGoalReport, CapabilityHandoff, CapabilityPlan, CatalogQuery, DetailedCapability,
  InstalledKnowledge, KnowledgeCitation, ServiceOverview, SkillRow,
} from "@workspace-skills/open-doc-plan/types";
import sections from "@workspace-skills/sandbox/doc-sections";
import rank from "@workspace-skills/sandbox/doc-ranking";
import searchTerms from "@workspace-skills/sandbox/doc-search-terms";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import { capabilityPlanWorlds, type CapabilityPlanWorld } from "./open-goal-capability-plan-worlds.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";

type Ports = {
  contextId: string;
  fs: RuntimeFs;
  vcs: Pick<VcsClient, "status">;
  rpc: Pick<typeof RuntimeRpc, "call">;
};

const encoder = new TextEncoder();
const workspaceText = new TextDecoder("utf-8", { fatal: true });
const folderName = /^evidence-handoff-[a-f0-9]{32}$/u;
const methodName = /^[a-z][\w-]*\.[a-z][\w-]*$/iu;
const maxSkillBytes = 160 * 1024;
const reportBytes = 16 * 1024;
const capabilityId = (name: string) => `service:${name}`;
const compare = (a: string, b: string) => a.localeCompare(b, "en");
const boundedText = (value: string, max: number) => encoder.encode(value).length <= max;
const byCapabilityId = (ids: string[]) => [...new Set(ids)].sort(compare);

export async function prepareOpenCapabilityPlan(input: { contextId: string; caseId: string }, ports: Ports) {
  const world = capabilityPlanWorlds.find(item => item.id === input.caseId);
  if (world === undefined || ports.contextId !== input.contextId) throw new Error("Capability planning needs its owned workspace");
  const assignment: CapabilityPlanWorld = world;
  const { fs, vcs, rpc } = ports;
  const before = await vcs.status();
  const root = await fs.mkdtemp("open-capability-plan");
  const memoPath = `${root}/memo.md`;
  if (assignment.memo) await fs.writeFile(memoPath, assignment.memo.text);
  const initialHandoffs = (await fs.readdir("/.tmp")).filter(name => folderName.test(name));
  const stageAuthorized = assignment.stageAuthorized === true;

  const handoff = bindScratchHandoff(fs, {
    goal: assignment.goal,
    questions: ["Which verified operations and installed rules apply?"],
    sources: [{ id: "owned-planning-note", path: memoPath }],
  }, (path, limit) => readWorkspaceBytes(rpc, path, limit)).scratchHandoffWrite;

  async function memo() {
    if (!assignment.memo) return null;
    const text = workspaceText.decode(await readWorkspaceBytes(rpc, memoPath, 4096));
    return { title: assignment.memo.title, text, sha256: sha256HexSyncText(text) };
  }
  async function skillIndex(): Promise<SkillRow[]> {
    return (await rpc.call("main", mainRpcMethods["workspace.listSkills"], [])).map(
      ({ name, description, dirPath, skillPath }) => ({ name, description, dirPath, skillPath }),
    );
  }
  async function readSkill(dirPath: string) {
    const raw = await rpc.call("main", mainRpcMethods["workspace.readSkill"], [dirPath]);
    return raw && boundedText(raw, maxSkillBytes) ? raw : null;
  }
  async function liveDescription(id: string): Promise<DetailedCapability | null> {
    const entry = await rpc.call("main", mainRpcMethods["docs.describe"], [id]);
    if (!entry || entry.id !== id) return null;
    const schema = await rpc.call("main", mainRpcMethods["docs.getSchema"], [id]);
    if (!schema || !isDeepStrictEqual(schema.argsSchema, entry.argsSchema) ||
        !isDeepStrictEqual(schema.returnsSchema, entry.returnsSchema)) return null;
    const omittedSchemas: DetailedCapability["omittedSchemas"] = [];
    function bounded(field: "args" | "returns", value: unknown) {
      if (!value) return null;
      if (boundedText(JSON.stringify(value), 3000)) return value;
      omittedSchemas.push(field);
      return null;
    }
    return {
      id,
      surface: entry.surface,
      qualifiedName: entry.qualifiedName,
      title: entry.title,
      description: entry.description?.slice(0, 360),
      sha256: stableSha256Hex({ entry, schema }),
      argumentNames: entry.argumentNames ?? [],
      argsSchema: bounded("args", schema.argsSchema),
      returnsSchema: bounded("returns", schema.returnsSchema),
      omittedSchemas,
      access: entry.access ?? null,
    };
  }
  async function liveOverview(): Promise<ServiceOverview> {
    const [services, surfaces] = await Promise.all([
      rpc.call("main", mainRpcMethods["docs.listServices"], []),
      rpc.call("main", mainRpcMethods["docs.listSurfaces"], []),
    ]);
    const serviceNames = services.map(service => service.name).sort(compare);
    return { serviceCount: serviceNames.length, serviceNames: serviceNames.slice(0, 12),
      surfaces: [...surfaces].sort((a, b) => compare(a.surface, b.surface)) };
  }

  let currentMemo: Awaited<ReturnType<typeof memo>> | undefined;
  let installed: SkillRow[] | undefined;
  let overview: ServiceOverview | null = null;
  let staged: CapabilityHandoff | null = null;
  const seen = new Set<string>();
  const described = new Map<string, DetailedCapability>();
  const sought = new Map<string, boolean>();
  const loaded = new Map<string, InstalledKnowledge>();
  let searchCalls = 0;
  let describeCalls = 0;
  let loadCalls = 0;
  const services = {
    docPlanContext: {
      async observe() {
        currentMemo ??= await memo();
        installed ??= await skillIndex();
        return { memo: currentMemo, skillIndex: installed.slice(0, 128).map(row => ({ ...row, description: row.description.slice(0, 180) })),
          skillIndexComplete: installed.length <= 128, stageAuthorized };
      },
    },
    docPlanCatalog: {
      async search(query: CatalogQuery) {
        if (++searchCalls > 6 || !query || typeof query.query !== "string" ||
            !query.query.trim() || !boundedText(query.query, 128) ||
            !["service", "runtime", "workspace"].includes(query.surface)) return [];
        const hits = await rpc.call("main", mainRpcMethods["docs.search"], [query.query, { surface: query.surface, limit: 8 }]);
        return hits.map(hit => {
          seen.add(hit.id);
          return { ...hit, description: hit.description?.slice(0, 320) };
        });
      },
      async describe(id: string) {
        if (!seen.has(id) || ++describeCalls > 6) return null;
        const entry = await liveDescription(id);
        if (entry) described.set(id, entry);
        return entry;
      },
      async overview() {
        overview ??= await liveOverview();
        return overview;
      },
      async availableMethod(name: string) {
        if (typeof name !== "string" || !methodName.test(name) || !boundedText(name, 120) ||
            (!sought.has(name) && sought.size >= 3)) {
          throw new Error("Use an exact bounded main RPC method name");
        }
        const entry = await rpc.call("main", mainRpcMethods["docs.describe"], [capabilityId(name)]);
        const available = entry?.id === capabilityId(name) && entry.qualifiedName === name;
        sought.set(name, available);
        return available;
      },
    },
    docPlanSkills: {
      async load(dirPath: string, focus: string[]) {
        const row = installed?.slice(0, 128).find(skill => skill.dirPath === dirPath);
        if (!row || row.skillPath !== `${dirPath}/SKILL.md` || !Array.isArray(focus) || !focus.length ||
            focus.length > 6 || focus.some(term => typeof term !== "string" || !boundedText(term, 80)) ||
            ++loadCalls > 4) return null;
        const raw = await readSkill(dirPath);
        if (!raw) return null;
        const excerpts = rank(searchTerms(focus), sections(raw, 800).map(({ heading, text }) =>
          ({ source: row.skillPath, section: heading, text }))).slice(0, 6).map(({ section, text }) =>
          ({ heading: section, text }));
        if (!excerpts.length) return null;
        const knowledge = { skillPath: row.skillPath, sha256: sha256HexSyncText(raw), excerpts };
        loaded.set(row.skillPath, knowledge);
        return knowledge;
      },
    },
    docPlanHandoff: {
      async stage(plan: CapabilityPlan) {
        if (!stageAuthorized || staged || plan?.status !== "ready" || !validPlanShape(plan) ||
            plan.missing.length || !grounded(plan) || !await currentPlanSources(plan)) return null;
        const text = artifactBody(plan);
        if (!boundedText(text, reportBytes)) return null;
        const receipt = await handoff.stage(text);
        if (!receipt) return null;
        staged = { ...receipt, sha256: sha256HexSyncText(text) };
        return staged;
      },
    },
  };

  function artifactBody(plan: CapabilityPlan) {
    return JSON.stringify({ schema: "vibestudio.capability-plan/1", contextId: input.contextId,
      goal: assignment.goal, memoSha256: currentMemo?.sha256 ?? null, plan });
  }
  function grounded(plan: CapabilityPlan) {
    return plan.steps.every(step => {
      const entry = described.get(step.id);
      return entry?.sha256 === step.sha256 && isDeepStrictEqual(entry.argumentNames, step.argumentNames);
    }) && plan.knowledge.every(citation => loadedCitation(citation)) &&
      isDeepStrictEqual(plan.overview, overview);
  }
  async function currentPlanSources(plan: CapabilityPlan) {
    if (currentMemo === undefined || !isDeepStrictEqual(currentMemo, await memo())) return false;
    const [entries, skills] = await Promise.all([
      Promise.all(plan.steps.map(step => liveDescription(step.id))),
      Promise.all(plan.knowledge.map(async citation => {
        const row = installed?.find(item => item.skillPath === citation.skillPath);
        return row && await readSkill(row.dirPath);
      })),
    ]);
    return entries.every((entry, index) => entry?.sha256 === plan.steps[index]!.sha256) &&
      skills.every((raw, index) => Boolean(raw && sha256HexSyncText(raw) === plan.knowledge[index]!.sha256));
  }
  function loadedCitation(citation: KnowledgeCitation) {
    const knowledge = loaded.get(citation.skillPath);
    return knowledge?.sha256 === citation.sha256 &&
      knowledge.excerpts.some(excerpt => excerpt.text.includes(citation.quote));
  }
  async function verifyEvidence(outcome: CapabilityGoalReport | null, negative: boolean) {
    const plan = outcome?.plan;
    const valid = validPlanShape(plan);
    const expectedIds = assignment.steps.map(capabilityId);
    const newDescriptions = await Promise.all(expectedIds.map(liveDescription));
    const liveIndex = await skillIndex();
    const expectedKnow = assignment.knowledge ?? [];
    const freshKnowledge = await Promise.all(expectedKnow.map(async expected => {
      const row = liveIndex.find(skill => skill.dirPath === expected.dirPath);
      if (!row) return false;
      const raw = await readSkill(row.dirPath);
      const citation = valid ? plan.knowledge.find(item => item.skillPath === row.skillPath) : null;
      return !!raw && !!citation && citation.sha256 === sha256HexSyncText(raw) &&
        raw.includes(citation.quote) && expected.supports.test(citation.quote) && loadedCitation(citation);
    }));
    const foundMissing = assignment.missing;
    const exactNegative = foundMissing?.kind === "method"
      ? sought.get(foundMissing.name) === false &&
        await rpc.call("main", mainRpcMethods["docs.describe"], [capabilityId(foundMissing.name)]) === null
      : foundMissing?.kind === "skill"
        ? !liveIndex.some(skill => skill.name === foundMissing.name || skill.dirPath === `skills/${foundMissing.name}`)
        : true;
    const obsolete = assignment.obsoleteMethod;
    const corrected = !obsolete || (sought.get(obsolete) === false &&
      await rpc.call("main", mainRpcMethods["docs.describe"], [capabilityId(obsolete)]) === null);
    const currentOverview = assignment.inventory ? await liveOverview() : null;
    const after = await vcs.status();
    const stagedNames = (await fs.readdir("/.tmp")).filter(name => folderName.test(name) && !initialHandoffs.includes(name));
    const expectedReceipt = stageAuthorized && !foundMissing;
    let retained = !staged && !outcome?.handoff && stagedNames.length === 0;
    if (expectedReceipt && staged && valid && isDeepStrictEqual(staged, outcome?.handoff) &&
        stagedNames.length === 1 && staged.path === `/.tmp/${stagedNames[0]}/handoff.json`) {
      const bytes = await readWorkspaceBytes(rpc, staged.path, reportBytes);
      const text = workspaceText.decode(bytes);
      retained = bytes.length === staged.bytes && text === artifactBody(plan) && sha256HexSyncText(text) === staged.sha256;
    }
    return {
      observedLiveCatalog: !!installed && currentMemo !== undefined &&
        isDeepStrictEqual(currentMemo, await memo()) &&
        expectedIds.every(id => seen.has(id)),
      boundExactMethodSchemas: valid &&
        isDeepStrictEqual(plan.steps.map(step => step.id), expectedIds) &&
        plan.steps.every((step, index) => {
          const entry = newDescriptions[index];
          return entry?.sha256 === step.sha256 && described.get(step.id)?.sha256 === entry.sha256 &&
            isDeepStrictEqual(step.argumentNames, entry.argumentNames);
        }),
      loadedInstalledKnowledge: valid && plan.knowledge.length === expectedKnow.length && freshKnowledge.every(Boolean),
      reconciledPlanningEvidence: valid && corrected &&
        assignment.decision.claims.every(claim => claim.test(plan.rationale)) &&
        plan.memoDisposition === (assignment.memoDisposition ?? "none") &&
        isDeepStrictEqual(plan.overview, currentOverview) && isDeepStrictEqual(overview, currentOverview),
      respectedNegativeScope: valid && negative && exactNegative &&
        isDeepStrictEqual(plan.missing, foundMissing ? [foundMissing] : []) &&
        plan.status === (foundMissing ? "hold" : "ready"),
      verifiedCapabilityHandoff: retained && (!!staged === expectedReceipt),
      protectedCapabilityWorkspace: after.mainEventId === before.mainEventId &&
        isDeepStrictEqual(after.workingHead, before.workingHead),
    };
  }
  async function proof(outcome: CapabilityGoalReport | null) {
    const foreignId = `workspace:unobserved.${crypto.randomUUID()}`;
    const unknownSkill = `skills/unknown-${crypto.randomUUID()}`;
    const refused = await services.docPlanCatalog.describe(foreignId) === null &&
      await services.docPlanSkills.load(unknownSkill, ["lookup"]) === null &&
      await services.docPlanHandoff.stage({ ...outcome?.plan, status: "hold" } as CapabilityPlan) === null;
    const checks = await verifyEvidence(outcome, refused);
    return { caseId: assignment.id, contextId: input.contextId, goal: assignment.goal,
      checks, passed: Object.values(checks).every(Boolean),
      observed: { docIds: byCapabilityId([...seen]), described: [...described.values()], loaded: [...loaded.values()],
        memo: currentMemo, overview, unavailable: [...sought.entries()].filter(([, value]) => !value).map(([name]) => name), staged } };
  }
  async function verify(report: unknown) {
    const response = report as { status?: string; skill?: string; outcome?: CapabilityGoalReport } | null;
    return proof(response?.status === "workspace-skill-reviewed" && response.skill === "capabilityPlan" ? response.outcome ?? null : null);
  }
  async function qualify() {
    await services.docPlanContext.observe();
    const steps: CapabilityPlan["steps"] = [];
    for (const name of assignment.steps) {
      const id = capabilityId(name);
      await services.docPlanCatalog.search({ query: name, surface: "service" });
      const entry = await services.docPlanCatalog.describe(id);
      if (!entry) throw new Error(`Reference live method is unavailable: ${name}`);
      steps.push({ id, sha256: entry.sha256, argumentNames: entry.argumentNames, purpose: entry.title });
    }
    const knowledge: KnowledgeCitation[] = [];
    for (const expected of assignment.knowledge ?? []) {
      const recovered = await services.docPlanSkills.load(expected.dirPath, expected.focus);
      const passage = recovered?.excerpts.find(excerpt => expected.supports.test(excerpt.text));
      if (!recovered || !passage) throw new Error(`Reference installed guidance is unavailable: ${expected.dirPath}`);
      const match = expected.supports.exec(passage.text)!;
      const from = Math.max(0, match.index - 60);
      const quote = passage.text.slice(from, Math.min(passage.text.length, from + 220)).trim();
      if (!expected.supports.test(quote)) throw new Error(`Reference installed quote exceeded its bound: ${expected.dirPath}`);
      knowledge.push({ skillPath: recovered.skillPath, sha256: recovered.sha256, quote });
    }
    if (assignment.obsoleteMethod && await services.docPlanCatalog.availableMethod(assignment.obsoleteMethod))
      throw new Error("Reference stale memo names a live method");
    const missing = assignment.missing;
    if (missing?.kind === "method" && await services.docPlanCatalog.availableMethod(missing.name))
      throw new Error(`Reference blocker is visible: ${missing.name}`);
    const plan: CapabilityPlan = {
      status: missing ? "hold" : "ready", steps, knowledge, missing: missing ? [missing] : [],
      rationale: assignment.decision.reference,
      memoDisposition: assignment.memoDisposition ?? "none",
      overview: assignment.inventory ? await services.docPlanCatalog.overview() : null,
    };
    const receipt = stageAuthorized ? await services.docPlanHandoff.stage(plan) : null;
    return proof({ plan, handoff: receipt });
  }
  return { goal: assignment.goal, services, verify, qualify };
}

function validPlanShape(plan: CapabilityPlan | undefined): plan is CapabilityPlan {
  return !!plan && typeof plan.rationale === "string" && Boolean(plan.rationale.trim()) &&
    boundedText(plan.rationale, 600) && Array.isArray(plan.steps) && plan.steps.length <= 6 &&
    plan.steps.every(step => step && typeof step.id === "string" && typeof step.sha256 === "string" &&
      Array.isArray(step.argumentNames) && typeof step.purpose === "string" &&
      step.purpose.trim() && boundedText(step.purpose, 240)) &&
    Array.isArray(plan.knowledge) && plan.knowledge.length <= 2 &&
    plan.knowledge.every(citation => citation && typeof citation.skillPath === "string" &&
      typeof citation.sha256 === "string" && typeof citation.quote === "string" &&
      citation.quote.length >= 12 && boundedText(citation.quote, 360)) &&
    Array.isArray(plan.missing) && plan.missing.length <= 3;
}
