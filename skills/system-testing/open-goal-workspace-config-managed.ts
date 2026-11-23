import { isDeepStrictEqual as equal } from "node:util";
import { basename } from "node:path";
import YAML from "yaml";
import { sha256HexSyncText, stableSha256Hex } from "@vibestudio/content-addressing";
import { parseWorkspaceSystemEpochEnvelope } from "@vibestudio/workspace/configParser";
import { currentContextProjectionsPath } from "@vibestudio/workspace/contextProjections";
import { parseTemplateManifestContent } from "@vibestudio/workspace/templateManifest";
import type { WorkspaceConfig } from "@vibestudio/workspace-contracts/types";
import { contextId, fs, rpc, vcs, workspace, type VcsClient } from "@workspace/runtime";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type {
  ConfigBrief, ConfigDisposition, ConfigEvidence, ConfigFact, ConfigIdentity, ConfigDependencies, ConfigLens,
  ConfigOutcome, ConfigQuestion, ConfigReport,
} from "@workspace-skills/open-workspace-config/types";
import { openWorkspaceConfigWorlds } from "./open-goal-workspace-config-worlds.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";

type State = Awaited<ReturnType<VcsClient["status"]>>["workingHead"];
type Ports = {
  contextId: string | null;
  fs: typeof fs;
  vcs: Pick<VcsClient,"status"|"mainState"|"resolveRepository"|"readFile"|"edit"|"commit">;
  workspace: Pick<typeof workspace,"getActive"|"getInfo"|"getConfig">;
  readBytes: (path: string, max: number) => Promise<Uint8Array>;
};
function livePorts(): Ports {
  return {contextId,fs,vcs,workspace,
    readBytes:(path,max)=>readWorkspaceBytes(rpc,path,max)};
}

const fields = {
  "panel-restore": (value)=>value.panelRestorePolicy,
  "launch-panels": (value)=>value.initPanels?.map(panel=>panel.source),
  "minimum-app": (value)=>value.minimumAppVersion,
  "desktop-client": (value)=>value.clientDefaults?.desktop,
  "natlang-provider": (value)=>value.providers?.natlang?.source,
  "terminal-extensions": (value)=>value.runtimeExtensions?.terminal,
  "agent-fast-mode": (value)=>value.defaultAgentConfig?.fastMode,
} satisfies Record<ConfigQuestion,(value:Omit<WorkspaceConfig,"id"|"services">)=>unknown>;

function selectFacts(value: Omit<WorkspaceConfig,"id"|"services">, questions: ConfigQuestion[]): ConfigFact[] {
  return questions.map(question=>{
    const field = fields[question](value);
    return {question,declared:field!==undefined,value:field===undefined?"":JSON.stringify(field)};
  });
}

const olderSettings:Record<ConfigQuestion,unknown> = {
  "panel-restore":"focused", "launch-panels": ["panels/welcome"], "minimum-app":"0.1.0",
  "desktop-client":"clients/desktop", "natlang-provider":"packages/natlang-v1",
  "terminal-extensions":["extensions/shell"], "agent-fast-mode":false,
};
function retainedAlternate(fact:ConfigFact):ConfigFact {
  const value=JSON.stringify(olderSettings[fact.question]);
  return fact.declared&&fact.value===value?{...fact,declared:false,value:""}:{...fact,declared:true,value};
}
const asText = (bytes:Uint8Array) => new TextDecoder("utf8",{fatal:true}).decode(bytes);
const stamp = (state:State)=>state.kind==="event"?state.eventId:state.applicationId;
const sizeLimit = 24_000;

