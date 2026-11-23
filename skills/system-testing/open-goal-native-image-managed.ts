import {assessObservedApplicationOutcome} from "./observed-application-outcome.js";
import type {SemanticOutcomeContract} from "./semantic-outcome-contract.js";
import type {InvocationObservations} from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { sha256Hex } from "@vibestudio/content-addressing";
import type { VcsStateNodeRef } from "@vibestudio/service-schemas/vcs";
import { contextId, rpc, runtime, vcs, type VcsClient } from "@workspace/runtime";
import { imagesRpcMethods, type ImageGenerationJob, type ImageGenerationRequest, type ImagesService } from "@workspace/runtime/images";
import { imageJobFixtureMethods, type ImageJobFixtureControl, type ImageFixtureSeed } from "@workspace-workers/image-job-fixture/contract";
import { imageFixtureBytes } from "./open-goal-image-fixture-bytes.js";
import type { NativeImageWorld } from "./open-goal-native-image-worlds.js";

type Ports = { context: string; images: Pick<ImagesService,"generate"|"retry"|"getJob"|"readAsset"|"importAsset"> & ImageJobFixtureControl;
  vcs: Pick<VcsClient,"status"|"mainState"|"edit"|"commit"|"resolveRepository"|"readFile">;
  wait(id:string):Promise<ImageGenerationJob>; close():Promise<void> };
type Action = "create" | "retry" | "reuse" | "hold";
type Save = { status:"saved"|"stale"; head:string; path:string; digest:string|null };
const stateKey = (state:VcsStateNodeRef) => JSON.stringify(state);
const hex = (base64:string) => sha256Hex(Buffer.from(base64,"base64"));
const original = {png:imageFixtureBytes.png[0],jpeg:imageFixtureBytes.jpeg[0],webp:imageFixtureBytes.webp[0]};
const ready = (job:ImageGenerationJob) => !["queued","running"].includes(job.status);
const viewJob = (job:ImageGenerationJob) => ({id:job.id,requestId:job.requestId,attempt:job.attempt,status:job.status,
  digest:job.asset?.digest??null,error:job.error??null});

async function livePorts(context:string):Promise<Ports> {
  if (contextId!==context) throw new Error("Image fixture requires the exact owned context");
  const entity = await runtime.createEntity({kind:"do",contextId:context,execution:{surface:"code",source:"workers/image-job-fixture"},
    className:"ImageJobFixtureDO",key:"local-image-proof-"+crypto.randomUUID()});
  if (entity.kind!=="do" || entity.contextId!==context) {
    await runtime.retireEntity({id:entity.id});
    throw new Error("Image fixture escaped its owned context");
  }
  const target=entity.targetId;
  const images:Ports["images"]={
    generate:request=>rpc.call(target,imagesRpcMethods.generate,[request]),
    retry:id=>rpc.call(target,imagesRpcMethods.retry,[id]), getJob:id=>rpc.call(target,imagesRpcMethods.getJob,[id]),
    readAsset:id=>rpc.call(target,imagesRpcMethods.readAsset,[id]), importAsset:input=>rpc.call(target,imagesRpcMethods.importAsset,[input]),
    configure:input=>rpc.call(target,imageJobFixtureMethods.configure,[input]), readFixtureTransport:()=>rpc.call(target,imageJobFixtureMethods.readFixtureTransport,[]),
  };
  return {context,images,vcs,async wait(id){
    const deadline=Date.now()+10000;
    do { const job=await images.getJob(id); if(ready(job))return job; await new Promise(resolve=>setTimeout(resolve,25)); } while(Date.now()<deadline);
    throw new Error("The owned native image attempt did not reach terminal state");
  },async close(){await runtime.retireEntity({id:entity.id});}};
}

