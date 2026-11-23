import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { gitUpstreamStatusRowSchema, type GitUpstreamStatusRow } from "@vibestudio/service-schemas/gitInterop";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import type { VcsClient } from "@workspace/runtime";
import { bindGitBridgeReview } from "@workspace-skills/git-bridge-review-bindings";
import { bindVcsDelivery } from "@workspace-skills/vcs-delivery-bindings";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { BranchAssessment, BranchPrivateNote, BridgeDecision, BridgeDeliveryReport, BridgeIndex, BridgePlan,
  DeliveryScope, DeliveryState, LocalDeliveryReceipt, LocalFileReview, LocalGitReview, RetainedBranch } from "@workspace-skills/open-bridge-delivery/types";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { openBridgeDeliveryWorlds, type OpenBridgeDeliveryWorld } from "./open-goal-bridge-delivery-worlds.js";

type GitBinding=ReturnType<typeof bindGitBridgeReview>;
type VcsBinding=ReturnType<typeof bindVcsDelivery>;
type Ports = { contextId:string|null; fs:typeof fs; vcs:VcsClient;
  bindGit:typeof bindGitBridgeReview; bindDelivery:typeof bindVcsDelivery;
  readBytes(path:string,max:number):Promise<Uint8Array> };
const retainLimit=18_000;
const evidencePath="branch-observation.json";
const routePath="owned-release-route.json";
const specPath="delivery-contract.txt";
const notePath="release-note.txt";
const authorizesAfter=1_795_000_000_000;
const branchReceiptAt=authorizesAfter+30_000;
const textContent=(text:string)=>({kind:"text" as const,text});
const event=(eventId:string):DeliveryState=>({kind:"event",eventId});

function livePorts():Ports {
  return {contextId,fs,vcs,bindGit:bindGitBridgeReview,bindDelivery:bindVcsDelivery,
    readBytes:(path,max)=>readWorkspaceBytes(rpc,path,max)};
}

function seedRetainedBranch(world:OpenBridgeDeliveryWorld,repository:string,archive:string,sourceEvent:string,owner:string):GitUpstreamStatusRow|null {
  const basis={repoPath:repository,remote:world.remote??"origin",branch:world.branch,autoPush:false};
  const observed={observedAt:branchReceiptAt,remoteBranchExists:true,relationship:"in-sync" as const,aheadBy:0,behindBy:0};
  switch (world.condition) {
    case "missing": return null;
    case "target-mismatch": return {...basis,...observed,state:"in-sync",
      repoPath:world.evidence==="wrong-repo"?archive:repository,
      remote:world.evidence==="wrong-remote"?"mirror":basis.remote,
      branch:world.evidence?world.branch:"archive/old"};
    case "candidate-pending": return {...basis,...observed,state:"integration-required",candidate:{contextId:owner,eventId:sourceEvent}};
    case "failed-observation": return world.evidence==="silent"?{...basis,state:"error"}:{...basis,state:world.evidence==="auth-failed"?"auth-failed":"fetch-failed",
      lastSuccessfulObservationAt:authorizesAfter-5_000};
    case "stale": return {...basis,...observed,state:"in-sync",observedAt:authorizesAfter-50_000};
    case "branch-absent": return {...basis,observedAt:branchReceiptAt,remoteBranchExists:false,state:"ahead"};
    case "behind": return {...basis,...observed,state:"behind",relationship:"behind",behindBy:3};
    case "diverged": return {...basis,...observed,state:"diverged",relationship:"diverged",aheadBy:2,behindBy:3};
    case "aligned": return world.id.includes("with-ahead")?
      {...basis,...observed,state:"ahead",relationship:"ahead",aheadBy:1}:{...basis,...observed,state:"in-sync"};
  }
}

export function parseRetainedBranch(raw:string|null):RetainedBranch|null {
  if(raw===null)return null;
  const row=gitUpstreamStatusRowSchema.parse(JSON.parse(raw));
  return {repository:row.repoPath,remote:row.remote??null,branch:row.branch??null,state:row.state,
    relationship:row.relationship??null,observedAt:row.observedAt??null,lastSuccessfulAt:row.lastSuccessfulObservationAt??null,
    branchExists:row.remoteBranchExists??null,ahead:row.aheadBy??null,behind:row.behindBy??null,
    candidateContext:row.candidate?.contextId??null,candidateEvent:row.candidate?.eventId??null};
}

