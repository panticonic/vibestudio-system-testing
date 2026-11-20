import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import type { AgenticEvent } from "@workspace/agentic-protocol";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { BriefingEvidence, BriefingWitness, Cadence, Edition, NewsEvidenceArtifact, NewsEvidenceIndex, NewsEvidencePlan,
  NewsEvidenceReport, NewsEvidenceRow, NewsEvidenceSnapshot, NewsRecord, NewsScope, ReaderBoundary, ReaderEvidence, ReaderSelection,
  ReaderWitness, Review, ScheduleEvidence, ScheduleWitness, SourceReadback, SourceRecord } from "@workspace-skills/open-news-evidence/types";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { openNewsEvidenceWorlds, type OpenNewsEvidenceWorld } from "./open-goal-news-evidence-worlds.js";

type Lane = Awaited<ReturnType<typeof createOwnedHeadlessChannel>>;
type ReaderCall = (method:"getOverview"|"news_list_articles"|"searchArchive",args:Record<string,unknown>) =>
  Promise<{id:string;channelId:string;participantId:string;value:unknown}>;
type Installed = {
  canonicalizeUrl(url:string):string;
  articleId(url:string):Promise<string>;
  capture(assigned:{channelId:string;participantId:string},call:ReaderCall,goal:string,
    view:Extract<ReaderSelection,{kind:"archive"}>|{kind:"saved"|"inbox"|"backlog";cursors:(string|null)[]}):Promise<ReaderEvidence>;
};
const byteCount=(text:string)=>new TextEncoder().encode(text).length;
const max=16*1024;
const found = (status:Review["status"],code:string,...evidenceIds:string[]):Review => ({status,findings:[{code,evidenceIds}]});

async function appendNative(lane:Lane,context:string,records:NewsRecord[]) {
  return withOwnedChannelClient(lane,context,async session=>{
    const ids:string[]=[];
    for (const record of records) ids.push(await session.send(JSON.stringify(record),{idempotencyKey:crypto.randomUUID()}));
    return ids;
  });
}
export async function readNewsNative(lane:Lane,client=rpc):Promise<NewsEvidenceSnapshot> {
  const page=await client.call(lane.target,channelClientRpcMethods.getReplayAfter,[{after:0,limit:40}]);
  const through=page.ready.snapshotLastSeq;
  if (through===undefined||page.ready.hasMoreAfter) throw new Error("News evidence exceeded its retained frontier");
  const rows=page.logEvents.flatMap((envelope):NewsEvidenceRow[]=>{
    const event=envelope.payload as AgenticEvent<"message.completed">|undefined;
    if (event?.kind!=="message.completed"||!("role" in event.payload)||event.payload.role!=="user"||!event.causality?.messageId) return [];
    const text=(event.payload.blocks??[]).flatMap(block=>block.type==="text"?[block.content]:[]).join("");
    if (!envelope.senderId||byteCount(text)>3072) throw new Error("Invalid retained article evidence");
    return [{messageId:event.causality.messageId,envelopeId:envelope.messageId,seq:envelope.id,record:JSON.parse(text) as NewsRecord}];
  });
  return {channelId:lane.key,through,rows};
}
type Ports={contextId:string|null;fs:typeof fs;status:typeof vcs.status;open:typeof createOwnedHeadlessChannel;
  append:typeof appendNative;read:typeof readNewsNative;put(text:string):Promise<string>;get(digest:string):Promise<string|null>;
  readBytes(path:string,limit:number):Promise<Uint8Array>};