export async function prepareNativeImage(input:{contextId:string;caseId:string},world:NativeImageWorld,replay?:Ports){
  const ports=replay??await livePorts(input.contextId);
  try { return {...await bindNativeImage(input,world,ports),close:()=>ports.close()}; }
  catch(error){await ports.close();throw error;}
}
async function bindNativeImage(input:{contextId:string;caseId:string},world:NativeImageWorld,ports:Ports){
  const context=input.contextId, {images,vcs}=ports;
  if(input.caseId!==world.id||context!==ports.context)throw new Error("Wrong native generation fixture ownership");
  const status=()=>vcs.status({contextId:context});
  const before=await status(), main=await vcs.mainState();
  if(!before.clean)throw new Error("Image attempt needs a clean isolated workspace at setup");
  const repository="projects/owned-image-"+crypto.randomUUID(), path="illustration."+world.format, neighbor="unchanged.md";
  const canary="This unrelated local file stays unchanged.\n";
  const peer=imageFixtureBytes[world.format][1];
  const competing = world.occupancy==="existing"?[{path,mode:0o644,content:{kind:"bytes" as const,base64:peer}}]:[];
  const seeded=await vcs.edit({contextId:context,commandId:crypto.randomUUID(),expectedWorkingHead:before.workingHead,
    changes:[{kind:"repository-create",repoPath:repository,files:[{path:neighbor,mode:0o644,content:{kind:"text",text:canary}},...competing]}]});
  const start=(await vcs.commit({contextId:context,commandId:crypto.randomUUID(),expectedWorkingHead:seeded.workingHead,message:"Open private illustration draft"})).event;
  const repo=await vcs.resolveRepository({state:start,repoPath:repository});
  if(!repo)throw new Error("Private illustration workspace source is absent");
  const {repositoryId}=repo;
  const read=(state:VcsStateNodeRef,relative:string)=>vcs.readFile({state,repositoryId,file:{kind:"path",path:relative}});
  const scope=crypto.randomUUID(), request:ImageGenerationRequest={requestId:"owned-generation-"+scope,prompt:world.topic,outputFormat:world.format};
  const reference = world.references==="owned"?await images.importAsset({base64:imageFixtureBytes.png[2],owner:`fixture-reference:${scope}`}):null;
  if(reference)request.references=[reference];
  const init:ImageFixtureSeed["steps"]=world.starting==="ready"?["ok"]:world.starting==="failed"?["unavailable",world.outcome]:[world.outcome];
  await images.configure({originals:original,steps:init});
  let seedJob:ImageGenerationJob|null=null;
  if(world.starting!=="empty"){
    const queued=await images.generate(request);
    seedJob=await ports.wait(queued.id);
    if(seedJob.status!==(world.starting==="ready"?"succeeded":"failed")||seedJob.attempt!==1)throw new Error("Native image setup did not retain the specified original attempt");
  }
  const startedTransport=await images.readFixtureTransport();
  const assignment={scope,goal:world.goal,request:request.requestId,path:repository+"/"+path,format:world.format};
  const actualBasis=async()=>{
    const current=await status();
    const file=await read(current.workingHead,path);
    return {head:stateKey(current.workingHead),destination:file?"occupied" as const:"empty" as const,
      generationAllowed:world.generate,retryAllowed:world.retry,saveAllowed:world.save,referencesApproved:world.references!=="unapproved",
      job:seedJob?viewJob(await images.getJob(seedJob.id)):null};
  };
  const initialBasis=await actualBasis();
  const decision: {action:Action;reason:string}=initialBasis.saveAllowed&&initialBasis.destination==="occupied"?{action:"hold",reason:"occupied"}:
    !initialBasis.referencesApproved?{action:"hold",reason:"reference"}:initialBasis.job?.status==="succeeded"?{action:"reuse",reason:"already-generated"}:
    initialBasis.job?initialBasis.generationAllowed&&initialBasis.retryAllowed?{action:"retry",reason:"retry"}:{action:"hold",reason:"no-retry"}:
    initialBasis.generationAllowed?{action:"create",reason:"new"}:{action:"hold",reason:"no-generation"};
  let discovered=false,basis:typeof initialBasis|null=null,running=false,saving=false;
  let outcome:{job:ReturnType<typeof viewJob>;original:{digest:string;bytes:number;mime:string}|null}|null=null;
  let exactImage:{job:ImageGenerationJob;base64:string}|null=null,saved:Save|null=null,writeState:VcsStateNodeRef|null=null;
  const effects:{service:string;method:string;args:unknown[];result:unknown}[]=[];
  function capture<T>(service:string,method:string,args:unknown[],result:T):T{
    effects.push(structuredClone({service,method,args,result}));return structuredClone(result);
  }
  const services={
    illustrationEvidence:{
      async discover(){if(discovered)return structuredClone(assignment);discovered=true;return capture("illustrationEvidence","discover",[],assignment);},
      async read(id:string){if(id!==scope)throw new Error("Image evidence requires the assigned scope");
        if(basis)return structuredClone(basis);
        basis=await actualBasis();return capture("illustrationEvidence","read",[id],basis);},
    },
    illustrationJobs:{
      async run(id:string,head:string,action:Action){
        if(id!==scope||!basis||basis.head!==head||action!==decision.action||action==="hold"||running||outcome)
          throw new Error("Reject an unrelated, duplicated, or unavailable native image attempt");
        running=true;
        try{
          if(stateKey((await status()).workingHead)!==head)throw new Error("Native generation basis is no longer current");
          const admitted=action==="create"?await images.generate(request):action==="retry"?await images.retry(seedJob!.id):await images.getJob(seedJob!.id);
          const attempt=action==="retry"?2:1;
          if(admitted.requestId!==request.requestId||admitted.attempt!==attempt||action!=="create"&&admitted.id!==seedJob?.id)
            throw new Error("Native image request or retry was misbound");
          const job=ready(admitted)?admitted:await ports.wait(admitted.id);
          if(job.id!==admitted.id||job.attempt!==attempt||job.requestId!==request.requestId)throw new Error("Native completion missed the admitted attempt");
          let original=null;
          if(job.status==="succeeded"&&job.asset){
            const stored=await images.readAsset(job.asset.id);
            if(!isDeepStrictEqual(stored.asset,job.asset)||hex(stored.base64)!==job.asset.digest||
              stored.asset.mimeType!==`image/${world.format}`||Buffer.from(stored.base64,"base64").length!==job.asset.byteLength)
              throw new Error("Native image original lacks exact stored-byte attestation");
            exactImage={job,base64:stored.base64};
            original={digest:stored.asset.digest,bytes:stored.asset.byteLength,mime:stored.asset.mimeType};
          }
          outcome={job:viewJob(job),original};return capture("illustrationJobs","run",[id,head,action],outcome);
        }finally{running=false;}
      },
    },
    illustrationOriginal:{
      async save(id:string,head:string,jobId:string,digest:string){
        if(id!==scope||!basis?.saveAllowed||basis.head!==head||!exactImage||jobId!==exactImage.job.id||
          digest!==exactImage.job.asset?.digest||saving||saved)throw new Error("Only this verified original and authorized basis can be saved");
        saving=true;
        try{
          if(world.occupancy==="races"){
            const raced=await vcs.edit({contextId:context,commandId:crypto.randomUUID(),expectedWorkingHead:start,
              changes:[{kind:"file-create",repositoryId,path,content:{kind:"bytes",base64:peer},mode:0o644}]});
            writeState=raced.workingHead;
          }
          const current=(await status()).workingHead;
          if(stateKey(current)!==head||await read(current,path))saved={status:"stale",head:stateKey(current),path:assignment.path,digest:null};
          else{
            const write=await vcs.edit({contextId:context,commandId:crypto.randomUUID(),expectedWorkingHead:current,
              intentSummary:"Save the verified native original in its owned destination",changes:[{kind:"file-create",repositoryId,path,
                content:{kind:"bytes",base64:exactImage.base64},mode:0o644}]});
            writeState=write.workingHead;
            const reopened=await read(write.workingHead,path);
            if(write.changeIds.length!==1||reopened?.content?.kind!=="bytes"||reopened.content.base64!==exactImage.base64||hex(reopened.content.base64)!==digest)
              throw new Error("Semantic workspace original differs from retained content");
            saved={status:"saved",head:stateKey(write.workingHead),path:assignment.path,digest};
          }
          return capture("illustrationOriginal","save",[id,head,jobId,digest],saved);
        }finally{saving=false;}
      },
    },
  };
  function report(){return {assignment,basis,decision,outcome,saved};}
  async function verify(value:unknown,invocation?:InvocationObservations){
    const final=await status(), transport=await images.readFixtureTransport();
    const actualJob=outcome?await images.getJob(outcome.job.id):seedJob?await images.getJob(seedJob.id):null;
    const output=await read(final.workingHead,path), untouched=await read(final.workingHead,neighbor);
    const externalRequestCount=decision.action==="create"||decision.action==="retry"?1:0;
    const changed=decision.action==="create"||decision.action==="retry";
    const expectedSuccess=decision.action==="reuse"||changed&&world.outcome==="ok";
    const expectedError=world.outcome==="wrong-format"?"Generated image data does not match the requested output format":"HTTP 503";
    const expectedSave=expectedSuccess&&world.save?(world.occupancy==="races"?"stale":"saved"):null;
    const originalRead=actualJob?.asset?await images.readAsset(actualJob.asset.id):null;
    const refRead=reference?await images.readAsset(reference.id):null;
    const expectedBytes=world.occupancy==="existing"||expectedSave==="stale"?peer:expectedSave==="saved"?original[world.format]:null;
    const checks={
      observedExactImageBasis:isDeepStrictEqual(basis,initialBasis),
      boundNativeImageAttempt:transport.length===startedTransport.length+externalRequestCount&&
        isDeepStrictEqual(transport.slice(0,startedTransport.length),startedTransport)&&transport.every(row=>
          row.session===actualJob?.id&&row.format===world.format&&row.prompt===world.topic&&
          isDeepStrictEqual(row.referenceDigests,reference?[reference.digest]:[]))&&
        (!changed||transport.at(-1)?.outcome===world.outcome)&&(!changed||expectedSuccess||actualJob?.error?.includes(expectedError))&&
        (outcome?actualJob?.status===(expectedSuccess?"succeeded":"failed")&&isDeepStrictEqual(viewJob(actualJob),outcome.job)&&
          (decision.action==="retry"?actualJob.attempt===2&&actualJob.id===seedJob?.id:actualJob.attempt===1):decision.action==="hold"&&isDeepStrictEqual(seedJob,actualJob)),
      verifiedNativeOriginal:expectedSuccess?Boolean(originalRead&&outcome?.original&&originalRead.base64===original[world.format]&&
        originalRead.asset.digest===hex(originalRead.base64)&&originalRead.asset.digest===outcome.original.digest&&originalRead.asset.provenance.provider==="openai-codex"&&
        originalRead.asset.provenance.responseModel==="owned-image-transport"):
        !outcome?.original&&!originalRead,
      preservedAuthorizedWorkspace:(saved?.status??null)===expectedSave&&isDeepStrictEqual(final.workingHead,writeState??start)&&
        isDeepStrictEqual(main,await vcs.mainState())&&untouched?.content?.kind==="text"&&untouched.content.text===canary&&
        (expectedBytes===null?output===null:output?.content?.kind==="bytes"&&output.content.base64===expectedBytes)&&
        (!reference||isDeepStrictEqual(refRead?.asset,reference)&&refRead?.base64===imageFixtureBytes.png[2]),
      matchedNativeImageReport:isDeepStrictEqual(value,{outcome,saved}),
    };
    const contract:SemanticOutcomeContract={"effects": {"checks": ["observedExactImageBasis", "boundNativeImageAttempt", "verifiedNativeOriginal", "preservedAuthorizedWorkspace"], "rationale": "Native observations, scoped authority, retained bytes and protected state establish application effects independently."}, "returnedValue": {"checks": ["matchedNativeImageReport"], "required": decision.action==="hold"||(decision.action==="reuse"&&!world.save), "rationale": "The returned domain findings are required for queries; completed mutations are established independently."}, "incidentalValues": {"checks": [], "rationale": "Receipt echoes are optional presentation of independently verified native artifacts."}};
    return assessObservedApplicationOutcome({caseId:world.id,contextId:context,goal:world.goal,passed:Object.values(checks).every(Boolean),checks,...report(),
      native:{providerBoundary:"owned-deterministic-sse",transport,repositoryId,originalDigest:originalRead?.asset?.digest??null},effects:structuredClone(effects)},contract,value,invocation);
  }
  async function qualify(){
    await services.illustrationEvidence.discover();await services.illustrationEvidence.read(scope);
    const reject=async (call:()=>Promise<unknown>)=>{try{await call();return false;}catch{return true;}};
    const rejectedForeignAttempt=await reject(()=>services.illustrationJobs.run("neighbor",initialBasis.head,decision.action));
    if(decision.action!=="hold")await services.illustrationJobs.run(scope,initialBasis.head,decision.action);
    const rejectedWrongBytes=await reject(()=>services.illustrationOriginal.save(scope,initialBasis.head,seedJob?.id??"fresh","unverified-original"));
    const complete=outcome as ReturnType<typeof report>["outcome"];
    if(complete?.original&&world.save)await services.illustrationOriginal.save(scope,initialBasis.head,complete.job.id,complete.original.digest);
    const answer={outcome,saved},proof=await verify(answer);
    const rejectedInventedOriginal=!(await verify({...answer,outcome:{...answer.outcome,original:{digest:"invented",bytes:1,mime:"image/png"}}})).outcomeDimensions.returnedValue.passed;
    const checks={...proof.checks,rejectedForeignAttempt,rejectedWrongBytes,rejectedInventedOriginal};
    return {...proof,checks,passed:Object.values(checks).every(Boolean),report:answer};
  }
  return {services,qualify,verify};
}