export async function prepareWorkspaceConfig(input:{contextId:string;caseId:string},ports=livePorts()) {
  const world=openWorkspaceConfigWorlds.find(({id})=>input.caseId===id);
  if(!world||!ports.contextId||ports.contextId!==input.contextId)throw new Error("Configuration review requires the assigned context");
  const owner=input.contextId;
  const initial=await ports.vcs.status();
  const initialMain=await ports.vcs.mainState();
  if(initial.contextId!==owner||!initial.clean||initial.mainEventId!==initialMain.eventId||initial.integrating.length)
    throw new Error("Configuration review requires a clean owned working basis and exact main");

  async function manifestFile(state:State) {
    const repo=await ports.vcs.resolveRepository({state,repoPath:"meta"});
    if(!repo)throw new Error("No root settings repository at "+stamp(state));
    const file=await ports.vcs.readFile({state,repositoryId:repo.repositoryId,file:{kind:"path",path:"vibestudio.yml"}});
    if(!file||file.content.kind!=="text")throw new Error("No text root configuration at "+stamp(state));
    return {file,repositoryId:repo.repositoryId,text:file.content.text};
  }
  async function editDraft(state:State,setting:"restore"|"fast") {
    const {file,repositoryId,text}=await manifestFile(state);
    const doc=YAML.parseDocument(text);
    if(setting==="restore")doc.set("panelRestorePolicy",doc.get("panelRestorePolicy")==="focused"?"none":"focused");
    else doc.setIn(["defaultAgentConfig","fastMode"],doc.getIn(["defaultAgentConfig","fastMode"])!==true);
    const draft=doc.toString();
    if(draft===text)throw new Error("Disposable configuration revision did not change");
    return (await ports.vcs.edit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:state,
      intentSummary:"Retain a disposable settings review candidate",changes:[{kind:"content-replace",repositoryId,
        fileId:file.fileId,content:{kind:"text",text:draft}}]})).workingHead;
  }
  let head=initial.workingHead;
  if(world.source==="committed"||world.source==="both") {
    const changed=await editDraft(head,world.questions.includes("panel-restore")?"restore":"fast");
    head=(await ports.vcs.commit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:changed,
      message:"Record an unpublished settings comparison point"})).event;
  }
  if(world.source==="working"||world.source==="working-unrelated"||world.source==="both")
    await editDraft(head,world.source==="working"&&world.questions.includes("panel-restore")?"restore":"fast");
  const before=await ports.vcs.status();
  if(before.contextId!==owner||before.mainEventId!==initialMain.eventId)
    throw new Error("Disposable settings setup changed the protected basis");

  const expectedLens:ConfigLens={questions:world.questions,inspectManifest:world.source!==undefined,
    inspectDependencies:world.dependencies===true};
  const scratch=await ports.fs.mkdtemp("workspace-config-review");
  const briefPath=scratch+"/retained-note.json";
  const scopePath=scratch+"/owned-request.txt";
  await ports.fs.writeFile(scopePath,world.goal);

  async function active(questions:ConfigQuestion[]):Promise<ConfigIdentity> {
    const [name,info,current]=await Promise.all([ports.workspace.getActive(),ports.workspace.getInfo(),ports.workspace.getConfig()]);
    if(name!==info.name||!equal(current,info.config))throw new Error("Workspace configuration changed during the active read");
    return {id:info.id,name,configId:current.id,epoch:current.systemEpoch,appVersion:info.appVersion,
      hubVersion:info.currentAppVersion,projectionNamespace:basename(info.contextProjectionsPath),
      projectionUsesCurrentNamespace:info.contextProjectionsPath===currentContextProjectionsPath(info.statePath),
      facts:selectFacts(current,questions)};
  }
  const initialActive=await active(world.questions);
  if(world.retained!=="absent") {
    const raw={id:world.retained==="other-id"?"older-workspace-"+crypto.randomUUID():initialActive.id,
      name:world.retained==="other-name"?"Former "+initialActive.name:initialActive.name,
      epoch:initialActive.epoch+(world.retained==="other-epoch"?1:0),
      facts:world.retained==="stale"?initialActive.facts.map(retainedAlternate):initialActive.facts};
    await ports.fs.writeFile(briefPath,JSON.stringify(raw));
  }
  async function readStoredBrief():Promise<ConfigBrief> {
    if(!await ports.fs.exists(briefPath))
      return {subject:world.subject,noteHash:null,noteId:null,noteName:null,noteEpoch:null,noteFacts:[]};
    const text=asText(await ports.readBytes(briefPath,sizeLimit));
    const notice=JSON.parse(text) as {id:string;name:string;epoch:number;facts:ConfigFact[]};
    return {subject:world.subject,noteHash:sha256HexSyncText(text),noteId:notice.id,noteName:notice.name,
      noteEpoch:notice.epoch,noteFacts:notice.facts};
  }
  async function describeState(state:State,questions:ConfigQuestion[]) {
    const {file,text}=await manifestFile(state);
    const epoch=parseWorkspaceSystemEpochEnvelope(text);
    const {top}=parseTemplateManifestContent(text,epoch);
    return {ref:stamp(state),fileId:file.fileId,digest:file.contentHash,epoch,facts:selectFacts(top,questions)};
  }
  async function history(questions:ConfigQuestion[]) {
    const status=await ports.vcs.status();
    const main=await ports.vcs.mainState();
    if(status.contextId!==owner||main.eventId!==initialMain.eventId||status.mainEventId!==main.eventId)
      throw new Error("Owned settings or protected main changed");
    const [working,committed,protectedManifest]=await Promise.all([
      describeState(status.workingHead,questions),describeState(status.committed,questions),describeState(main,questions),
    ]);
    return {contextId:owner,clean:status.clean,working,committed,main:protectedManifest};
  }
  async function readDependencies(eventId:string):Promise<ConfigDependencies> {
    const {file,text}=await manifestFile({kind:"event",eventId});
    const epoch=parseWorkspaceSystemEpochEnvelope(text);
    const {dependencies,top}=parseTemplateManifestContent(text,epoch);
    return {mainEvent:eventId,manifestDigest:file.contentHash,epoch,minimumAppVersion:top.minimumAppVersion??null,
      sources:dependencies.map(({url,track,commit})=>({addressDigest:stableSha256Hex(url),
        track:track??null,pinnedCommit:commit??null}))};
  }
  function disposition(brief:ConfigBrief,evidence:ConfigEvidence) {
    const {active,history,dependencies}=evidence;
    const sameWorkspace=brief.noteId===active.id;
    const sameEpoch=brief.noteEpoch===active.epoch;
    const affectedQuestions=sameWorkspace&&sameEpoch?active.facts.filter(fact=>
      !equal(fact,brief.noteFacts.find(item=>item.question===fact.question))).map(({question})=>question):[];
    const noteStatus:ConfigOutcome["noteStatus"]=!brief.noteHash?"no-note":!sameWorkspace?"different-workspace":
      !sameEpoch?"different-epoch":brief.noteName!==active.name?"stale-name":affectedQuestions.length?"stale-values":"matches";
    const workingChange=history!==null&&history.working.digest!==history.committed.digest;
    const committedChange=history!==null&&history.committed.digest!==history.main.digest;
    const sourceStatus:ConfigOutcome["sourceStatus"]=!history?"uninspected":workingChange?
      (committedChange?"working-and-committed":"working-only"):committedChange?"committed-only":"aligned";
    const dependencyStatus:ConfigOutcome["dependencyStatus"]=!expectedLens.inspectDependencies?"uninspected":
      dependencies?.epoch!==active.epoch?"epoch-mismatch":dependencies.sources.length?"declared":"no-declarations";
    const differences=(first:ConfigFact[],second:ConfigFact[])=>first.filter((fact,index)=>!equal(fact,second[index]))
      .map(({question})=>question);
    return {noteStatus,sourceStatus,dependencyStatus,affectedQuestions,
      workingDifferences:history?differences(history.working.facts,history.committed.facts):[],
      committedDifferences:history?differences(history.committed.facts,history.main.facts):[]};
  }

  const scratchBefore=new Set(await listOwnedScratchEntries(ports.fs));
  const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["Which exact settings and evidence apply?"],
    sources:[{id:"owned-request",path:scopePath}]},ports.readBytes).scratchHandoffWrite;
  const observation:{brief?:ConfigBrief;active?:ConfigIdentity;history?:ConfigEvidence["history"];dependencies?:ConfigDependencies|null}={};
  let handoff:ConfigDisposition|null=null;
  let staged=false;
  const encode=(report:Omit<ConfigReport,"handoff">)=>JSON.stringify({visibility:"private-local",...report});
  const authorized=(outcome:ConfigOutcome)=>world.note==="always"||(world.note==="if-aligned"&&outcome.noteStatus==="matches");
  function exactDecision(value:ConfigOutcome|undefined,brief:ConfigBrief,evidence:ConfigEvidence) {
    if(typeof value?.summary!=="string"||!value.summary.trim()||value.summary.length>700)return false;
    const {summary:_,...fields}=value;
    return equal(fields,disposition(brief,evidence));
  }
  function observedEvidence():ConfigEvidence|null {
    if(!observation.active||
       (expectedLens.inspectManifest&&observation.history===undefined)||
       (expectedLens.inspectDependencies&&observation.dependencies===undefined))return null;
    return {active:observation.active,history:observation.history??null,dependencies:observation.dependencies??null};
  }
  async function independentEvidence():Promise<ConfigEvidence> {
    return {active:await active(world.questions),history:expectedLens.inspectManifest?await history(world.questions):null,
      dependencies:expectedLens.inspectDependencies?await readDependencies(initialMain.eventId):null};
  }

  let stagedText:string|null=null;
  const services={
    nativeWorkspaceConfig:{
      async readBrief(){observation.brief=await readStoredBrief();return structuredClone(observation.brief);},
      async inspectActive(questions:ConfigQuestion[]){
        if(!observation.brief||!equal(questions,expectedLens.questions)||observation.active)return null;
        observation.active=await active(questions);return structuredClone(observation.active);
      },
      async inspectManifests(questions:ConfigQuestion[]){
        if(!observation.active||!expectedLens.inspectManifest||!equal(questions,expectedLens.questions)||observation.history)return null;
        observation.history=await history(questions);return structuredClone(observation.history);
      },
      async inspectDependencies(mainEvent:string){
        if(!expectedLens.inspectDependencies||!observation.history||mainEvent!==observation.history.main.ref||
          mainEvent!==initialMain.eventId||observation.dependencies!==undefined)return null;
        if((await ports.vcs.mainState()).eventId!==mainEvent)return null;
        observation.dependencies=await readDependencies(mainEvent);return structuredClone(observation.dependencies);
      },
    },
    nativeConfigHandoff:{async stage(brief:ConfigBrief,lens:ConfigLens,evidence:ConfigEvidence,outcome:ConfigOutcome) {
      if(staged||!outcome||!authorized(outcome)||!equal(observation.brief,brief)||!equal(expectedLens,lens)||
        !equal(evidence,observedEvidence())||!exactDecision(outcome,brief,evidence))return null;
      staged=true;
      if(!equal(evidence,await independentEvidence())||!equal(brief,await readStoredBrief()))return null;
      const text=encode({brief,lens,evidence,outcome});
      const saved=(stagedText=text,await writer.stage(text));
      handoff=saved?{path:saved.path,digest:sha256HexSyncText(text)}:null;
      return structuredClone(handoff);
    }},
  };

  async function verify(raw:unknown) {
    const value=raw as ConfigReport|null;
    const report=value;
    const independent=await independentEvidence();
    const freshBrief=await readStoredBrief();
    const currentStatus=await ports.vcs.status();
    const currentMain=await ports.vcs.mainState();
    const evidence=observedEvidence();
    const outcome=disposition(freshBrief,independent);
    const artifact=handoff?asText(await ports.readBytes(handoff.path,sizeLimit)):null;
    const files=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!scratchBefore.has(name));
    const checks={
      exactConfigBrief:equal(observation.brief,freshBrief),
      scopedConfigLens:evidence!==null,
      exactLiveWorkspaceConfig:equal(evidence?.active,independent.active),
      exactProtectedConfigHistory:equal(evidence?.history,independent.history)&&
        (independent.history===null||independent.history.main.ref===currentMain.eventId),
      exactProtectedTemplateDependencies:equal(evidence?.dependencies,independent.dependencies)&&
        (independent.dependencies===null||independent.dependencies.mainEvent===currentMain.eventId),
      exactConfigDisposition:exactDecision(report?.outcome,freshBrief,independent),
      preservedProtectedConfig:equal(currentStatus,before)&&equal(currentMain,initialMain),
      constrainedConfigEvidence:await services.nativeWorkspaceConfig.inspectActive(["not-a-field" as ConfigQuestion])===null&&
        await services.nativeWorkspaceConfig.inspectDependencies("foreign-"+initialMain.eventId)===null,
      exactPrivateConfigNote:authorized({...outcome,summary:""})?!!report&&!!artifact&&!!handoff&&files.length===1&&
        handoff.path===`/.tmp/${files[0]}/handoff.json`&&handoff.digest===sha256HexSyncText(artifact)&&
        artifact===stagedText&&
        equal(report.handoff,handoff):handoff===null&&report?.handoff===null&&files.length===0,
    };
    return {contextId:owner,caseId:world.id,goal:world.goal,passed:Object.values(checks).every(Boolean),checks,
      brief:freshBrief,lens:expectedLens,evidence,outcome:report?.outcome??null,handoff,artifact};
  }

  async function qualify() {
    const calls=services.nativeWorkspaceConfig;
    const brief=await calls.readBrief();
    const active=await calls.inspectActive(world.questions);
    if(!active)throw new Error("The reference could not read active workspace settings");
    const history=expectedLens.inspectManifest?await calls.inspectManifests(world.questions):null;
    if(expectedLens.inspectManifest&&!history)throw new Error("The reference did not read settings history");
    const dependencies=expectedLens.inspectDependencies&&history?await calls.inspectDependencies(history.main.ref):null;
    const evidence={active,history,dependencies};
    const outcome:ConfigOutcome={...disposition(brief,evidence),summary:"Checked current declarations, the retained note, and the requested exact source references."};
    const handoff=authorized(outcome)?await services.nativeConfigHandoff.stage(brief,expectedLens,evidence,outcome):null;
    const application={outcome,handoff};
    const proof=await verify(application);
    const rejectsIncorrectApplicationReturn=!(await verify({...application,outcome:{...application.outcome,noteStatus:"invented"}})).passed;
    return {...proof,rejectsIncorrectApplicationReturn,passed:proof.passed&&rejectsIncorrectApplicationReturn};
  }
  return {services,verify,qualify};
}