function livePorts():Ports {
  return {contextId,fs,status:input=>vcs.status(input),open:createOwnedHeadlessChannel,append:appendNative,read:readNewsNative,
    put:async text=>(await rpc.call("main",mainRpcMethods["blobstore.putText"],[text])).digest,
    get:digest=>rpc.call("main",mainRpcMethods["blobstore.getText"],[digest]),
    readBytes:(path,maximum)=>readWorkspaceBytes(rpc,path,maximum)};
}
type Row<T extends NewsRecord>=NewsEvidenceRow&{record:T};
function of<T extends NewsRecord>(snapshot:NewsEvidenceSnapshot,kind:T["kind"]):Row<T>[] {
  return snapshot.rows.filter((row):row is Row<T>=>row.record.kind===kind);
}
function authority(scope:NewsScope,snapshot:NewsEvidenceSnapshot):ReaderBoundary {
  const row=of<Extract<NewsRecord,{kind:"reader-state"}>>(snapshot,"reader-state").at(-1);
  const message=row?.messageId??null;
  if (scope.requestedReader!==scope.reader||row&&(row.record.reader!==scope.reader||row.record.contextId!==scope.contextId))
    return {message,reason:"foreign-reader"};
  if (!row) return {message,reason:"reader-unobserved"};
  if (row.record.generation!==scope.generation) return {message,reason:"stale-reader"};
  return {message,reason:row.record.allowed?"verified-reader":"reader-revoked"};
}
function reviewReader(input:ReaderEvidence):Review {
  const {view,overview,pages}=input;
  if (overview.setup==="needs-user-preferences") return found("waiting","preferences-needed",overview.id);
  if ((view==="inbox"||view==="backlog")&&overview.untriagedCount>0&&!pages.some(page=>page.articleIds.length))
    return found("waiting","triage-pending",overview.id);
  if (overview.enabledFeeds>0&&overview.failedFeeds===overview.enabledFeeds&&view==="inbox"&&!pages.at(-1)?.articleIds.length)
    return found("attention","enabled-feeds-failing",overview.id);
  const populated=pages.some(page=>page.articleIds.length||page.briefingIds?.length);
  return found("ready",populated?"loaded-to-end":"empty-loaded-view",...pages.map(page=>page.id));
}
function reviewCadence(input:ScheduleEvidence):Review {
  const {owner,poll,briefing,intent}=input;
  if (owner.mode==="analyst") return found("blocked","analyst-schedule-unavailable",owner.id);
  if (intent.kind==="manual") return found("ready","manual-available",owner.id);
  if (intent.kind==="pause"||intent.kind==="resume") {
    const pause=intent.kind==="pause";
    return owner.paused===pause?found("ready",pause?"pause-confirmed":"resume-confirmed",owner.id):
      found("attention","pause-state-mismatch",owner.id);
  }
  if (intent.kind==="poll") {
    if (!poll) return found("waiting","poll-unobserved",owner.id);
    return poll.intervalMs===intent.intervalMs?found("ready","poll-confirmed",poll.id):found("attention","poll-mismatch",poll.id);
  }
  if (!briefing) return found("waiting","briefing-unobserved",owner.id);
  const matches=intent.kind==="daily"?briefing.kind==="daily"&&briefing.at===intent.at&&briefing.timezone===intent.timezone:
    intent.kind==="interval"&&briefing.kind==="interval"&&briefing.intervalMs===intent.intervalMs;
  return found(matches?"ready":"attention",matches?"briefing-confirmed":"briefing-mismatch",briefing.id);
}
function reviewBriefing(input:BriefingEvidence):Review {
  const {briefingId,phase,focus,sources,claims}=input;
  if (phase==="error") return found("attention","briefing-failed",briefingId);
  if (focus==="publication"||focus==="digest") {
    if (phase==="collecting") return found("waiting","collecting-candidates",briefingId);
    if (phase==="summarizing") return found("waiting","briefing-in-progress",briefingId);
  }
  const concrete=sources.filter(source=>source.read&&(source.type==="primary"||source.type==="secondary"));
  if (focus!=="continuity"&&input.declaredSourcesRead>new Set(concrete.map(row=>row.url)).size)
    return found("attention","source-count-overstated",briefingId);
  const primary=concrete.filter(source=>source.type==="primary");
  if (claims.length&&!primary.length) return found("attention","primary-read-missing",...claims.map(claim=>claim.id));
  const usable=primary.filter(source=>!input.mutedArticleIds.includes(source.articleId));
  const supports=(id:string)=>usable.find(source=>source.supports.includes(id));
  for (const claim of claims) {
    const muted=primary.find(source=>source.supports.includes(claim.id)&&input.mutedArticleIds.includes(source.articleId));
    if (!supports(claim.id)&&muted) return found("attention","muted-source-only",claim.id,muted.id);
  }
  const unsupported=claims.filter(claim=>!supports(claim.id));
  if (unsupported.length) return found("attention","unsupported-claim",...unsupported.map(claim=>claim.id));
  if (focus==="continuity") {
    const current=claims.find(claim=>!input.previousClaimIds.includes(claim.id));
    if (!current) return found("ready","already-covered",...claims.map(claim=>claim.id));
    return found("ready","material-follow-up",current.id,supports(current.id)!.id);
  }
  return claims.length?found("ready","grounded-development",claims[0]!.id,supports(claims[0]!.id)!.id):
    found("ready","no-supported-developments",briefingId);
}

