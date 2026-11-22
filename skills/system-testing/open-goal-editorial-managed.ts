import { isDeepStrictEqual } from "node:util";
import { sha256Hex, sha256HexSyncText, stableSha256Hex } from "@vibestudio/content-addressing";
import { contextId, extensions, fs, rpc, vcs } from "@workspace/runtime";
import { createPdfIntakeBindings } from "@workspace-skills/pdf-intake-bindings";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { PacketAttachment, PacketCitation, PacketDecision, PacketDocument, PacketEvidence, PacketMission, PacketPdf,
  PacketPlan, PacketReadRequest, PacketReceipt, PacketReport, PacketSnapshot, PacketSource, PacketSourcePlan,
  PacketWrite } from "@workspace-skills/open-editorial-packet/types";
import { packetFromStreams } from "./pdf-intake-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { openEditorialWorlds } from "./open-goal-editorial-worlds.js";
import { serializeSystemTestError } from "./structured-error.js";

type Vcs=Pick<typeof vcs,"status"|"edit"|"resolveRepository"|"readFile">;
type Head=Awaited<ReturnType<Vcs["status"]>>["workingHead"];
type Engine=Parameters<typeof createPdfIntakeBindings>[0];
type Binding=ReturnType<typeof createPdfIntakeBindings>;
type Mission={read():Promise<PacketMission>;list():Promise<PacketMission[]>;update(description:string):Promise<PacketMission>};
type Ports={contextId:string|null;fs:typeof fs;vcs:Vcs;readBytes(path:string,max:number):Promise<Uint8Array>;pdf:Engine};
type Installed=(owner:string,title:string,description:string)=>Promise<Mission>;
const extension="@workspace-extensions/pdf-ingest";
function livePorts():Ports {
  return {contextId,fs,vcs,readBytes:(path,max)=>readWorkspaceBytes(rpc,path,max),pdf:{
    probe:async(data,options)=>await extensions.invoke(extension,"probe",[data,options]) as Awaited<ReturnType<Engine["probe"]>>,
    ingest:async(data,options)=>await extensions.invoke(extension,"ingest",[data,options]) as Awaited<ReturnType<Engine["ingest"]>>,
  }};
}
const byteLimit=16*1024;
const maxDocument=32*1024;
const normalize=(value:string)=>value.replace(/\s+/gu," ").trim();
const unavailable:PacketEvidence={status:"unavailable",document:null,source:null,citations:[]};
const unavailableWrite:PacketWrite={status:"unavailable",version:null};
function managedPacket(sheets:string[][]) {
  const escaped=(text:string)=>text.replace(/[\\()]/gu,"\\$&");
  return packetFromStreams(sheets.map(lines=>`BT /F1 12 Tf 24 170 Td 20 TL ${lines.map(line=>`(${escaped(line)}) Tj T*`).join(" ")} ET\n`));
}