export function classifyRetainedBranch(scope:DeliveryScope):BranchAssessment["status"] {
  const row=scope.retained;
  if(!row)return "missing";
  if(row.repository!==scope.repository||row.remote!==scope.remote||row.branch!==scope.branch)return "target-mismatch";
  if(row.candidateEvent||row.candidateContext)return "candidate-pending";
  if(row.observedAt===null||row.branchExists===null||["auth-failed","fetch-failed","error"].includes(row.state))return "failed-observation";
  if(row.observedAt<scope.reviewSince)return "stale";
  if(!row.branchExists)return "branch-absent";
  if(row.relationship==="behind"||row.relationship==="diverged")return row.relationship;
  return row.relationship==="ahead"||row.relationship==="in-sync"?"aligned":"failed-observation";
}

export async function prepareOpenBridgeDelivery(input:{contextId:string;caseId:string},ports=livePorts()) {
  const world=openBridgeDeliveryWorlds.find(row=>row.id===input.caseId);
  if(!world||!ports.contextId||ports.contextId!==input.contextId)throw new Error("Branch delivery requires the exact owned context");
  const initial=await ports.vcs.status();
  if(initial.contextId!==input.contextId||!initial.clean||initial.integrating.length)throw new Error("Branch delivery requires a clean disposable context");
  const repository=`projects/owned-bridge-${crypto.randomUUID()}`,archive=repository+"-archive";
  const id=crypto.randomUUID(),archiveId=crypto.randomUUID();
  const index:BridgeIndex={scopes:[{id:archiveId,title:world.title,path:archive,purpose:"archive"},
    {id,title:world.title,path:repository,purpose:"delivery"}]};
  const coordinates={id,repository,remote:world.remote??"origin",branch:world.branch,reviewSince:authorizesAfter,specPath,notePath};
  const approvedText=(value:string)=>`Contract: ${value}\n`;
  const releaseText=(value:string)=>`This release changes the delivery contract. ${value}\n`;
  const original=await ports.vcs.edit({contextId:input.contextId,expectedWorkingHead:initial.workingHead,commandId:crypto.randomUUID(),
    intentSummary:"Seed scoped local project and separate archive",
    changes:[{kind:"repository-create",repoPath:repository,files:[
      {path:specPath,content:textContent(approvedText(world.prior)),mode:0o644},
      {path:notePath,content:textContent(releaseText(world.prior)),mode:0o644},
      {path:routePath,content:textContent(JSON.stringify(coordinates)),mode:0o644},
    ]},{
      kind:"repository-create",repoPath:archive,files:[
        {path:routePath,content:textContent(JSON.stringify({...coordinates,id:archiveId,repository:archive})),mode:0o644},
      ]},
    ]});
  const origin=await ports.vcs.commit({contextId:input.contextId,expectedWorkingHead:original.workingHead,commandId:crypto.randomUUID(),
    message:"Retain original semantic delivery files"});
  const retainedRow=seedRetainedBranch(world,repository,archive,origin.event.eventId,input.contextId);
  const raw=retainedRow?JSON.stringify(retainedRow):null;
  const originRepo=await ports.vcs.resolveRepository({state:origin.event,repoPath:repository});
  if(!originRepo)throw new Error("The original owned repository was not retained");
  const repositoryId=originRepo.repositoryId;
  async function nativeFile(state:DeliveryState,path:string) {
    return ports.vcs.readFile({state,repositoryId,file:{kind:"path",path}});
  }
  async function readText(state:DeliveryState,path:string) {
    const file=await nativeFile(state,path);
    if(!file)return {text:null,digest:null};
    if(file.content.kind!=="text"||file.content.text.length>4_000)throw new Error("Expected bounded owned text evidence");
    return {text:file.content.text,digest:file.contentHash};
  }
  let sourceEvent=origin.event;
  if(raw!==null){
    const stored=await ports.vcs.edit({contextId:input.contextId,expectedWorkingHead:origin.event,commandId:crypto.randomUUID(),
      intentSummary:"Retain original branch observation with its provenance",
      changes:[{kind:"file-create",repositoryId,path:evidencePath,content:textContent(raw),mode:0o644}]});
    sourceEvent=(await ports.vcs.commit({contextId:input.contextId,expectedWorkingHead:stored.workingHead,commandId:crypto.randomUUID(),
      message:"Retain owned branch review evidence"})).event;
  }
  const spec=await nativeFile(sourceEvent,specPath),note=await nativeFile(sourceEvent,notePath);
  if(!spec||!note)throw new Error("The two original release files are required");
  const preserveSpec=["contract-unchanged","no-local-difference"].includes(world.files);
  const preserveNote=["note-unchanged","no-local-difference"].includes(world.files);
  const changedNote=world.files==="note-old"?releaseText(world.prior)+"Prepared for local semantic delivery.\n":releaseText(world.target);
  const changes:Parameters<VcsClient["edit"]>[0]["changes"]=[
    ...(!preserveSpec?[{kind:"content-replace" as const,repositoryId,fileId:spec.fileId,content:textContent(approvedText(world.target))}]:[]),
    ...(!preserveNote?[world.files==="missing-note"?{kind:"file-delete" as const,repositoryId,fileId:note.fileId}:
      {kind:"content-replace" as const,repositoryId,fileId:note.fileId,content:textContent(changedNote)}]:[]),
  ];
  let working:DeliveryState=sourceEvent;
  if(changes.length)
    working=(await ports.vcs.edit({contextId:input.contextId,expectedWorkingHead:sourceEvent,commandId:crypto.randomUUID(),
      intentSummary:"Prepare the assigned draft",
      changes})).workingHead;
  if(world.files==="already-committed")
    working=(await ports.vcs.commit({contextId:input.contextId,expectedWorkingHead:working,commandId:crypto.randomUUID(),
      message:"Retain already delivered local file pair"})).event;
  const before=await ports.vcs.status();
  if(!isDeepStrictEqual(before.workingHead,working)||before.mainEventId!==initial.mainEventId)
    throw new Error("Local semantic fixture changed the protected basis");
  const {text:retainedRaw,digest:retainedDigest}=await readText(sourceEvent,evidencePath);
  const scope:DeliveryScope={...coordinates,retained:parseRetainedBranch(retainedRaw),retainedDigest};
  const plan:BridgePlan={id,intent:world.action,handoff:world.handoff===true};
  const git=ports.bindGit({goal:world.goal,repository,direction:"diagnose"});
  const files=[specPath,notePath];
  const fileBindings=new Map(files.map(path=>[path,ports.bindDelivery({goal:world.goal,repository,path})]));
  const operations=new Map([["",git.request.operationId],...Array.from(fileBindings,([path,binding])=>[path,binding.request.operationId] as const)]);
  const granted=new Set<string>();
  const fileReads=new Map<string,Awaited<ReturnType<VcsBinding["services"]["vcsDeliveryRead"]["observe"]>>>();
  let bridgeRead:Awaited<ReturnType<GitBinding["services"]["gitBridgeReviewRead"]["observe"]>>|null=null;
  let seen=false,workingEffect=false;
  let commit:LocalDeliveryReceipt|null=null;
  let handoff:BranchPrivateNote|null=null;
  const scratch=await ports.fs.mkdtemp("branch-delivery");
  const source=`${scratch}/private-delivery-policy.txt`;
  await ports.fs.writeFile(source,"Only keep a private record of the exact release pair and retained branch evidence.");
  const priorScratch=new Set(await listOwnedScratchEntries(ports.fs));
  const handoffWriter=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["What supports the exact local delivery step?"],
    sources:[{id:"policy",path:source}]},ports.readBytes).scratchHandoffWrite;
  async function canCommit(){
    if(world.action!=="commit"||classifyRetainedBranch(scope)!=="aligned"||bridgeRead?.upstream.state!=="local-only")return false;
    const delivery=fileReads.get(specPath),release=fileReads.get(notePath);
    if(!delivery?.file.hasLocalDifference||!release?.file.hasLocalDifference||!delivery.current||!release.current)return false;
    const [contract,summary]=await Promise.all(files.map(path=>readText(before.workingHead,path)));
    return contract.text===approvedText(world.target)&&summary.text===releaseText(world.target);
  }
  const body=(report:BridgeDeliveryReport)=>JSON.stringify({visibility:"private-local",repository,branch:scope.branch,
    retained:report.scope.retained,retainedDigest,protectedEventId:before.mainEventId,decision:report.decision,
    commit:report.commit,spec:report.spec.snapshot.file,note:report.note.snapshot.file});

  const services={
    branchDeliveryRead:{
      async discover(){return structuredClone(index);},
      async inspect(selected:string){
        if(selected!==id)return null;
        seen=true;return structuredClone(scope);
      },
      async operation(selected:string,path:string){
        if(!seen||selected!==id)return null;
        const operation=operations.get(path);
        if(!operation||granted.has(operation))return null;
        granted.add(operation);return operation;
      },
    },
    gitBridgeReviewRead:{async observe(operationId:string){
      if(!granted.has(operationId)||operationId!==git.request.operationId||bridgeRead)throw new Error("Git review is outside the exact owned selection");
      bridgeRead=await git.services.gitBridgeReviewRead.observe(operationId);
      return structuredClone(bridgeRead);
    }},
    vcsDeliveryRead:{async observe(operationId:string){
      const match=Array.from(fileBindings).find(([,binding])=>binding.request.operationId===operationId);
      if(!granted.has(operationId)||!match||fileReads.has(match[0]))throw new Error("Semantic file is outside the exact owned selection");
      const [path,binding]=match;
      const snapshot=await binding.services.vcsDeliveryRead.observe(operationId);
      fileReads.set(path,snapshot);return structuredClone(snapshot);
    }},
    branchDeliveryWrite:{
      async commit(selected:string,basis:DeliveryState){
        if(!seen||selected!==id||workingEffect||commit||world.action!=="commit"||
          !bridgeRead||fileReads.size!==2||!isDeepStrictEqual(basis,before.workingHead))return null;
        workingEffect=true;
        try{
          const observed=await ports.vcs.status();
          if(!isDeepStrictEqual(observed,before)||!await canCommit())return null;
          const outcome=await ports.vcs.commit({contextId:input.contextId,expectedWorkingHead:basis,commandId:crypto.randomUUID(),
            message:`Commit locally reviewed release pair for ${world.title}`});
          commit={repository,eventId:outcome.event.eventId,from:basis,protectedEventId:before.mainEventId,files};
          return structuredClone(commit);
        }finally{workingEffect=false;}
      },
      async retain(report:BridgeDeliveryReport){
        if(!seen||!world.handoff||workingEffect||handoff||!report||report.handoff!==null||
          !isDeepStrictEqual(report.scope,scope)||!isDeepStrictEqual(report.plan,plan)||
          !isDeepStrictEqual(report.local?.view,bridgeRead)||!isDeepStrictEqual(report.spec?.snapshot,fileReads.get(specPath))||
          !isDeepStrictEqual(report.note?.snapshot,fileReads.get(notePath))||!isDeepStrictEqual(report.commit,commit)||
          report.branch?.status!==world.condition||report.decision?.status!==world.result||(world.result==="commit"&&!commit))return null;
        workingEffect=true;
        try{
          const text=body(report);
          const saved=await handoffWriter.stage(text);
          if(!saved)return null;
          handoff={path:saved.path,digest:sha256HexSyncText(text)};return structuredClone(handoff);
        }finally{workingEffect=false;}
      },
    },
  };

  async function verify(rawReport:unknown) {
    const value=rawReport as BridgeDeliveryReport|null;
    const report=value;
    const after=await ports.vcs.status();
    const committedFiles=await Promise.all(files.map(path=>readText(after.committed,path)));
    const priorFiles=await Promise.all(files.map(path=>readText(before.workingHead,path)));
    const {text:recovered,digest:recoveredDigest}=await readText(sourceEvent,evidencePath);
    const route=await readText(sourceEvent,routePath);
    const candidates=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!priorScratch.has(name));
    const artifact=handoff?new TextDecoder("utf-8",{fatal:true}).decode(await ports.readBytes(handoff.path,retainLimit)):null;
    const branch=report?.branch;
    const decision=report?.decision;
    const expectedCommit=world.result==="commit";
    const originalBridge=await git.services.gitBridgeReviewRead.observe(git.request.operationId);
    const repo=await ports.vcs.resolveRepository({state:before.workingHead,repoPath:repository});
    const protectedRepo=await ports.vcs.resolveRepository({state:event(before.mainEventId),repoPath:repository});
    const reportPlan=report?.plan;
    const checks={
      exactBranchProject:seen&&isDeepStrictEqual(reportPlan,plan)&&isDeepStrictEqual(report?.scope,scope)&&
        route.text!==null&&isDeepStrictEqual(JSON.parse(route.text),coordinates),
      exactLiveLocalBridge:bridgeRead?.upstream.state==="local-only"&&originalBridge.upstream.state==="local-only"&&
        bridgeRead.repository===repository&&bridgeRead.semantic.contextId===input.contextId&&bridgeRead.semantic.current&&
        bridgeRead.semantic.workingRepositoryId===repo?.repositoryId&&!protectedRepo&&bridgeRead.semantic.mainRepositoryId===null&&
        isDeepStrictEqual(report?.local.view,bridgeRead),
      exactSemanticFileChain:files.every((path,i)=>{
        const row=fileReads.get(path);
        return !!row&&row.current&&row.contextId===input.contextId&&row.file.path===path&&
          (row.file.working?.hash??null)===priorFiles[i].digest&&isDeepStrictEqual(row.working,before.workingHead)&&
          isDeepStrictEqual(row.committed,before.committed)&&isDeepStrictEqual(row.protectedMain,event(before.mainEventId))&&
          !row.file.protectedMain&&isDeepStrictEqual((i===0?report?.spec:report?.note)?.snapshot,row);
      }),
      retainedBranchAuthority:raw===recovered&&retainedDigest===recoveredDigest&&isDeepStrictEqual(scope.retained,parseRetainedBranch(recovered))&&
        classifyRetainedBranch(scope)===world.condition&&branch?.status===world.condition&&!!branch.explanation.trim(),
      groundedBranchDecision:decision?.status===world.result&&!!decision.explanation.trim()&&decision.explanation.length<=900,
      exactLocalBranchCommit:expectedCommit?!!commit&&isDeepStrictEqual(report?.commit,commit)&&after.contextId===input.contextId&&
        after.committed.eventId===commit.eventId&&isDeepStrictEqual(after.workingHead,after.committed)&&after.clean&&
        after.committed.eventId!==before.committed.eventId&&committedFiles.every((file,i)=>isDeepStrictEqual(file,priorFiles[i])):
        commit===null&&report?.commit===null&&isDeepStrictEqual(after,before),
      exactPrivateBranchHandoff:world.handoff?!!report&&!!handoff&&!!artifact&&candidates.length===1&&
        handoff.path===`/.tmp/${candidates[0]}/handoff.json`&&artifact===body(report)&&handoff.digest===sha256HexSyncText(artifact)&&
        isDeepStrictEqual(report.handoff,handoff):handoff===null&&report?.handoff===null&&candidates.length===0,
      protectedBranchMain:after.mainEventId===initial.mainEventId&&originalBridge.semantic.mainRepositoryId===null,
      rejectedBranchRetarget:await services.branchDeliveryRead.inspect(archiveId)===null&&
        await services.branchDeliveryRead.operation(id,"wrong.txt")===null&&await services.branchDeliveryWrite.commit(archiveId,working)===null,
    };
    return {caseId:world.id,contextId:input.contextId,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      index,plan,scope,operations:Array.from(operations),bridgeRead,fileReads:Array.from(fileReads),branch,decision,commit,handoff,artifact};
  }

  async function qualify() {
    await services.branchDeliveryRead.discover();
    await services.branchDeliveryRead.inspect(id);
    async function readFile(path:string):Promise<LocalFileReview>{
      const operation=await services.branchDeliveryRead.operation(id,path);
      if(!operation)throw new Error("The scoped file is unavailable");
      const snapshot=await services.vcsDeliveryRead.observe(operation);
      return {snapshot,next:"reviewed",chain:{local:{state:snapshot.clean?"clean":"uncommitted",summary:"Exact working chain."},
        main:{state:snapshot.relation,summary:"Exact protected basis."}},
        review:{effect:"Checked exact file versions.",risks:[],checks:[]}};
    }
    const operation=await services.branchDeliveryRead.operation(id,"");
    if(!operation)throw new Error("The scoped Git bridge is unavailable");
    const local:LocalGitReview={view:await services.gitBridgeReviewRead.observe(operation),next:"configure-upstream",
      upstreamReview:{freshness:"absent",consequence:"No declared upstream for this owned repository."},
      semanticReview:{source:{state:"local-only",explanation:"The scoped repository is present only in the local context."},
        integration:{candidate:null,explanation:"No live Git Bridge candidate is present for this disposable repository."}},
      reason:"The workspace evidence is local only."};
    const spec=await readFile(specPath),note=await readFile(notePath);
    const branch:BranchAssessment={status:classifyRetainedBranch(scope),explanation:"Checked the exact retained route and observation."};
    const decision:BridgeDecision={status:world.result,explanation:"Checked the local contract, note, and exact branch authority."};
    const report:BridgeDeliveryReport={scope,plan,local,spec,note,branch,decision,commit:null,handoff:null};
    if(world.result==="commit")report.commit=await services.branchDeliveryWrite.commit(id,spec.snapshot.working);
    if(world.handoff)report.handoff=await services.branchDeliveryWrite.retain(report);
    return verify(report);
  }
  return {services,verify,qualify};
}
