import {beforeEach,expect,it,vi} from "vitest";
import {sha256Hex} from "@vibestudio/content-addressing";
import {prepareOpenPdfInspection} from "./open-goal-pdf-managed.js";
import type {OpenPdfWorld} from "./open-goal-pdf-worlds.js";

const stored=vi.hoisted(()=>new Map<string,string>());
vi.mock("@workspace/runtime",()=>({
  fs:{mkdtemp:async()=>"owned-pdf",writeFile:async(path:string,text:string)=>{stored.set(path,text);},readdir:async()=>["source.pdf"]},
  vcs:{status:async()=>({mainEventId:"main",workingHead:{kind:"event",eventId:"working"}})},
  rpc:{call:async(_target:string,_method:unknown,args:unknown[])=>{
    const bytes=new TextEncoder().encode(stored.get(String(args[0]))!);
    return {base64:Buffer.from(bytes).toString("base64"),start:0,end:bytes.length,totalBytes:bytes.length,truncated:false};
  }},
  extensions:{invoke:async(_extension:string,method:string,args:unknown[])=>{
    if(method!=="probe")throw new Error(`Unexpected PDF operation: ${method}`);
    return {document:{digest:sha256Hex(args[0] as Uint8Array),pageCount:1,encrypted:false},selectedPages:[1],engines:[]};
  }},
}));
beforeEach(()=>stored.clear());

it("qualifies a PDF reference and its rejected answer through the public outcome dimensions",async()=>{
  const world:OpenPdfWorld={kind:"pdf",workspace:"examples",id:"dimension-composition",goal:"Inspect the selected original PDF.",sourceGroup:"dimension-composition",documents:{"source.pdf":[{rows:[["Original PDF"]]}]},expected:{document:"source.pdf",pages:[1],render:[],action:"preserve-text",evidenceTerms:[]}};
  const prepared=await prepareOpenPdfInspection("owned-context",world);
  const {outcome,verification}=await prepared.reference();
  expect(verification.passed).toBe(true);
  expect(verification.checks.rejectsUnverifiedReport).toBe(true);
  const negative=await prepared.verify({...outcome,document:{...outcome.document,name:"invented.pdf"}});
  expect(negative.outcomeDimensions.returnedValue.passed).toBe(false);
  expect(negative.outcomeDimensions.effects.passed).toBe(true);
  expect(negative.checks.exactSelection).toBe(false);
});