export async function prepareOpenEditorial(input:{contextId:string;caseId:string},openStore:Installed,ports=livePorts()) {
  const world=openEditorialWorlds.find(entry=>entry.id===input.caseId);
  if(!world||!input.contextId||input.contextId!==ports.contextId)throw new Error("Editorial case needs its owned Personal context");
  const owner=input.contextId;
  const originalHead=await ports.vcs.status({contextId:owner});
  const repoPath=`projects/private-editorial-${crypto.randomUUID()}`;
  const candidatePath="candidate.md";
  const previewPath="retained-preview.md";
  const protectedPath="editor-notes.md";
  const labels=world.fields.map(field=>field.label);
  const pageScope=world.topology==="split-pages"?[1,2]:world.topology==="missing-page"?[2]:[1];
  const noteMode=world.note;
  const stageExpected=noteMode==="diagnostic"||noteMode==="ready-only"&&["ready","already-current"].includes(world.end);
  const initialName=world.topology==="no-approval"?null:"approved-proof.pdf";
  const refreshedName="replacement-proof.pdf";
  function description(name:string|null) {
    return `Local candidate: ${candidatePath}. Requested fields: ${labels.join(", ")}. ${name?
      `Approved attachment: ${name}. Approved pages: ${pageScope.join(", ")}.`:
      "No current PDF source approval."} Preserve unrelated text. This grants no public publishing authority.`;
  }
  const mission=await openStore(owner,`${world.title} editorial review`,description(initialName));
  const cards=async()=> (await mission.list()).map(({id,title,revision,description,status})=>({id,title,revision,description,status}));
  const currentMission=async()=> {
    const {id,title,revision,description,status}=await mission.read();
    return {id,title,revision,description,status};
  };
  const firstMission=await currentMission();
  const plan:PacketPlan={missionId:firstMission.id,operation:world.operation??"revise",fields:labels,note:noteMode};
  const grant=(card:PacketMission)=>card.description.match(/Approved attachment: ([a-z-]+\.pdf)\./u)?.[1]??null;
  const header=`# ${world.title}\n\nLocal release candidate for editorial review.\n\n## Public copy\n`;
  const footer="\n## Editor context\nKeep this accessibility and attribution paragraph unchanged.\n";
  const fieldLine=(label:string,value:string)=>`- ${label}: ${value}\n`;
  const initial=header+world.fields.map(field=>field.before===null?"":fieldLine(field.label,field.before)).join("")+footer;
  const previewText=world.preview??`Retained visual proof only. Earlier wording: ${world.fields.map(field=>field.before??"not present").join("; ")}.\n`;
  const protectedCopy="Local copy notes. Do not move, edit or release this file.\n";
  const created=await ports.vcs.edit({
    contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:originalHead.workingHead,
    changes:[{kind:"repository-create",repoPath,files:[[candidatePath,initial],[previewPath,previewText],[protectedPath,protectedCopy]]
      .map(([path,text])=>({path,content:{kind:"text" as const,text},mode:0o644}))}],
  });
  const repository=await ports.vcs.resolveRepository({state:created.workingHead,repoPath});
  if(!repository||repository.repoPath!==repoPath)throw new Error("The local editorial repository is absent");
  const repositoryId=repository.repositoryId;
  async function file(head:Head,path:string) {
    const result=await ports.vcs.readFile({state:head,repositoryId,file:{kind:"path",path}});
    if(!result||result.content.kind!=="text")throw new Error(`The original workspace file ${path} is missing`);
    const {fileId}=result;
    const {text}=result.content;
    return {fileId,doc:{path,version:stableSha256Hex({head,fileId,text}),text}};
  }
  const work=await ports.fs.mkdtemp("editorial-attachments");
  const policyPath=`${work}/scope.md`;
  await ports.fs.writeFile(policyPath,"Only the assigned current Mission Control card and local approved original may authorize draft edits.");
  const seeds=new Map<string,{path:string;packet:string;sheets:string[][]}>();
  async function createAttachment(name:string,sheets:string[][]) {
    const path=`${work}/${name}`;
    const packet=managedPacket(sheets);
    await ports.fs.writeFile(path,packet);
    seeds.set(name,{path,packet,sheets});
  }
  const evidenceLine=(value:(typeof world.fields)[number])=>`${value.label}: ${value.after??"Remove this line from the candidate"}`;
  const approvedLines=world.fields.map(evidenceLine);
  const pages=world.topology==="split-pages"?approvedLines.map(line=>[line]):world.topology==="partial-evidence"?
    [[approvedLines[0],"The other statement is awaiting sign-off."]]:[approvedLines];
  await createAttachment("retained-proof.pdf",[world.fields.map(entry=>`${entry.label}: ${entry.before??"Earlier draft lacked this line"}`)]);
  if(initialName)await createAttachment(initialName,pages);
  const originalFiles=new Set(await listOwnedScratchEntries(ports.fs));
  const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["Which original evidence supports the current local publication candidate?"],
    sources:[{id:"editorial-scope",path:policyPath}]},ports.readBytes).scratchHandoffWrite;

  async function bytes(name:string) {
    const seed=seeds.get(name);
    if(!seed)throw new Error("Unassigned attachment");
    const data=await ports.readBytes(seed.path,maxDocument);
    if(sha256Hex(data)!==sha256HexSyncText(seed.packet))throw new Error("Original attachment bytes changed");
    return data;
  }
  const status=()=>ports.vcs.status({contextId:owner});
  const snapshots:PacketSnapshot[]=[];
  const heads=new Map<string,Head>();
  let listed:PacketMission[]|null=null;
  let raceObserved=false;
  let committedWrite=false;
  let busy=false;
  let savedRead:PacketDocument|null=null;
  let receipt:PacketReceipt|null=null;
  const attempts:{proposal:PacketDocument;result:PacketWrite}[]=[];
  const sources:PacketSource[]=[];
  let active:{binding:Binding;data:Uint8Array;digest:string;selected:PacketSource} | null=null;
  const firstDoc=(await file(created.workingHead,candidatePath)).doc;
  async function readSnapshot():Promise<PacketSnapshot> {
    const view=await status();
    const card=await currentMission();
    const candidate=(await file(view.workingHead,candidatePath)).doc;
    const preview=(await file(view.workingHead,previewPath)).doc;
    const attachments:PacketAttachment[]=[];
    for(const [name,seed] of seeds) {
      attachments.push({name,digest:sha256Hex(await bytes(name)),pages:seed.sheets.length,
        approval:name===grant(card)?"approved":"retained"});
    }
    heads.set(candidate.version,view.workingHead);
    return {mission:card,candidate,preview,attachments,permittedFields:grant(card)?labels:[]};
  }

  async function editText(head:Head,path:string,text:string) {
    const old=await file(head,path);
    return ports.vcs.edit({contextId:owner,expectedWorkingHead:head,commandId:crypto.randomUUID(),
      changes:[{kind:"text-edit",repositoryId,fileId:old.fileId,edits:[{start:0,end:old.doc.text.length,text}]}]});
  }
  function corrected(text:string) {
    for(const field of world.fields) {
      const prior=field.before===null?null:fieldLine(field.label,field.before);
      const replacement=field.after===null?"":fieldLine(field.label,field.after);
      if(prior===null)text=text.replace(footer,replacement+footer);
      else text=text.replace(prior,replacement);
    }
    return text;
  }
  const otherAddition="\nA co-editor added the rehearsal location to this draft.\n";
  const sameFieldMarker="Needs editor confirmation";
  function coedited() {
    switch(world.race) {
      case "already-done": return corrected(initial);
      case "same-field": {
        const first=world.fields[0];
        return initial.replace(fieldLine(first.label,first.before!),fieldLine(first.label,sameFieldMarker));
      }
      default: return initial+otherAddition;
    }
  }
  async function injectRace(head:Head) {
    if(!world.race||raceObserved)return;
    const raced=await editText(head,candidatePath,coedited());
    if(!raced.changeIds.length)throw new Error("The real semantic co-edit stayed unchanged");
    raceObserved=true;
    if(world.race==="revoked")await mission.update(description(null));
    if(world.race==="source-replaced") {
      await createAttachment(refreshedName,[[`${world.fields[0].label}: Await a renewed editorial value`]]);
      await mission.update(description(refreshedName));
    }
  }

  async function directLines(data:Uint8Array,pages:number[]) {
    const result=await ports.pdf.ingest(data,{pages,preserveLayout:true,engine:"pdfjs",ocrFallback:false,pageImages:"never"});
    if(result.document.digest!==sha256Hex(data))throw new Error("Native PDF intake returned a different original");
    return result.pages.flatMap(page=>page.lines.map((line,index)=>({
      page:page.pageNumber,line:index,quote:line.text,bounds:[...line.bbox],source:line.source,confidence:line.confidence,
    } satisfies PacketCitation)));
  }
  function evidenceVersion(name:string,digest:string,citations:PacketCitation[]) {
    return {path:name,version:digest,text:citations.map(cite=>cite.quote).join("\n")};
  }
  const body=(report:PacketReport)=>JSON.stringify({scope:"private-local",mission:report.current.mission,candidate:report.edit.stored,
    sources:report.sources.map(source=>source.evidence),decision:report.decision},null,2);
  const noSource=():PacketSource=>({selection:null,request:null,pdf:null,evidence:null});

  const services={
    editorialMission:{async list(){listed=await cards();return structuredClone(listed);}},
    editorialWorkspace:{async read(id:string){
      if(!listed||id!==firstMission.id)return null;
      if(snapshots.length>=2||snapshots.length===1&&!raceObserved)return structuredClone(snapshots.at(-1)!);
      if(busy)return null;
      busy=true;
      try {
        const view=await readSnapshot();
        snapshots.push(view);
        active=null;
        sources.push(noSource());
        return structuredClone(view);
      } finally {busy=false;}
    }},
    editorialPdf:{
      async bind(snapshot:PacketSnapshot,inputPlan:PacketPlan,selection:PacketSourcePlan){
        const live=snapshots.at(-1);
        const record=sources.at(-1);
        const name=live&&grant(live.mission);
        if(!live||!record||!name||!isDeepStrictEqual(live,snapshot)||!isDeepStrictEqual(inputPlan,plan)||
          name!==selection?.attachment||!isDeepStrictEqual(selection.pages,pageScope)||selection.query!==labels.join(", "))
          return null;
        if(!isDeepStrictEqual(live,await readSnapshot()))return null;
        if(active)return isDeepStrictEqual(record.selection,selection) && record.request ? structuredClone(record.request) : null;
        const data=await bytes(name);
        const request:PacketReadRequest={goal:world.goal,document:name,pages:[...pageScope],batchSize:2,purpose:"text",
          allowOcr:false,query:selection.query};
        record.selection=structuredClone(selection);
        record.request=request;
        active={binding:createPdfIntakeBindings(ports.pdf,request,data),data,digest:sha256Hex(data),selected:record};
        return structuredClone(request);
      },
      async attest(report:PacketPdf){
        if(!active||report?.digest!==active.digest||!Array.isArray(report.citations))return unavailable;
        if(active.selected.pdf)return isDeepStrictEqual(active.selected.pdf,report) ? structuredClone(active.selected.evidence) : unavailable;
        const {selected,data}=active;
        if(!selected.request)throw new Error("Missing exact attachment binding");
        const scope=selected.request.pages;
        if(!Array.isArray(report.readPages)||report.readPages.some(page=>!scope.includes(page)))return unavailable;
        const native=report.readPages.length?await directLines(data,report.readPages):[];
        if(report.citations.some(cite=>!native.some(line=>isDeepStrictEqual(line,cite))))return unavailable;
        const selectedLabels=new Set(report.citations.map(cite=>labels.find(label=>normalize(cite.quote).startsWith(label+": "))));
        if(selectedLabels.has(undefined)||selectedLabels.size!==report.citations.length)return unavailable;
        const grounded=report.status==="verified"&&selectedLabels.size===labels.length&&
          isDeepStrictEqual(report.readPages,scope)&&report.remaining.length===0&&report.unanswered.length===0;
        const evidence:PacketEvidence=grounded?{status:"grounded",source:selected.request.document,citations:report.citations,
          document:evidenceVersion(selected.request.document,report.digest,report.citations)}:
          {status:"unavailable",source:selected.request.document,citations:report.citations,document:null};
        selected.pdf=structuredClone(report);
        selected.evidence=structuredClone(evidence);
        return structuredClone(evidence);
      },
    },
    pdfIntakeProbe:{probe(document:string){
      if(!active)throw new Error("No approved editorial PDF was bound");
      return active.binding.pdfIntakeProbe.probe(document);
    }},
    pdfIntakeRead:{read(document:string,pages:number[],mode:Parameters<Binding["pdfIntakeRead"]["read"]>[2]){
      if(!active)throw new Error("No approved editorial PDF was bound");
      return active.binding.pdfIntakeRead.read(document,pages,mode);
    }},
    editorialRevision:{
      async apply(id:string,proposal:PacketDocument):Promise<PacketWrite>{
        const snapshot=snapshots.at(-1);
        const entry=sources.at(-1);
        if(!snapshot||busy||committedWrite||plan.operation!=="revise"||id!==firstMission.id||
          proposal?.path!==candidatePath||proposal.version!==snapshot.candidate.version||!entry?.evidence||
          entry.evidence.status!=="grounded"||!isDeepStrictEqual(entry.evidence.citations.map(cite=>cite.quote),approvedLines)||
          proposal.text!==corrected(snapshot.candidate.text)||proposal.text===snapshot.candidate.text||
          world.race==="same-field"&&raceObserved)return unavailableWrite;
        const head=heads.get(proposal.version);
        if(!head)return unavailableWrite;
        busy=true;
        try {
          await injectRace(head);
          try {
            const saved=await editText(head,candidatePath,proposal.text);
            if(!saved.changeIds.length)throw new Error("The expected editorial change was not stored");
            const doc=(await file(saved.workingHead,candidatePath)).doc;
            if(doc.text!==proposal.text)throw new Error("Stored editorial source is different");
            committedWrite=true;
            const result:PacketWrite={status:"written",version:doc.version};
            attempts.push({proposal:structuredClone(proposal),result});
            return structuredClone(result);
          } catch(error) {
            if(isDeepStrictEqual((await status()).workingHead,head)||serializeSystemTestError(error).code!=="RevisionChanged")throw error;
            const result:PacketWrite={status:"changed",version:null};
            attempts.push({proposal:structuredClone(proposal),result});
            return structuredClone(result);
          }
        } finally {busy=false;}
      },
      async read(id:string){
        if(id!==firstMission.id||!snapshots.length||busy)return null;
        savedRead=(await file((await status()).workingHead,candidatePath)).doc;
        return structuredClone(savedRead);
      },
    },
    editorialHandoff:{async stage(report:PacketReport){
      if(!stageExpected||receipt||busy||!savedRead||!report?.decision?.write||!report.decision.explanation?.trim()||
        report.decision.explanation.length>650||report.note!==null||report.decision.status!==world.end||
        !isDeepStrictEqual(report.plan,plan)||!isDeepStrictEqual(report.opening,snapshots[0])||
        !isDeepStrictEqual(report.current,snapshots.at(-1))||!isDeepStrictEqual(report.sources,sources)||
        !isDeepStrictEqual(report.edit.stored,savedRead)||!isDeepStrictEqual(report.edit.attempts,attempts.map(item=>item.result)))return null;
      busy=true;
      try {
        const view=await status();
        const latest=(await file(view.workingHead,candidatePath)).doc;
        if(!isDeepStrictEqual(latest,savedRead)||!isDeepStrictEqual(await currentMission(),report.current.mission))return null;
        const text=body(report);
        if(new TextEncoder().encode(text).length>byteLimit)return null;
        const result=await writer.stage(text);
        if(!result)return null;
        receipt={path:result.path,digest:sha256HexSyncText(text),candidateVersion:latest.version,missionRevision:report.current.mission.revision};
        return structuredClone(receipt);
      } finally {busy=false;}
    }},
  };

  async function verify(raw:unknown) {
    const wrapper=raw as {status?:string;skill?:string;outcome?:PacketReport}|null;
    const report=wrapper?.status==="workspace-skill-reviewed"&&wrapper.skill==="editorialPacket"?wrapper.outcome:undefined;
    const view=await status();
    const stored=(await file(view.workingHead,candidatePath)).doc;
    const proofSources=[];
    for(const [i,source] of sources.entries()) {
      const name=source.request?.document;
      if(!name) {
        proofSources.push(isDeepStrictEqual(source,noSource())&&!grant(snapshots[i].mission));
        continue;
      }
      const data=await bytes(name);
      const seed=seeds.get(name)!;
      const present=pageScope.filter(page=>page<=seed.sheets.length);
      const native=present.length?await directLines(data,present):[];
      const actualWords=seed.sheets.flatMap((sheet,index)=>present.includes(index+1)?sheet.filter(line=>labels.some(label=>line.startsWith(label+": "))):[]);
      const allFound=present.length===pageScope.length&&actualWords.length===labels.length;
      const wanted=present.length!==pageScope.length?"missing-pages":allFound?"verified":"partial-match";
      const citations=source.pdf?.citations??[];
      proofSources.push(source.selection?.attachment===name&&source.request?.allowOcr===false&&source.request?.query===labels.join(", ")&&name===grant(snapshots[i].mission)&&
        source.pdf?.digest===sha256Hex(data)&&source.pdf?.status===wanted&&
        isDeepStrictEqual(citations.map(cite=>cite.quote),actualWords)&&
        citations.every(cite=>native.some(line=>isDeepStrictEqual(line,cite)))&&
        source.evidence?.status===(allFound?"grounded":"unavailable"));
    }
    const changed=world.end==="ready"?(world.race==="unrelated-edit"?corrected(initial)+otherAddition:corrected(initial)):
      world.race?coedited():initial;
    const proposedText=world.operation==="review"||world.topology==="no-approval"||world.topology==="missing-page"||world.topology==="partial-evidence"?
      null:corrected(initial);
    const revised=world.race==="unrelated-edit"?corrected(initial)+otherAddition:world.race==="already-done"?corrected(initial):null;
    const writtenAttempts=attempts.filter(item=>item.result.status==="written");
    const v=report?.decision;
    const files=(await listOwnedScratchEntries(ports.fs)).filter(path=>path.startsWith("evidence-handoff-")&&!originalFiles.has(path));
    const artifact=receipt?new TextDecoder("utf-8",{fatal:true}).decode(await ports.readBytes(receipt.path,byteLimit)):null;
    const foreign=crypto.randomUUID();
    const checks={
      exactOwnedEditorialMission:!!listed&&listed[0]?.id===firstMission.id&&listed[1]?.id!==firstMission.id&&
        isDeepStrictEqual(report?.plan,plan)&&isDeepStrictEqual(snapshots.at(-1)?.mission,await currentMission()),
      exactEditorialFrontiers:snapshots.length===(world.race?2:1)&&isDeepStrictEqual(snapshots[0]?.candidate,firstDoc)&&
        isDeepStrictEqual(report?.opening,snapshots[0])&&isDeepStrictEqual(report?.current,snapshots.at(-1))&&
        (!world.race||snapshots[1]?.candidate.text===coedited()),
      exactApprovedPdfEvidence:proofSources.length===snapshots.length&&proofSources.every(Boolean)&&isDeepStrictEqual(report?.sources,sources),
      minimalEditorialProposal:proposedText===null?report?.edit?.proposed===null:report?.edit?.proposed?.text===proposedText&&
        report.edit.proposed.path===candidatePath&&report.edit.proposed.version===firstDoc.version,
      preservedCoeditorBoundary:raceObserved===Boolean(world.race)&&report?.edit?.revised===revised&&
        (world.end==="ready"?writtenAttempts.some(item=>item.proposal.version===snapshots.at(-1)?.candidate.version):writtenAttempts.length===0),
      verifiedEditorialReadback:stored.text===changed&&isDeepStrictEqual(stored,savedRead)&&isDeepStrictEqual(stored,report?.edit?.stored)&&
        isDeepStrictEqual(report.edit.attempts,attempts.map(item=>item.result)),
      groundedEditorialDisposition:v?.status===world.end&&v.write===stageExpected&&typeof v.explanation==="string"&&
        v.explanation.length<=650&&world.terms.every(term=>v.explanation.toLowerCase().includes(term.toLowerCase())),
      verifiedPrivateEditorialNote:stageExpected?!!report&&!!receipt&&!!artifact&&files.length===1&&
        receipt.path===`/.tmp/${files[0]}/handoff.json`&&receipt.candidateVersion===stored.version&&
        artifact===body(report)&&receipt.digest===sha256HexSyncText(artifact)&&isDeepStrictEqual(receipt,report.note):
        receipt===null&&files.length===0&&report?.note===null,
      protectedEditorialSources:(await file(view.workingHead,previewPath)).doc.text===previewText&&
        (await file(view.workingHead,protectedPath)).doc.text===protectedCopy&&view.mainEventId===originalHead.mainEventId&&
        isDeepStrictEqual(view.committed,originalHead.committed),
      rejectedEditorialRetarget:await services.editorialWorkspace.read(foreign)===null&&
        (await services.editorialRevision.apply(foreign,firstDoc)).status==="unavailable"&&
        await services.editorialHandoff.stage({decision:{write:true}} as PacketReport)===null,
    };
    return {contextId:owner,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      listed,snapshots,plan,sources,attempts,stored,edit:report?.edit??null,decision:v??null,note:receipt,artifact};
  }

  async function qualify() {
    await services.editorialMission.list();
    const opening=await services.editorialWorkspace.read(firstMission.id);
    if(!opening)throw new Error("Missing native editorial assignment");
    let current=opening;
    async function inspect(snapshot:PacketSnapshot) {
      const name=grant(snapshot.mission);
      if(!name)return;
      const bound=await services.editorialPdf.bind(snapshot,plan,{attachment:name,pages:pageScope,query:labels.join(", ")});
      if(!bound)throw new Error("Approved editorial reference could not bind its PDF");
      const probe=await services.pdfIntakeProbe.probe(name);
      const present=bound.pages.every(page=>page<=probe.pageCount);
      const read=present?await services.pdfIntakeRead.read(name,bound.pages,"embedded"):null;
      const citations=(read?.pages??[]).flatMap(page=>page.lines.flatMap((line,index)=>
        labels.some(label=>normalize(line.text).startsWith(label+": "))?[{page:page.number,line:index,quote:line.text,
          bounds:line.bounds,source:line.source,confidence:line.confidence}]:[]));
      const unanswered=labels.filter(label=>!citations.some(cite=>cite.quote.startsWith(label+": ")));
      await services.editorialPdf.attest({digest:probe.digest,status:!present?"missing-pages":unanswered.length?"partial-match":"verified",
        readPages:present?bound.pages:[],remaining:present?[]:bound.pages,citations,unanswered});
    }
    await inspect(opening);
    const proposed=plan.operation==="revise"&&sources[0].evidence?.status==="grounded"?
      {...opening.candidate,text:corrected(opening.candidate.text)}:null;
    let revised:string|null=null;
    if(proposed&&proposed.text!==opening.candidate.text) {
      const first=await services.editorialRevision.apply(firstMission.id,proposed);
      if(first.status==="changed") {
        const refreshed=await services.editorialWorkspace.read(firstMission.id);
        if(!refreshed)throw new Error("Missing current native editorial revision");
        current=refreshed;
        await inspect(current);
        if(world.race==="unrelated-edit"||world.race==="already-done") {
          revised=world.race==="already-done"?current.candidate.text:corrected(current.candidate.text);
          if(revised!==current.candidate.text)await services.editorialRevision.apply(firstMission.id,{...current.candidate,text:revised});
        }
      }
    }
    const stored=await services.editorialRevision.read(firstMission.id);
    if(!stored)throw new Error("Missing final editorial readback");
    const decision:PacketDecision={status:world.end,write:stageExpected,explanation:world.terms.join(" / ")};
    const report:PacketReport={plan,opening,current,sources,decision,note:null,edit:{stored,proposed,revised,attempts:attempts.map(item=>item.result)}};
    if(stageExpected)report.note=await services.editorialHandoff.stage(report);
    return verify({status:"workspace-skill-reviewed",skill:"editorialPacket",outcome:report});
  }
  return {services,verify,qualify};
}
