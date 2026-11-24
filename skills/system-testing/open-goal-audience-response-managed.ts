import {assessObservedApplicationOutcome} from "@workspace/application-outcomes/observed-application-outcome";
import type {InvocationObservations} from "@workspace/application-outcomes/observed-invocation";
import {type SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
import { isDeepStrictEqual as equal } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { contextId, fs, panelTree, vcs, type PanelHandle } from "@workspace/runtime";
import type { AudienceAnswer,AudienceInteraction,AudienceModel,AudiencePrepared,AudienceReceipt,AudienceRecord,
  AudienceReport } from "@workspace-skills/open-audience-response/types";
import { audienceCost, renderAudienceCalculator } from "@workspace-skills/open-audience-response/calculator";
import { checkPresentation, observePresentation, referencePresentation } from "./presentation-managed.js";
import type { OpenAudienceWorld } from "./open-goal-audience-response-worlds.js";

type Input={contextId:string;caseId:string;panelId?:string;source?:string};
type PanelState={previewRevision?:string|null;views?:{id:string;mdx:string}[]};
type Ports={contextId:string|null;fs:Pick<typeof fs,"mkdtemp"|"writeFile"|"readFile"|"rm">;head:typeof vcs.status;
  getPanel:(id:string)=>PanelHandle;observe:typeof observePresentation;probe:typeof observeCalculator};
const dollars=(amount:number)=>"$"+amount.toFixed(2);
function livePorts():Ports{return {contextId,fs,head:()=>vcs.status(),getPanel:id=>panelTree.get(id),observe:observePresentation,
  probe:observeCalculator};}

export async function observeCalculator(panel:PanelHandle,model:AudienceModel,quantity:number):Promise<AudienceInteraction> {
  const session=await panel.cdp.session();
  try {
    return await session.page.evaluate<AudienceInteraction>(`(async () => {
      const root=document.querySelector(".vs-r-calculator");
      const input=root?.querySelector("input[type=number]");
      const output=root?.querySelector(".vs-r-stat-value");
      const label=root?.querySelector("label");
      if(!input||!output||!label)throw new Error("The assigned calculator control is missing");
      const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
      const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      async function change(value) {
        set.call(input,String(value));
        input.dispatchEvent(new Event("input",{bubbles:true}));
        await frame();
      }
      const inputLabel=label.textContent?.trim()??"";
      const beforeInput=Number(input.value);
      const beforeResult=output.textContent?.trim()??"";
      if(inputLabel!==${JSON.stringify(model.inputLabel)}||beforeInput!==${model.initial})throw new Error("Wrong default input");
      const afterInput=${quantity};
      if(!Number.isSafeInteger(afterInput)||afterInput<Number(input.min)||afterInput>Number(input.max))throw new Error("Wrong recorded bounds");
      try{
        await change(afterInput);
        if(Number(input.value)!==afterInput)throw new Error("Control did not accept the scoped value");
        return {inputLabel,beforeInput,afterInput,beforeResult,afterResult:output.textContent?.trim()??""};
      }finally{
        await change(beforeInput);
        if(output.textContent?.trim()!==beforeResult)throw new Error("Calculator state was not restored");
      }
    })()`);
  }finally{
    await session.close();
  }
}

export async function prepareAudienceResponse(input:Input,world:OpenAudienceWorld,ports=livePorts()){
  if(ports.contextId!==input.contextId||!input.panelId||!input.source||world.id!==input.caseId)
    throw new Error("Audience response requires its owned renderer");
  const owner=input.contextId,source=input.source;
  const panel=ports.getPanel(input.panelId);
  const before=await ports.head();
  async function binding(){
    const current=await panel.observe();
    if(current.contextId!==owner||current.source!==source||current.requestedRef!=="ctx:"+owner||
      current.kind!=="workspace"||current.phase!=="ready"||!current.attemptId||!current.buildKey)
      throw new Error("The audience renderer is outside the assigned workspace");
    return {attempt:current.attemptId,build:current.buildKey};
  }
  const active=await binding();
  const panelBefore=await panel.stateArgs.get<PanelState>();
  if(panelBefore.previewRevision||panelBefore.views?.length)throw new Error("The owned preview is already occupied");
  const directory=await ports.fs.mkdtemp("audience-response");
  const path=directory+"/decision-record.json";
  const original={id:"current-decision",title:world.title,source:world.source,facts:world.facts,sections:world.section?[world.section]:[],
    model:world.model??null};
  const originalBytes=JSON.stringify(original);
  async function close(){await ports.fs.rm(directory,{recursive:true,force:true});}
  try{
    await ports.fs.writeFile(path,originalBytes);
  }catch(error){
    await close();
    throw error;
  }
  async function read():Promise<AudienceRecord>{
    const raw=await ports.fs.readFile(path,"utf8");
    return {...JSON.parse(raw),revision:sha256HexSyncText(raw)};
  }
  const request={goal:world.goal,sections:original.sections};
  const reference={id:world.id,request,expected:world.expected??[],omitted:[]};
  const expectedAnswer=world.facts.filter(fact=>world.answer.includes(fact.id));
  type Display=NonNullable<ReturnType<typeof checkPresentation>>;
  let record:AudienceRecord|null=null;
  let receipt:AudienceReceipt|null=null;
  let sent:AudiencePrepared|null=null;
  let writing=false;
  let wrote=0;
  function visual(candidate:AudiencePrepared):Display|null{
    if(!candidate||world.mode==="plain")return null;
    const ordinary=checkPresentation(reference,candidate.presentation);
    if(!ordinary)return null;
    if(world.mode==="catalog")return candidate.modelId===null&&ordinary.length?ordinary:null;
    if(!world.model||candidate.modelId!==world.model.id||ordinary.length)return null;
    return [{id:world.model.id,mdx:renderAudienceCalculator(world.model),selector:".vs-r-calculator",
      labels:[world.model.title,world.model.inputLabel,world.model.outputLabel]}];
  }
  function interaction():AudienceInteraction|null{
    if(world.mode!=="calculator"||!world.model||world.probe===undefined)return null;
    return {inputLabel:world.model.inputLabel,beforeInput:world.model.initial,afterInput:world.probe,
      beforeResult:dollars(audienceCost(world.model,world.model.initial)),afterResult:dollars(audienceCost(world.model,world.probe))};
  }
  async function display(views:Display,revision?:string){
    return ports.observe(panel,views,owner,source,AbortSignal.timeout(12_000),revision);
  }
  const services={
    nativeAudienceResponse:{
      async readRecord(){record=await read();return structuredClone(record);},
      async render(id:string,revision:string,prepared:AudiencePrepared){
        if(writing||receipt||!record||record.id!==id||record.revision!==revision||!equal(record,await read()))return null;
        const views=visual(prepared);
        if(!views||!equal(await binding(),active))return null;
        writing=true;
        try{
          await panel.stateArgs.patch({previewRevision:revision,views:views.map(({id,mdx})=>({id,mdx}))});
          wrote++;
          const readback=await display(views.map(({interaction:_interaction,...row})=>row),revision);
          if(!readback.passed||readback.panelAttempt!==active.attempt||readback.buildKey!==active.build)
            throw new Error("Native owned audience view did not render");
          const operated=world.model&&world.probe!==undefined?await ports.probe(panel,world.model,world.probe):null;
          if(!equal(operated,interaction()))throw new Error("The native calculator output changed unexpectedly");
          if(!equal(record,await read())){
            await panel.stateArgs.patch({previewRevision:null,views:[]});
            return null;
          }
          receipt={revision,ids:views.map(({id})=>id),mdxDigests:readback.mdxDigests,interaction:operated};
          sent=structuredClone(prepared);
          return structuredClone(receipt);
        }finally{writing=false;}
      },
    },
  };
  function validAnswer(answer:AudienceAnswer|undefined){
    return !!answer&&typeof answer.text==="string"&&answer.text.length<=450&&!!answer.text.trim()&&
      equal(answer.facts,expectedAnswer)&&expectedAnswer.every(fact=>answer.text.includes(fact.value));
  }
  async function verify(raw:unknown,invocation?:InvocationObservations){
    const candidate=raw as AudienceReport|null;
    const report=candidate;
    const current=await read();
    const state=await panel.stateArgs.get<PanelState>();
    const prepared=sent?visual(sent):null;
    const rich=world.mode!=="plain";
    const observed=rich&&prepared&&receipt?await display(prepared,receipt.revision):!rich?await display([]):null;
    const operated=world.model&&world.probe!==undefined&&observed?.passed?await ports.probe(panel,world.model,world.probe):null;
    const checks={
      returnedAudienceReceipt:equal(report?.receipt,receipt),
      exactAudienceRecord:equal(record,current)&&equal(current,{...original,revision:sha256HexSyncText(originalBytes)}),
      appropriateAudienceFormat:rich ? !!prepared&&!!receipt : !sent&&!receipt,
      boundedGroundedAudienceAnswer:validAnswer(report?.answer),
      verifiedNativeAudienceRendering:!!observed?.passed&&observed.panelAttempt===active.attempt&&observed.buildKey===active.build&&
        (rich?!!prepared&&!!receipt&&wrote===1&&
          equal(observed.mdxDigests,receipt.mdxDigests)&&observed.rendered.revision===receipt.revision&&
          equal(state.views,prepared.map(({id,mdx})=>({id,mdx}))):
          !prepared&&!sent&&!receipt&&wrote===0&&
          observed.rendered.revision===null&&observed.rendered.ids.length===0&&equal(state,panelBefore)),
      verifiedAudienceInteraction:equal(operated,interaction())&&(!rich||equal(receipt?.interaction,operated)),
      preservedAudienceState:equal(await ports.head(),before)&&equal(await binding(),active),
    };
    const contract:SemanticOutcomeContract={effects:{checks:["exactAudienceRecord", "appropriateAudienceFormat", "verifiedNativeAudienceRendering", "verifiedAudienceInteraction", "preservedAudienceState"],rationale:"Actual native observations, scoped authority, persisted state and private artifact bytes establish the requested application effects."},returnedValue:{checks:["boundedGroundedAudienceAnswer"],required:true,rationale:"The requested domain findings or query result are validated independently of copied input evidence."},incidentalValues:{checks:["returnedAudienceReceipt"],rationale:"Receipt echoing is optional presentation; the actual retained artifact is verified through native state."}};

    return assessObservedApplicationOutcome({contextId:owner,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      report:report??null,observed},contract,raw,invocation,[{"checks":["boundedGroundedAudienceAnswer"],"rootPath":["answer"],"producerSourceSuffix":"chooseAudienceResponse/answerFromRecord.nl"}]);
  }
  async function qualify(){
    const record=await services.nativeAudienceResponse.readRecord();
    const choice={mode:world.mode,reason:"The exact user decision determines the useful response format."};
    const answer={facts:expectedAnswer,text:expectedAnswer.map(fact=>fact.value).join("; ")};
    const prepared=world.mode==="plain"?null:{presentation:referencePresentation(reference),modelId:world.model?.id??null};
    const rejected=await services.nativeAudienceResponse.render(record.id,"stale",prepared??{presentation:null,modelId:null})===null;
    const receipt=prepared?await services.nativeAudienceResponse.render(record.id,record.revision,prepared):null;
    const accepted=await verify({answer,receipt});
    const rejectsIncorrectApplicationReturn=!(await verify({answer:{facts:[],text:""},receipt})).outcomeDimensions.returnedValue.passed;
    return {...accepted,rejected,rejectsIncorrectApplicationReturn,passed:accepted.passed&&rejected&&rejectsIncorrectApplicationReturn};
  }
  return {services,verify,qualify,close};
}
