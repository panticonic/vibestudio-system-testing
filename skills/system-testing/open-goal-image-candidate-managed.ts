import { isDeepStrictEqual } from "node:util";
import { sha256Hex, sha256HexSyncText } from "@vibestudio/content-addressing";
import { contextId, fs, images, rpc, vcs } from "@workspace/runtime";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import type { AgenticEvent } from "@workspace/agentic-protocol";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { Candidate, EvidenceRow, Format, ImageAssessment, ImageHandoff, ImageIndex,
  ImageJournal, ImagePlan, ImageRead, ImageReport, JournalRecord } from "@workspace-skills/open-image-candidate/types";
import { imageFixtureBytes } from "./open-goal-image-fixture-bytes.js";
import { openImageCandidateWorlds, ownedBrief, type ImageSeed } from "./open-goal-image-candidate-worlds.js";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";

type Lane = Awaited<ReturnType<typeof createOwnedHeadlessChannel>>;
const byteLimit = 8192;
const bytesOf = (base64:string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
const suffixes:Record<Format,RegExp> = {png:/\.png$/iu,jpeg:/\.jpe?g$/iu,webp:/\.webp$/iu};
const refused = (candidateId:string):ImageRead => ({candidateId,rowId:null,status:"refused",original:null});

async function appendNative(lane:Lane, owner:string, records:JournalRecord[]) {
  return withOwnedChannelClient(lane, owner, async session => {
    const ids:string[]=[];
    for (const record of records)
      ids.push(await session.send(JSON.stringify(record), {idempotencyKey:crypto.randomUUID()}));
    return ids;
  });
}

export async function readImageNative(lane:Lane, client=rpc):Promise<ImageJournal> {
  const page=await client.call(lane.target,channelClientRpcMethods.getReplayAfter,[{after:0,limit:32}]);
  const through=page.ready.snapshotLastSeq;
  if (through===undefined||page.ready.hasMoreAfter) throw new Error("Image evidence exceeded its retained frontier");
  const rows=page.logEvents.flatMap((envelope):EvidenceRow[]=>{
    const event=envelope.payload as AgenticEvent<"message.completed">|undefined;
    if (event?.kind!=="message.completed"||!("role" in event.payload)||event.payload.role!=="user") return [];
    const text=(event.payload.blocks??[]).flatMap(block=>block.type==="text"?[block.content]:[]).join("");
    if (!event.causality?.messageId||!envelope.senderId||text.length>2048) throw new Error("Invalid retained image record");
    return [{id:event.causality.messageId,seq:envelope.id,record:JSON.parse(text) as JournalRecord}];
  });
  return {channelId:lane.key,through,rows};
}

type Ports={
  contextId:string|null;fs:typeof fs;status:typeof vcs.status;images:Pick<typeof images,"importAsset"|"readAsset"|"release">;
  open:typeof createOwnedHeadlessChannel;append:typeof appendNative;read:typeof readImageNative;
  readBytes(path:string,limit:number):Promise<Uint8Array>;
};
function livePorts():Ports {
  return { contextId,fs,status:input=>vcs.status(input),images,open:createOwnedHeadlessChannel,append:appendNative,
    read:readImageNative,readBytes:(path,max)=>readWorkspaceBytes(rpc,path,max) };
}

type CandidateRow=EvidenceRow&{record:Candidate};
const candidateRow=(row:EvidenceRow):row is CandidateRow=>row.record.kind==="candidate";

export async function prepareOpenImageCandidate(input:{contextId:string;caseId:string},ports=livePorts()) {
  const world=openImageCandidateWorlds.find(entry=>entry.id===input.caseId);
  if(!world||!input.contextId||ports.contextId!==input.contextId) throw new Error("Image candidate context is not owned");
  const owner=input.contextId;
  const before=await ports.status();
  const brief=ownedBrief(world,owner);
  const lane=await ports.open(owner,brief.title);
  const nearbyBriefs=world.seeds.some(seed=>seed.otherBrief)?
    [{...brief,id:"another-market-brief",project:"County market preview"}]:[];
  const index:ImageIndex={channelId:lane.key,owner,briefs:[...nearbyBriefs,brief]};
  const ids=new Map(world.seeds.map((seed,i)=>[seed.label,`candidate-${i+1}-${crypto.randomUUID()}`]));
  const version=(label:string)=>ids.get(label)??"unknown";
  const stagedOwner=`retained-image-${lane.key}`;
  const seeded=new Map<string,JournalRecord>();
  const originalBytes=new Map<string,string>();
  async function save(records:JournalRecord[]) {
    const messages=await ports.append(lane,owner,records);
    if (messages.length!==records.length) throw new Error("Image journal did not persist every record");
    messages.forEach((id,i)=>seeded.set(id,records[i]));
  }

  async function record(seed:ImageSeed,position:number):Promise<Candidate> {
    const format=seed.format??(seed.retry?world.seeds[position].format:undefined)??"png";
    const state=seed.state??"succeeded";
    const candidateId=version(seed.label);
    let assetId:string|null=null;
    let digest:string|null=null;
    if (!seed.foreign&&!seed.otherBrief&&state==="succeeded") {
      const actualFormat=seed.bytes==="wrong-type"?(format==="png"?"webp":"png"):format;
      const base64=imageFixtureBytes[actualFormat][position];
      const asset=await ports.images.importAsset({base64,owner:stagedOwner});
      if(asset.digest!==sha256Hex(bytesOf(base64))||asset.mimeType!==`image/${actualFormat}`||asset.width!==1||asset.height!==1)
        throw new Error("Native import does not match the fixed codec fixture");
      assetId=asset.id;
      originalBytes.set(asset.id,base64);
      digest=seed.bytes==="different"?sha256Hex(bytesOf(imageFixtureBytes[format][3])):asset.digest;
      if(seed.bytes==="missing") await ports.images.release({assetId:asset.id,owner:stagedOwner});
    }
    const receipt=state==="succeeded"&&seed.receipt!==false?`fixture-provider-${candidateId}-${seed.retry?2:1}`:null;
    return {kind:"candidate",owner:seed.foreign?"unassigned-studio":owner,briefId:seed.otherBrief?"another-market-brief":brief.id,
      candidateId,label:seed.label,jobId:`job-${candidateId}`,attempt:seed.retry?2:1,state,assetId,assetDigest:digest,
      providerReceipt:receipt,prompt:brief.intent,revisedPrompt:seed.revised??brief.intent,
      reference:seed.reference===undefined?brief.reference:seed.reference,format,
      outputPath:`projects/image-review/${seed.path??`candidate-${position+1}.${format}`}`,save:seed.save??"applied"};
  }

  const selection=(label:string):JournalRecord=>({kind:"selection",briefId:brief.id,candidateId:version(label),owner});
  const rights=(value:NonNullable<typeof world.rights>):JournalRecord=>({kind:"rights",briefId:brief.id,reference:brief.reference,rights:value,owner});
  const candidates=await Promise.all(world.seeds.map(record));
  await save([rights(world.rights??"local-handoff"),...candidates,selection(world.selected??world.seeds[0].label)]);
  const initial=await ports.read(lane);
  const later:JournalRecord[]=[];
  for(const update of world.late?.receipts??[]) {
    const position=world.seeds.findIndex(seed=>seed.label===update.label);
    if(position<0)throw new Error("Image retry has no initial candidate");
    later.push(await record(update,position));
  }
  if(world.late?.select) later.push(selection(world.late.select));
  if(world.late?.rights) later.push(rights(world.late.rights));
  if(world.late?.delayedPreview) later.push({kind:"preview",briefId:brief.id,owner,
    candidateId:version(world.late.delayedPreview),label:world.late.delayedPreview});

  const work=await ports.fs.mkdtemp("retained-image-review");
  const policyPath=`${work}/policy.md`;
  await ports.fs.writeFile(policyPath,`Review owned brief ${brief.title}. Provider and generation records are fixture evidence. Preserve source images and the workspace; authorized handoffs stay private.`);
  const originalFiles=new Set(await listOwnedScratchEntries(ports.fs));
  const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["Which original retained output supports this private handoff?"],
    sources:[{id:"owned-policy",path:policyPath}]},ports.readBytes).scratchHandoffWrite;
  const snapshots:ImageJournal[]=[];
  const reads:ImageRead[]=[];
  let listed=false;
  let journalBusy=false;
  let readBusy=false;
  let stageBusy=false;
  let handoff:ImageHandoff|null=null;

  const project=(journal:ImageJournal):ImageJournal=>({...journal,rows:journal.rows.filter(({record})=>
    record.briefId===brief.id&&record.owner===owner)});
  const currentCandidate=(journal:ImageJournal,id:string)=>project(journal).rows.filter(candidateRow)
    .findLast(row=>row.record.candidateId===id);
  const currentRights=(journal:ImageJournal)=>project(journal).rows.map(row=>row.record)
    .filter(row=>row.kind==="rights").findLast(row=>row.reference===brief.reference);
  const canInspect=(journal:ImageJournal,row:CandidateRow)=>row.record.state==="succeeded"&&
    row.record.save==="applied"&&!!row.record.providerReceipt&&!!row.record.assetId&&
    row.record.reference===brief.reference&&brief.formats.includes(row.record.format)&&
    suffixes[row.record.format].test(row.record.outputPath)&&
    (!brief.reference||["local-handoff","review-only"].includes(currentRights(journal)?.rights??"unknown"));

  async function inspect(journal:ImageJournal,id:string):Promise<ImageRead> {
    const row=currentCandidate(journal,id);
    if(!row||!row.record.assetId||!canInspect(journal,row))return refused(id);
    let result:Awaited<ReturnType<Ports["images"]["readAsset"]>>;
    try {
      result=await ports.images.readAsset(row.record.assetId);
    } catch(error) {
      if(!/not retained|retained image content .* missing|unknown image asset/iu.test(String(error)))throw error;
      return {candidateId:id,rowId:row.id,status:"missing",original:null};
    }
    const media=bytesOf(result.base64);
    if(media.length>byteLimit)throw new Error("Retained image exceeds its assigned byte bound");
    const {asset}=result;
    const digest=sha256Hex(media);
    const original={id:asset.id,digest,mime:asset.mimeType,width:asset.width,height:asset.height,byteLength:media.length};
    const verified=asset.id===row.record.assetId&&asset.digest===digest&&digest===row.record.assetDigest&&
      media.length===asset.byteLength&&asset.mimeType===`image/${row.record.format}`&&result.base64===originalBytes.get(asset.id);
    return {candidateId:id,rowId:row.id,status:verified?"verified":"mismatch",original};
  }

  const body=(report:ImageReport,read:ImageRead,journal:ImageJournal)=>JSON.stringify({
    scope:"private-local",briefId:brief.id,channelId:lane.key,frontier:journal.through,
    candidateId:read.candidateId,nativeReceipt:read.rowId,original:read.original,
    providerEvidence:"retained-fixture",explanation:report.decision.explanation,
  },null,2);
  const services={
    imageCandidateBriefs:{async list(){listed=true;return structuredClone(index);}},
    imageCandidateJournal:{async read(channelId:string){
      if(!listed||channelId!==lane.key||journalBusy||snapshots.length>=2)return null;
      journalBusy=true;
      try {
        if(snapshots.length===1&&later.length)await save(later);
        const value=project(await ports.read(lane));
        snapshots.push(value);
        return structuredClone(value);
      } finally {journalBusy=false;}
    }},
    imageCandidateOriginal:{async read(briefId:string,id:string){
      if(briefId!==brief.id||snapshots.length!==2||readBusy||reads.length>=4||reads.some(read=>read.candidateId===id))
        return refused(id);
      readBusy=true;
      try {
        const journal=await ports.read(lane);
        if(journal.through!==snapshots[1].through)return refused(id);
        const read=await inspect(journal,id);
        if(read.status!=="refused")reads.push(read);
        return structuredClone(read);
      } finally {readBusy=false;}
    }},
    imageCandidateHandoff:{async stage(report:ImageReport){
      if(!world.note||handoff||stageBusy||report?.plan?.briefId!==brief.id||!report.plan.localHandoff||report.plan.mode!==world.mode||
        report.handoff!==null||report.decision?.action!=="stage"||!report.decision.explanation?.trim()||
        report.decision.explanation.length>600||!isDeepStrictEqual(report.reads,reads)||snapshots.length!==2)return null;
      stageBusy=true;
      try {
        const id=report.decision.candidateId;
        const journal=await ports.read(lane);
        if(!id||journal.through!==snapshots[1].through||(brief.reference&&currentRights(journal)?.rights!=="local-handoff"))
          return null;
        const read=await inspect(journal,id);
        const original=reads.find(value=>value.candidateId===id);
        if(read.status!=="verified"||!read.original||!isDeepStrictEqual(read,original))return null;
        const selected=project(journal).rows.map(row=>row.record).findLast(row=>row.kind==="selection");
        const row=currentCandidate(journal,id);
        if(!row||!report.plan.acceptedFormats.includes(row.record.format)||
          report.plan.mode==="current"&&selected?.candidateId!==id||
          report.plan.mode==="historical"&&row.record.label!==report.plan.historicalLabel)return null;
        const status=await ports.status();
        if(status.mainEventId!==before.mainEventId||!isDeepStrictEqual(status.workingHead,before.workingHead))return null;
        const text=body(report,read,journal);
        const file=await writer.stage(text);
        if(!file)return null;
        handoff={path:file.path,digest:sha256HexSyncText(text),candidateId:id,assetDigest:read.original.digest,frontier:journal.through};
        return structuredClone(handoff);
      } finally {stageBusy=false;}
    }},
  };

  function exactPlan():ImagePlan {
    return {briefId:brief.id,mode:world.mode,historicalLabel:world.historicalLabel??null,
      localHandoff:world.note===true,acceptedFormats:brief.formats};
  }
  function explain(report:ImageReport|undefined) {
    const text=report?.decision?.explanation;
    return typeof text==="string"&&text.length<=600&&
      world.expected.evidence.every(term=>text.toLowerCase().includes(term.toLowerCase()));
  }
  async function verify(raw:unknown) {
    const report=raw as {status?:string;skill?:string;outcome?:ImageReport}|null;
    const outcome=report?.status==="workspace-skill-reviewed"&&report.skill==="imageCandidate"?report.outcome:undefined;
    const latest=await ports.read(lane);
    const goalPlan=exactPlan();
    const expected=world.expected;
    const queue=expected.queue.map(version);
    const selected=expected.label===null?null:version(expected.label);
    const independent=await Promise.all(queue.map(id=>inspect(latest,id)));
    const result=outcome?.decision;
    const winner=independent.find(read=>read.candidateId===selected)??null;
    const status=await ports.status();
    const newFiles=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!originalFiles.has(name));
    const artifact=handoff?new TextDecoder("utf-8",{fatal:true}).decode(await ports.readBytes(handoff.path,byteLimit)):null;
    const idsInScope=new Set(project(latest).rows.filter(candidateRow).map(row=>row.record.candidateId));
    const assessed=outcome?.assessment?.candidates;
    const observed=expected.observations??queue.map(()=>"verified");
    const foreign=crypto.randomUUID();
    const checks={
      exactImageFrontiers:listed&&snapshots.length===2&&isDeepStrictEqual(snapshots[0],project(initial))&&
        isDeepStrictEqual(snapshots[1],project(latest))&&seeded.size===latest.rows.length&&
        latest.rows.every(row=>isDeepStrictEqual(row.record,seeded.get(row.id)))&&new Set(latest.rows.map(row=>row.id)).size===latest.rows.length,
      exactImageBrief:isDeepStrictEqual(outcome?.plan,goalPlan),
      groundedImageAssessment:isDeepStrictEqual(outcome?.assessment?.queue,queue)&&
        Array.isArray(assessed)&&assessed.length===idsInScope.size&&new Set(assessed.map(value=>value.id)).size===assessed.length&&
        assessed.every(value=>idsInScope.has(value.id)&&Array.isArray(value.reasons)&&value.reasons.length>0&&
          value.reasons.every(reason=>typeof reason==="string"&&reason.length>0))&&
        queue.every(id=>assessed.some(value=>value.id===id&&value.eligible)),
      independentlyReadImageOriginals:isDeepStrictEqual(reads,independent)&&isDeepStrictEqual(outcome?.reads,independent)&&
        isDeepStrictEqual(independent.map(read=>read.status),observed),
      groundedImageDecision:result?.action===expected.action&&result.candidateId===selected&&
        (selected===null||winner?.status==="verified")&&explain(outcome),
      verifiedPrivateImageHandoff:expected.action==="stage"?!!winner&&!!outcome&&!!handoff&&!!artifact&&
        newFiles.length===1&&handoff.path===`/.tmp/${newFiles[0]}/handoff.json`&&artifact===body(outcome,winner,latest)&&
        handoff.digest===sha256HexSyncText(artifact)&&isDeepStrictEqual(handoff,outcome.handoff):
        newFiles.length===0&&handoff===null&&outcome?.handoff===null,
      preservedImageWorkspace:status.mainEventId===before.mainEventId&&isDeepStrictEqual(status.workingHead,before.workingHead),
      rejectedForeignImage:await services.imageCandidateJournal.read(foreign)===null&&
        (await services.imageCandidateOriginal.read(foreign,foreign)).status==="refused"&&
        (await services.imageCandidateOriginal.read(brief.id,foreign)).status==="refused"&&
        await services.imageCandidateHandoff.stage({plan:{briefId:foreign}} as ImageReport)===null,
    };
    return {contextId:owner,goal:world.goal,caseId:world.id,checks,passed:Object.values(checks).every(Boolean),
      index,snapshots,reads:independent,plan:goalPlan,decision:result??null,handoff,artifact,
      candidateId:selected,queue};
  }

  async function qualify() {
    await services.imageCandidateBriefs.list();
    await services.imageCandidateJournal.read(lane.key);
    await services.imageCandidateJournal.read(lane.key);
    const queue=world.expected.queue.map(version);
    const candidates=world.seeds.filter(seed=>!seed.foreign&&!seed.otherBrief).map(seed=>({
      id:version(seed.label),reasons:[world.expected.code],eligible:queue.includes(version(seed.label)),
    }));
    const assessment:ImageAssessment={queue,candidates};
    const captured=[];
    for(const id of queue)captured.push(await services.imageCandidateOriginal.read(brief.id,id));
    const outcome:ImageReport={plan:exactPlan(),assessment,reads:captured,
      decision:{action:world.expected.action,candidateId:world.expected.label?version(world.expected.label):null,
        explanation:world.expected.evidence.join(" / ")},handoff:null};
    if(outcome.decision.action==="stage")outcome.handoff=await services.imageCandidateHandoff.stage(outcome);
    return verify({status:"workspace-skill-reviewed",skill:"imageCandidate",outcome});
  }
  return {services,verify,qualify};
}
