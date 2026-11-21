import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { VcsSearchResult, VcsStateNodeRef, VcsWalkResult } from "@vibestudio/service-schemas/vcs";
import { blobstore, contextId, vcs, type VcsClient } from "@workspace/runtime";
import type { ProvenanceQuestionWorld } from "./open-goal-provenance-question-worlds.js";

type Ports = { contextId: string | null; upload(text: string): Promise<string>;
  vcs: Pick<VcsClient, "mainState" | "status" | "resolveRepository" | "readFile" | "importSnapshot" | "edit" | "commit" | "revert" | "query" | "search" | "walk"> };
type Candidate = { ref: string; rationale: string | null; tier: string | null; excerpt: string };
type Cohort = { ref: string; paths: { path: string; count: number }[]; complete: boolean };
type Counteraction = { path: string; reason: string; attempted: string; ref: string };
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
function livePorts(): Ports {
  return { contextId, vcs, upload: async text => (await blobstore.putText(text)).digest };
}

export async function prepareProvenanceQuestion(input: { contextId: string; caseId: string }, world: ProvenanceQuestionWorld, ports = livePorts()) {
  const context = input.contextId, owner = ports.vcs;
  if (input.caseId !== world.id || context !== ports.contextId) throw new Error("Wrong provenance question ownership");
  const status = () => owner.status({ contextId: context });
  const main = await owner.mainState(), starting = await status();
  if (!starting.clean) throw new Error("Recorded question requires a clean owned context");
  const scope = "projects/recorded-question-" + crypto.randomUUID();
  const sortedPaths = [...world.paths].sort();
  const seedValues = new Map([...sortedPaths, "desk/other-note.txt"].map(path => [path, `Prior local value for ${path}\n`]));
  const files = await Promise.all([...seedValues].sort(([left],[right]) => left < right ? -1 : 1)
    .map(async ([path,text]) => ({ path, mode: 0o644, contentHash: await ports.upload(text) })));
  const imported = await owner.importSnapshot({ contextId: context, commandId: crypto.randomUUID(), expectedWorkingHead: starting.workingHead,
    source: { kind: "generated", uri: `system-test://${world.id}/${scope}`, snapshotRevision: `fixture:${sha256HexSyncText(JSON.stringify(files))}` },
    repositories: [{ repoPath: scope, files }], message: "Open the disposable decision record" });
  const repositoryId = imported.importedRepositoryIds[0];
  if (!repositoryId || imported.importedRepositoryIds.length !== 1) throw new Error("Native decision record missed its assigned repository");
  let head: VcsStateNodeRef = { kind: "event", eventId: imported.eventId };
  const readFile = (state: VcsStateNodeRef,path: string) => owner.readFile({ state, repositoryId, file: {kind:"path",path} });
  const nextValues = new Map(seedValues);
  async function edit(paths: string[], intentSummary: string, value: string) {
    const changes = await Promise.all(paths.map(async path => {
      const file = await readFile(head,path);
      if (file?.content.kind !== "text" || file.path !== path || file.repositoryId !== repositoryId) throw new Error("Recorded question has no exact owned file");
      const text = value + "\n";
      nextValues.set(path,text);
      return { kind:"text-edit" as const, repositoryId, fileId:file.fileId, edits:[{start:0,end:file.content.text.length,text}] };
    }));
    const recorded = await owner.edit({ contextId:context, commandId:crypto.randomUUID(), expectedWorkingHead:head,intentSummary,changes });
    if (recorded.changeIds.length !== paths.length || !recorded.workUnitId) throw new Error("No complete native proposal cohort");
    head = (await owner.commit({contextId:context,commandId:crypto.randomUUID(),expectedWorkingHead:recorded.workingHead,message:"Retain exact local request"})).event;
    return recorded;
  }
  const proposed = await edit(sortedPaths,world.statement,"Accepted source candidate");
  const competing = await edit(["desk/other-note.txt"],world.competing ? `Separate ${world.phrase} request by another local team` :
    "Refresh the unrelated receiving desk note", "Different local issue");
  const portfolio = new Set([proposed.workUnitId,competing.workUnitId]);
  const undonePaths = sortedPaths.slice(0,world.undone);
  let counterWork: string | null = null;
  if (undonePaths.length) {
    const group = await owner.query({ contextId:context, query: `SELECT change_id, result_path FROM prov_changes WHERE work_unit_id = ${quote(proposed.workUnitId)}`, limit:30 });
    const ids = undonePaths.map(path => group.rows.find(row => row[1] === path)?.[0]);
    if (group.refusal || group.truncated || !ids.every(id => typeof id === "string")) throw new Error("Could not address prior coordinates explicitly");
    const reverted = await owner.revert({ contextId:context,commandId:crypto.randomUUID(),expectedWorkingHead:head,
      intentSummary:world.reason,changeIds:ids as string[] });
    if (reverted.changeIds.length !== ids.length) throw new Error("Native counteraction did not bind its exact cohort");
    counterWork = reverted.workUnitId;
    head = (await owner.commit({contextId:context,commandId:crypto.randomUUID(),expectedWorkingHead:reverted.workingHead,message:"Record rejected local attempt"})).event;
    for (const path of undonePaths) nextValues.set(path,seedValues.get(path)!);
  }
  const current = await status();
  if (!current.clean || !isDeepStrictEqual(head,current.workingHead) || (await owner.resolveRepository({ repoPath:scope,state:head }))?.repositoryId !== repositoryId)
    throw new Error("Recorded provenance review was not handed the exact local head");
  const assignment = { id:crypto.randomUUID(),goal:world.goal,scope };
  let disclosed = false, searchText = "", candidates: Candidate[] | null = null;
  let rawSearch: VcsSearchResult | null = null, cohort: Cohort | null = null, withdrawn: Counteraction[] | null = null;
  let readsInFlight = false;
  const nativeRoots = new Map<string,string>();
  const nativeCounteractions = new Map<string,VcsWalkResult>();
  const effects: { service:string;method:string;args:unknown[];result:unknown }[] = [];
  function capture<T>(service:string,method:string,args:unknown[],result:T):T {
    effects.push(structuredClone({service,method,args,result})); return structuredClone(result);
  }
  function scopeOf(id:string) { if (!disclosed || id !== assignment.id) throw new Error("Question reads require the exact owned assignment"); }
  async function cohortNative(ref:string, workUnitId:string):Promise<Cohort> {
    const result = await owner.query({ contextId:context, limit:30,
      query: `SELECT result_path, count(DISTINCT change_id) FROM prov_changes WHERE work_unit_id = ${quote(workUnitId)} GROUP BY result_path ORDER BY result_path` });
    const complete = !result.refusal && !result.truncated && isDeepStrictEqual(result.state,head);
    const paths = result.rows.flatMap(([path,count]) => typeof path === "string" && typeof count === "number" ? [{path,count}] : []);
    return { ref,paths,complete:complete && paths.length === result.rows.length };
  }
  const services = {
    recordedQuestionDiscovery: {
      async discover() {
        if (disclosed) throw new Error("Question already opened");
        disclosed = true;
        return capture("recordedQuestionDiscovery","discover",[],assignment);
      },
      async search(id:string,phrase:string) {
        scopeOf(id);
        if (candidates || readsInFlight || !phrase.trim() || phrase.length>120) throw new Error("Choose a short scoped search phrase");
        readsInFlight = true;
        try {
          rawSearch = await owner.search({contextId:context,text:phrase,limit:20});
          if (rawSearch.truncated) throw new Error("Local question search was incomplete");
          candidates = rawSearch.hits.flatMap(hit => {
            if (hit.node.kind !== "work-unit" || !portfolio.has(hit.node.workUnitId)) return [];
            const ref = "proposal-" + (nativeRoots.size+1);
            nativeRoots.set(ref,hit.node.workUnitId);
            return [{ref,rationale:hit.intent?.text??null,tier:hit.intent?.tier??null,excerpt:hit.excerpt}];
          });
          searchText = phrase;
          return capture("recordedQuestionDiscovery","search",[id,phrase],candidates);
        } finally { readsInFlight = false; }
      },
    },
    recordedQuestionGraph: {
      async cohort(id:string,ref:string) {
        scopeOf(id);
        const workUnit = nativeRoots.get(ref);
        if (!workUnit || cohort || readsInFlight) throw new Error("Cohort requires an exact visible result reference");
        readsInFlight = true;
        try {
          cohort = await cohortNative(ref,workUnit);
          return capture("recordedQuestionGraph","cohort",[id,ref],cohort);
        } finally { readsInFlight = false; }
      },
      async rejections(id:string,ref:string,selected:Cohort) {
        scopeOf(id);
        const original = candidates?.find(row=>row.ref===ref)?.rationale;
        if (!original || !cohort?.complete || cohort.ref!==ref || !isDeepStrictEqual(cohort,selected) || withdrawn || readsInFlight)
          throw new Error("Rejections require the exact observed complete cohort");
        readsInFlight = true;
        try {
          const workUnit = nativeRoots.get(ref)!;
          const links = await owner.query({ contextId:context,limit:30,query:
            `SELECT DISTINCT original.result_path, against.work_unit_id
             FROM prov_counteractions edge
             JOIN prov_changes original ON original.change_id = edge.counteracted_change_id
             JOIN prov_changes against ON against.change_id = edge.change_id
             WHERE original.work_unit_id = ${quote(workUnit)}` });
          if (links.truncated || links.refusal || !isDeepStrictEqual(links.state,head))
            throw new Error("The exact counteraction-work linkage is unavailable");
          const boundPairs = new Set(links.rows.map(([path,id])=>JSON.stringify([path,id])));
          withdrawn = [];
          for (const {path} of cohort.paths) {
            const file=await readFile(head,path);
            if (!file || file.repositoryId!==repositoryId) throw new Error("Cohort path escaped the assigned repository");
            const result=await owner.walk({contextId:context,walk:"rejections",scope:"work-unit",limit:30,
              subject:{kind:"file",state:head,repositoryId,fileId:file.fileId}});
            if (result.nextCursor || result.omitted.length) throw new Error("Local rejection proof was incomplete");
            nativeCounteractions.set(path,result);
            for (const entry of result.entries) {
              if (entry.group!=="counteractions" || entry.node.kind!=="work-unit" || !entry.intent || !entry.detail ||
                  !boundPairs.has(JSON.stringify([path,entry.node.workUnitId]))) continue;
              withdrawn.push({path,ref:"counteraction-"+(withdrawn.length+1),attempted:entry.detail,reason:entry.intent.text});
            }
          }
          return capture("recordedQuestionGraph","rejections",[id,ref,selected],withdrawn);
        } finally { readsInFlight=false; }
      },
    },
  };
  function expectedReport() {
    const selected = candidates?.find(row=>nativeRoots.get(row.ref)===proposed.workUnitId) ?? null;
    const blocked = world.absent ? "missing" : world.competing ? "ambiguous" : null;
    const ref = blocked ? null : selected?.ref??null;
    const selection = {ref,blocker:blocked};
    const evidence = ref && cohort && withdrawn ? {cohort,withdrawn} : null;
    const answer = {disposition:world.expected,originalRationale:blocked?null:selected?.rationale??null,
      affected:blocked?[]:sortedPaths,withdrawn:blocked?[]:undonePaths,reasons:blocked||!world.reason?[]:[world.reason]};
    return {assignment,phrase:searchText,candidates:candidates??[],selection,evidence,answer};
  }
  async function verify(value:unknown) {
    const actual=value as {status?:string;skill?:string;outcome?:unknown}|null;
    const after=await status();
    const rereads=await Promise.all([...nextValues].map(async ([path,expected])=>{
      const value=await readFile(after.workingHead,path);
      return value?.content.kind==="text"&&value.content.text===expected;
    }));
    const scoped=expectedReport(), observe=world.absent||world.competing?0:1;
    const expectedWorkIds = world.absent ? [] : world.competing ? [proposed.workUnitId,competing.workUnitId] : [proposed.workUnitId];
    const target = candidates?.find(item => nativeRoots.get(item.ref)===proposed.workUnitId);
    const nativeProof = [...nativeCounteractions.values()].flatMap(row=>row.entries.filter(entry=>entry.group==="counteractions" && entry.detail?.includes(world.statement)));
    const checks={
      retrievedVisibleRecordedIntent: disclosed&&!!rawSearch&&isDeepStrictEqual([...nativeRoots.values()].sort(),expectedWorkIds.sort())&&
        (world.absent||target?.rationale===world.statement&&target.tier==="stated"),
      verifiedExactWorkCohort: observe===0 ? cohort===null : Boolean(cohort?.complete&&nativeRoots.get(cohort.ref)===proposed.workUnitId&&
        isDeepStrictEqual(cohort.paths,sortedPaths.map(path=>({path,count:1})))),
      verifiedNativeCounteractionRationale: observe===0 ? withdrawn===null : withdrawn!==null&&
        isDeepStrictEqual(withdrawn.map(item=>item.path),undonePaths)&&withdrawn.every(item=>item.reason===world.reason)&&
        nativeProof.length===undonePaths.length&&nativeProof.every(entry=>entry.node.kind==="work-unit"&&entry.node.workUnitId===counterWork),
      preservedLocalQuestionScope: after.clean&&isDeepStrictEqual(after.workingHead,head)&&isDeepStrictEqual(await owner.mainState(),main)&&rereads.every(Boolean)&&
        effects.length===2+observe*2,
      matchedRecordedQuestionReport: actual?.status==="workspace-skill-reviewed"&&actual.skill==="provenanceQuestion"&&isDeepStrictEqual(actual.outcome,scoped),
    };
    return {caseId:world.id,contextId:context,goal:world.goal,passed:Object.values(checks).every(Boolean),checks,...scoped,effects:structuredClone(effects),
      native:{head,repositoryId,originalWork:proposed.workUnitId,counterWork,search:rawSearch,walks:[...nativeCounteractions]}};
  }
  async function qualify() {
    await services.recordedQuestionDiscovery.discover();
    await services.recordedQuestionDiscovery.search(assignment.id,world.phrase);
    const reference=expectedReport();
    const reject=async (work:()=>Promise<unknown>)=>{try {await work();return false;}catch{return true;}};
    const rejectedUnknownReference=await reject(()=>services.recordedQuestionGraph.cohort(assignment.id,"foreign"));
    const ref=reference.selection.ref;
    if (ref) {
      const result=await services.recordedQuestionGraph.cohort(assignment.id,ref);
      await services.recordedQuestionGraph.rejections(assignment.id,ref,result);
    }
    const report={status:"workspace-skill-reviewed",skill:"provenanceQuestion",outcome:expectedReport()};
    const proof=await verify(report);
    const rejectedInventedScope=!(await verify({...report,outcome:{...report.outcome,answer:{...report.outcome.answer,affected:["other-local-scope"]}}})).passed;
    const checks={...proof.checks,rejectedUnknownReference,rejectedInventedScope};
    return {...proof,checks,passed:Object.values(checks).every(Boolean),report};
  }
  return {services,qualify,verify};
}