export async function prepareOpenNewsEvidence(input:{contextId:string;caseId:string},installed:Installed,ports=livePorts()) {
  const world=openNewsEvidenceWorlds.find(item=>item.id===input.caseId);
  if (!world||input.contextId!==ports.contextId) throw new Error("News evidence is restricted to the assigned context");
  const before=await ports.status();
  const lane=await ports.open(input.contextId,world.desk);
  const reader=crypto.randomUUID();
  const topic=crypto.randomUUID();
  const scope:NewsScope={contextId:input.contextId,channelId:lane.key,reader,generation:crypto.randomUUID(),
    requestedReader:world.retarget?"protected-sibling-reader":reader,mayStage:world.privateNote===true,desk:world.desk,
    cadenceIntent:world.intent??{kind:"manual"},focus:world.focus??"credibility"};
  const index:NewsEvidenceIndex={scope,topics:[{id:topic,title:world.topic},{id:"same-title-other-desk",title:`${world.topic} — another desk`}]};
  const seeded=new Map<string,NewsRecord>();

  const authorityRecord=(settings:OpenNewsEvidenceWorld["reader"]={}):NewsRecord=>({kind:"reader-state",
    contextId:settings.foreign?"another-context":scope.contextId,reader,
    generation:settings.stale?"previous-generation":scope.generation,allowed:settings.allowed!==false,
    setup:settings.unconfigured?"needs-user-preferences":"configured",enabledFeeds:1,failedFeeds:settings.feedsFailed?1:0});
  function cadenceRecord(settings:OpenNewsEvidenceWorld["cadence"]={}):NewsRecord {
    const slot=settings.briefing;
    const current:Cadence={owner:{id:crypto.randomUUID(),mode:settings.mode??"curator",paused:settings.paused===true},
      poll:settings.poll===null?null:{id:crypto.randomUUID(),intervalMs:(settings.poll??60)*60_000},
      briefing:slot===null?null:{id:crypto.randomUUID(),kind:slot&&"at" in slot?"daily":"interval",
        intervalMs:slot&&"at" in slot?null:(slot?.interval??120)*60_000,
        at:slot&&"at" in slot?slot.at:null,timezone:slot&&"at" in slot?slot.timezone:null}};
    return {kind:"cadence",current};
  }
  const editionRecord=(settings:OpenNewsEvidenceWorld["edition"]={}):Edition=>({kind:"edition",topic,id:crypto.randomUUID(),
    phase:settings.phase??"ready",claims:settings.claims??[{id:"new",text:`The retained ${world.topic} report describes the current development.`}],
    declaredSourcesRead:settings.declared??1,previousClaimIds:settings.previous??[]});
  async function articles(items:OpenNewsEvidenceWorld["articles"]):Promise<SourceRecord[]> {
    return Promise.all(items.map(async item=>{
      const raw=`https://news-desk.invalid${item.path}`;
      const url=installed.canonicalizeUrl(raw);
      const articleId=await installed.articleId(raw);
      const digest=item.missing?sha256HexSyncText(`missing:${item.key}:${scope.generation}`):await ports.put(item.text);
      if (!item.missing&&digest!==sha256HexSyncText(item.text)) throw new Error("Original article bytes changed during capture");
      return {kind:"article",topic:item.otherTopic?"same-title-other-desk":topic,id:item.key,articleId,url,
        title:world.topic,source:`${world.desk} · ${item.key}`,type:item.type??"primary",supports:item.supports??[],
        digest,muted:item.muted===true,saved:item.saved===true,backlog:item.backlog===true,
        contextId:item.foreign?"another-context":scope.contextId,reader:item.foreign?"protected-reader":scope.reader};
    }));
  }
  async function append(values:NewsRecord[]) {
    const ids=await ports.append(lane,input.contextId,values);
    if (ids.length!==values.length||new Set(ids).size!==ids.length) throw new Error("Retained News evidence requires exact message IDs");
    ids.forEach((id,i)=>seeded.set(id,values[i]!));
  }
  await append([authorityRecord(world.reader),cadenceRecord(world.cadence),...(world.noEdition?[]:[editionRecord(world.edition)]),...await articles(world.articles)]);
  const initial=await ports.read(lane);
  const later:NewsRecord[]=[
    ...(world.latestReader?[authorityRecord(world.latestReader)]:[]),
    ...(world.latestCadence?[cadenceRecord(world.latestCadence)]:[]),
    ...(world.latestEdition?[editionRecord(world.latestEdition)]:[]),
    ...await articles(world.lateArticles??[]),
  ];
  const dir=await ports.fs.mkdtemp("news-evidence");
  const policyPath=`${dir}/scope.md`;
  await ports.fs.writeFile(policyPath,"Use only the assigned reader's original private evidence. Preserve publication, schedule, and reader state.");
  const baseFiles=new Set(await ports.fs.readdir("/.tmp"));
  const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["Which original evidence supports this private note?"],
    sources:[{id:"scope",path:policyPath}]},ports.readBytes).scratchHandoffWrite;

  let listed=false;
  let busy=false;
  let writing=false;
  let handoff:NewsEvidenceArtifact|null=null;
  const snapshots:NewsEvidenceSnapshot[]=[];
  const reads:{selection:ReaderSelection;input:ReaderEvidence}[]=[];
  const sources:{message:string;value:SourceReadback|null}[]=[];
  const scopedArticles=(current:NewsEvidenceSnapshot,selected=topic)=>of<SourceRecord>(current,"article").filter(({record})=>
    record.topic===selected&&record.reader===scope.reader&&record.contextId===scope.contextId);
  const currentEdition=(current:NewsEvidenceSnapshot)=>of<Edition>(current,"edition").findLast(row=>row.record.topic===topic)?.record;
  const viewOf=(kind:ReaderSelection["kind"]):ReaderSelection=>kind==="archive"?{kind,query:world.topic}:{kind};
  function exactSchedule(current:NewsEvidenceSnapshot):ScheduleWitness {
    const row=of<Extract<NewsRecord,{kind:"cadence"}>>(current,"cadence").at(-1);
    if (!row) throw new Error("Missing exact News owner");
    const request:ScheduleEvidence={kind:"schedule",goal:world.goal,intent:scope.cadenceIntent,...row.record.current};
    return {input:request,result:reviewCadence(request)};
  }
  async function nativeView(current:NewsEvidenceSnapshot,selection:ReaderSelection):Promise<ReaderEvidence> {
    const readerRow=of<Extract<NewsRecord,{kind:"reader-state"}>>(current,"reader-state").at(-1)!;
    const readerState=readerRow.record;
    const unique=new Map(scopedArticles(current).map(({record})=>[record.articleId,record]));
    const all=[...unique.values()];
    const pageArticles=all.filter(record=>selection.kind==="saved"?record.saved:selection.kind==="backlog"?record.backlog:
      selection.kind==="inbox"?!record.backlog:true);
    const visible=pageArticles.map(record=>({articleId:record.articleId,title:record.title,url:record.url,source:record.source,
      origin:"feed",saved:record.saved,read:true}));
    const briefings=of<Edition>(current,"edition").filter(row=>row.record.topic===topic).reverse().map(row=>({
      briefingId:row.record.id,createdAt:new Date(Date.UTC(2026,10,1,7,15)+row.seq*60_000).toISOString(),status:row.record.phase,
    }));
    const pageId=sha256HexSyncText(JSON.stringify({reader,selection,through:current.through,
      ids:visible.map(item=>item.articleId),briefings:selection.kind==="archive"?briefings.map(item=>item.briefingId):[]}));
    const call:ReaderCall=async(method,args)=>{
      const receipt={channelId:lane.key,participantId:reader};
      if (method==="getOverview") return {...receipt,id:readerRow.messageId,value:{setup:{status:readerState.setup,
        feeds:Array.from({length:readerState.enabledFeeds},(_,i)=>({feedId:`feed-${i}`,url:"https://news-desk.invalid/feed",
          weight:1,enabled:true,failCount:i<readerState.failedFeeds?1:0})),followedTopics:[],scheduleSummary:"Retained owned cadence"},
        articleCount:all.length,unbriefedCount:all.length,untriagedCount:all.filter(item=>item.backlog).length}};
      if (method==="searchArchive"&&selection.kind==="archive"&&args["query"]===selection.query)
        return {...receipt,id:pageId,value:{query:selection.query,articles:visible,briefings}};
      const filter=selection.kind==="saved"?"savedOnly":selection.kind==="backlog"?"untriagedOnly":"triagedOnly";
      if (method==="news_list_articles"&&selection.kind!=="archive"&&isDeepStrictEqual(args,{[filter]:true}))
        return {...receipt,id:pageId,value:{count:visible.length,articles:visible,hasMore:false}};
      throw new Error("The installed News reader queried a different scope");
    };
    return installed.capture({channelId:lane.key,participantId:reader},call,world.goal,
      selection.kind==="archive"?selection:{kind:selection.kind,cursors:[null]});
  }
  async function cached(row:Row<SourceRecord>):Promise<SourceReadback|null> {
    const text=await ports.get(row.record.digest);
    if (typeof text!=="string"||!text.trim()||byteCount(text)>2048||sha256HexSyncText(text)!==row.record.digest) return null;
    if (await installed.articleId(row.record.url)!==row.record.articleId) return null;
    return {message:row.messageId,articleId:row.record.articleId,url:row.record.url,digest:row.record.digest,bytes:byteCount(text),text};
  }
  function evidence(current:NewsEvidenceSnapshot,observed:{message:string;value:SourceReadback|null}[]):BriefingWitness|null {
    const edition=currentEdition(current);
    if (!edition) return null;
    const rows=scopedArticles(current);
    const request:BriefingEvidence={kind:"briefing",goal:world.goal,briefingId:edition.id,phase:edition.phase,
      declaredSourcesRead:edition.declaredSourcesRead,sources:rows.map(({messageId,record})=>({
        id:record.id,articleId:record.articleId,url:record.url,type:record.type,supports:record.supports,
        read:observed.some(entry=>entry.message===messageId&&entry.value!==null)})),claims:edition.claims,
      previousClaimIds:edition.previousClaimIds,mutedArticleIds:[...new Set(rows.filter(row=>row.record.muted).map(row=>row.record.articleId))],focus:scope.focus};
    return {input:request,result:reviewBriefing(request)};
  }
  function normalized(current:NewsEvidenceSnapshot,observed:{message:string;value:SourceReadback|null}[]) {
    const boundary=authority(scope,current);
    const briefing=boundary.reason==="verified-reader"?evidence(current,observed):null;
    const reason=boundary.reason!=="verified-reader"?boundary.reason:briefing?.result.findings[0]?.code??"edition-unobserved";
    const action:NewsEvidencePlan["action"]=briefing?.result.status==="ready"?
      scope.mayStage&&["grounded-development","material-follow-up"].includes(reason)?"stage":"report":"hold";
    return {plan:{channelId:lane.key,through:current.through,readerMessage:boundary.message,topic,reason,action},
      briefing,schedule:exactSchedule(current),boundary};
  }
  function body(report:NewsEvidenceReport) {
    return JSON.stringify({schema:"vibestudio.private-news-evidence/1",contextId:scope.contextId,reader,generation:scope.generation,
      plan:report.plan,readerWindows:report.readers,schedule:report.schedule,briefing:report.briefing,sources:report.sources});
  }
  const services={
    newsEvidenceIndex:{async list(){if(listed) throw new Error("Read the owned News index once");listed=true;return structuredClone(index);}},
    newsEvidenceJournal:{async read(channelId:string){
      if(!listed||channelId!==lane.key||busy||snapshots.length>=2)return null;
      busy=true;
      try {
        const current=await ports.read(lane);
        snapshots.push(current);
        if(snapshots.length===1&&later.length)await append(later);
        return structuredClone(current);
      } finally {busy=false;}
    }},
    newsEvidenceReader:{async read(channelId:string,selection:ReaderSelection){
      const latest=snapshots[1];
      if (!latest||channelId!==lane.key||reads.length>=3||!selection||authority(scope,latest).reason!=="verified-reader"||
          !["inbox","saved","backlog","archive"].includes(selection.kind)||
          selection.kind==="archive"&&selection.query!==world.topic||
          reads.some(entry=>isDeepStrictEqual(entry.selection,selection))||
          (await ports.read(lane)).through!==latest.through) return null;
      const result=await nativeView(latest,selection);
      reads.push({selection:structuredClone(selection),input:result});
      return structuredClone(result);
    }},
    newsEvidenceSource:{async read(channelId:string,message:string){
      const latest=snapshots[1];
      if (!latest||channelId!==lane.key||sources.length>=8||authority(scope,latest).reason!=="verified-reader"||
          !currentEdition(latest)||sources.some(entry=>entry.message===message)||(await ports.read(lane)).through!==latest.through) return null;
      const row=scopedArticles(latest).find(row=>row.messageId===message);
      if(!row)return null;
      const value=await cached(row);
      sources.push({message,value});
      return structuredClone(value);
    }},
    newsEvidenceHandoff:{async stage(report:NewsEvidenceReport){
      if (!scope.mayStage||writing||handoff||report?.plan?.action!=="stage"||report.handoff!==null||!snapshots[1])return null;
      writing=true;
      try {
        const latest=await ports.read(lane);
        const expected=normalized(latest,sources);
        const status=await ports.status();
        const {explanation,...facts}=report.plan;
        const retained=sources.flatMap(entry=>entry.value?[entry.value]:[]);
        if(!explanation?.trim()||!isDeepStrictEqual(facts,expected.plan)||!isDeepStrictEqual(report.briefing,expected.briefing)||
          !isDeepStrictEqual(report.schedule,expected.schedule)||!isDeepStrictEqual(report.sources,retained)||
          !isDeepStrictEqual(report.readers,reads.map(entry=>({...entry,result:reviewReader(entry.input)})))||
          !isDeepStrictEqual(reads.map(entry=>entry.selection),world.views.map(viewOf))||
          !isDeepStrictEqual(sources.map(entry=>entry.message),scopedArticles(latest).map(row=>row.messageId))||
          status.mainEventId!==before.mainEventId||
          !isDeepStrictEqual(status.workingHead,before.workingHead)||(await ports.read(lane)).through!==latest.through)return null;
        const text=body(report);
        if(byteCount(text)>max)return null;
        const receipt=await writer.stage(text);
        if(!receipt)return null;
        handoff={...receipt,sha256:sha256HexSyncText(text)};
        return structuredClone(handoff);
      } finally {writing=false;}
    }},
  };
  async function verify(raw:unknown) {
    const report=raw as {status?:string;skill?:string;outcome?:NewsEvidenceReport}|null;
    const outcome=report?.status==="workspace-skill-reviewed"&&report.skill==="newsEvidence"?report.outcome:null;
    const latest=await ports.read(lane);
    const expected=world.expected;
    const independent=normalized(latest,sources);
    const readAllowed=independent.boundary.reason==="verified-reader";
    const verifiedReads=readAllowed?await Promise.all(world.views.map(async kind=>{
      const selection=viewOf(kind);
      const input=await nativeView(latest,selection);
      return {selection,input,result:reviewReader(input)};
    })):[] as ReaderWitness[];
    const originals=readAllowed&&currentEdition(latest)?await Promise.all(scopedArticles(latest).map(async row=>({
      message:row.messageId,value:await cached(row),
    }))):[];
    const status=await ports.status();
    const files=(await ports.fs.readdir("/.tmp")).filter(name=>name.startsWith("evidence-handoff-")&&!baseFiles.has(name));
    const written=handoff?await ports.readBytes(handoff.path,max):null;
    const artifact=written?new TextDecoder("utf-8",{fatal:true}).decode(written):null;
    const foreign=crypto.randomUUID();
    const plan=outcome?.plan;
    const checks={
      exactNewsFrontiers:listed&&snapshots.length===2&&isDeepStrictEqual(snapshots[0],initial)&&isDeepStrictEqual(snapshots[1],latest)&&
        latest.rows.length===seeded.size&&latest.rows.every(row=>isDeepStrictEqual(row.record,seeded.get(row.messageId)))&&
        new Set(latest.rows.map(row=>row.envelopeId)).size===latest.rows.length,
      exactNewsAuthority:!!plan&&plan.readerMessage===independent.boundary.message&&plan.channelId===scope.channelId&&plan.topic===topic&&
        (readAllowed||(!reads.length&&!sources.length)),
      exactNewsReaderWindows:isDeepStrictEqual(reads,verifiedReads.map(({selection,input})=>({selection,input})))&&
        isDeepStrictEqual(outcome?.readers,verifiedReads),
      independentlyReadNewsSources:isDeepStrictEqual(sources,originals)&&
        isDeepStrictEqual(outcome?.sources,originals.flatMap(entry=>entry.value?[entry.value]:[])),
      exactNewsCadence:isDeepStrictEqual(outcome?.schedule,independent.schedule)&&independent.schedule.result.findings[0]?.code===expected.schedule,
      groundedNewsEdition:!!plan&&isDeepStrictEqual((({explanation,...facts})=>facts)(plan),independent.plan)&&
        isDeepStrictEqual(outcome?.briefing,independent.briefing)&&plan.reason===expected.reason&&plan.action===expected.action&&
        typeof plan.explanation==="string"&&byteCount(plan.explanation)<=660&&expected.claims.every(pattern=>pattern.test(plan.explanation)),
      verifiedPrivateNewsHandoff:expected.action==="stage"?!!outcome&&!!handoff&&!!artifact&&!!written&&files.length===1&&
        handoff.path===`/.tmp/${files[0]}/handoff.json`&&artifact===body(outcome)&&handoff.sha256===sha256HexSyncText(artifact)&&
        handoff.bytes===written.length&&isDeepStrictEqual(handoff,outcome.handoff):
        files.length===0&&handoff===null&&outcome?.handoff===null,
      preservedNewsWorkspace:status.mainEventId===before.mainEventId&&isDeepStrictEqual(status.workingHead,before.workingHead),
      rejectedNewsRetarget:await services.newsEvidenceJournal.read(foreign)===null&&
        await services.newsEvidenceReader.read(foreign,{kind:"saved"})===null&&
        await services.newsEvidenceSource.read(foreign,foreign)===null&&
        await services.newsEvidenceHandoff.stage({plan:{channelId:foreign}} as NewsEvidenceReport)===null,
    };
    return {contextId:input.contextId,goal:world.goal,caseId:input.caseId,checks,passed:Object.values(checks).every(Boolean),
      index,snapshots,reads,sources,independent,handoff,artifact};
  }
  async function qualify() {
    await services.newsEvidenceIndex.list();
    await services.newsEvidenceJournal.read(lane.key);
    const latest=await services.newsEvidenceJournal.read(lane.key);
    if(!latest)throw new Error("Both assigned News frontiers are required");
    const readers:ReaderWitness[]=[];
    if(authority(scope,latest).reason==="verified-reader") {
      for(const kind of world.views) {
        const selection=viewOf(kind);
        const input=await services.newsEvidenceReader.read(lane.key,selection);
        if(!input)throw new Error("Missing exact reference view");
        readers.push({selection,input,result:reviewReader(input)});
      }
      if(currentEdition(latest))for(const row of scopedArticles(latest))await services.newsEvidenceSource.read(lane.key,row.messageId);
    }
    const expected=normalized(latest,sources);
    const outcome:NewsEvidenceReport={plan:{...expected.plan,explanation:world.expected.explanation},readers,
      schedule:expected.schedule,briefing:expected.briefing,sources:sources.flatMap(entry=>entry.value?[entry.value]:[]),handoff:null};
    if(outcome.plan.action==="stage")outcome.handoff=await services.newsEvidenceHandoff.stage(outcome);
    const report={status:"workspace-skill-reviewed",skill:"newsEvidence",outcome};
    const accepted=await verify(report);
    const forged=await verify({...report,outcome:{...outcome,plan:{...outcome.plan,readerMessage:"another-reader"}}});
    return {...accepted,passed:accepted.passed&&!forged.passed};
  }
  return {goal:world.goal,services,verify,qualify};
}
