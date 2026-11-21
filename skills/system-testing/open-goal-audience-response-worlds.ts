import type { AudienceFact, AudienceMode, AudienceModel, AudienceSection } from "@workspace-skills/open-audience-response/types";
import type { PresentationWorld } from "./presentation-worlds.js";

type Card = { id: string; title: string; goal: string; source: string; facts: AudienceFact[]; answer: string[];
  mode: AudienceMode; section?: AudienceSection; expected?: PresentationWorld["expected"]; model?: AudienceModel;
  probe?: number; split?: "test" };
const fact=(id:string,value:string)=>({id,value});
const one=(id:string,ask:string,data:string):AudienceSection=>({id,ask,data,required:true});
const choice=(id:string,options:string[],selected:string):PresentationWorld["expected"]=>[{
  id,component:{component:"Choices",props:{id,options}},labels:options,
  interaction:{kind:"choice",choices:[selected],selected:[selected]}}];
const checklist=(id:string,items:string[],item:string):PresentationWorld["expected"]=>[{
  id,component:{component:"Checklist",props:{items}},labels:items,
  interaction:{kind:"checklist",item,before:"0/"+items.length,after:"1/"+items.length}}];
const chart=(id:string,x:string,y:string,type:"bar"|"line",data:Record<string,string|number>[]):PresentationWorld["expected"]=>[{
  id,component:{component:"Chart",props:{x,y,type,data}},labels:data.map(row=>String(row[x])),
  interaction:{kind:"chart-table",before:"Show table",after:"Show chart",
    cells:[[x,y],...data.map(row=>[String(row[x]),String(row[y])])]}}];

type CalculatorSeed=Omit<Card,"mode"|"section"|"expected"> & {model:AudienceModel;probe:number};
function calculator(row:CalculatorSeed):Card {
  const id=row.model.id;
  return {...row,mode:"calculator",section:one(id,row.goal,row.source),expected:[{id,status:"deferred",component:"Calculator"}]};
}
const cards:Card[]=[
  {id:"specific-approval-time",title:"Gallery return",goal:"What time did the Gallery return desk actually approve? I only need the time for a handoff text.",
    source:"Gallery return desk signed 17:20; previous shift suggested 17:00; no other times approved.",
    facts:[fact("approved time","17:20"),fact("earlier proposal","17:00")],answer:["approved time"],mode:"plain"},
  {id:"settled-comparison-no-controls",title:"Copper Labels",goal:"The Copper labels group finished the choice. Tell me which print material was approved and their reason, in a short note I can dictate.",
    source:"Signed print decision: linen stock because it can be stamped. Earlier trial used glossy card.",
    facts:[fact("material","linen stock"),fact("reason","can be stamped"),fact("trial","glossy card")],answer:["material","reason"],mode:"plain"},
  {id:"missing-measurement",title:"South ramp",goal:"Can we quote a reliable width for the south ramp? I need the fact or the exact reporting gap. Do not guess.",
    source:"Signed South ramp log only records 8 m length. No width was measured.",
    facts:[fact("width","No width was measured"),fact("length","8 m")],answer:["width"],mode:"plain"},
  {id:"one-computed-bill",title:"Frame receipt",goal:"I need the exact total from the settled invoice for four finished frames. No forecasting; I just need the amount.",
    source:"Receipt: base $8.00, four frames at $12.50 each, and settled total $58.00; signed and no optional quantities requested.",
    facts:[fact("total","$58.00"),fact("base","$8.00"),fact("each","$12.50")],answer:["total"],mode:"plain"},
  {id:"voice-safety-message",title:"Blue gate opening",goal:"Give me the confirmed route and gate codeword to dictate over the radio. Keep it to a sentence.",
    source:"Current approved field card: go via footbridge; say 'orchid'. Old vehicle route closed.",
    facts:[fact("route","footbridge"),fact("codeword","orchid")],answer:["route","codeword"],mode:"plain"},
  {id:"what-if-refuse-missing-deposit",title:"Table booking",goal:"Could you show how the total would move with more tables? If you don't have the fixed deposit, just tell me the missing input so I can get it.",
    source:"Tables cost $9.50 each; fixed deposit absent; quote owner hasn't confirmed whether a deposit exists.",
    facts:[fact("gap","The fixed deposit is unknown"),fact("per table","$9.50")],answer:["gap"],mode:"plain"},
  {id:"local-time-rules-before-showing",title:"Lift marker",goal:"Tell me the confirmed changeover time and its time zone. I need it for an accessible plain-text operations note.",
    source:"Approved changeover 09:40 CET. Do not infer a second zone from the date.",
    facts:[fact("time","09:40 CET")],answer:["time"],mode:"plain"},
  {id:"presence-with-no-signoff",title:"Quiet room",goal:"Is the quiet room arrangement actually signed off? A status sentence is enough.",
    source:"Retained memo is a suggestion signed by its author for drafting only. Operations approval is absent.",
    facts:[fact("approval","Operations approval is absent")],answer:["approval"],mode:"plain"},
  {id:"pack-and-tick-in-field",title:"Rain inspection",goal:"Set up a compact arrival checklist I can tick off at the wet-weather inspection. Use the retained steps, including the ramp mat.",
    source:"Arrival sequence: Set out ramp mat; Test radio; Record gate time.",
    facts:[fact("opening item","Set out ramp mat")],answer:["opening item"],mode:"catalog",
    section:one("weather-arrival","Make the actual recorded actions an interactive checklist.","Set out ramp mat; Test radio; Record gate time."),
    expected:checklist("weather-arrival",["Set out ramp mat","Test radio","Record gate time"],"Test radio")},
  {id:"choose-option-in-a-talk",title:"Print sample choice",goal:"I want listeners to pick which of the approved three paper finishes we should sample first. Let each reader choose one option.",
    source:"Allowed sample finishes: Matte, Satin, Rough. None selected.",
    facts:[fact("status","No finish is selected")],answer:["status"],mode:"catalog",
    section:one("print-sample","Offer exactly these three mutually exclusive choices with id print-sample.","Matte; Satin; Rough"),
    expected:choice("print-sample",["Matte","Satin","Rough"],"Satin")},
  {id:"show-trend-and-exact-data",title:"Week one intake",goal:"Help me spot the pattern in this week's daily intake and switch to the exact values for review.",
    source:"Intake Mon 7, Tue 12, Wed 9, Thu 15. Thu is highest.",
    facts:[fact("peak","Thu 15")],answer:["peak"],mode:"catalog",
    section:one("intake-trend","Plot the daily trend and keep exact data.","Day,Count\nMon,7\nTue,12\nWed,9\nThu,15"),
    expected:chart("intake-trend","Day","Count","line",[{Day:"Mon",Count:7},{Day:"Tue",Count:12},{Day:"Wed",Count:9},{Day:"Thu",Count:15}])},
  {id:"one-dimension-many-options",title:"Bin counts",goal:"Let me compare the observed bin counts across the three collection points, with a way to inspect precise values.",
    source:"Annex 4, Dock 11, Garden 16. Garden holds the most.",
    facts:[fact("maximum","Garden 16")],answer:["maximum"],mode:"catalog",
    section:one("bin-counts","Compare categorical counts in a bar chart with its accessible table.","Point,Count\nAnnex,4\nDock,11\nGarden,16"),
    expected:chart("bin-counts","Point","Count","bar",[{Point:"Annex",Count:4},{Point:"Dock",Count:11},{Point:"Garden",Count:16}])},
  calculator({id:"shift-cost-crew-size",title:"Shift staffing",goal:"Let me try different crew sizes for the evening shift and see the total before I decide. Use the actual four-to-nine range.",
    source:"Shift fee $36.00 plus $18.50 per staff member. Whole crew sizes 4 through 9 inclusive; initial size 5, $128.50.",
    facts:[fact("initial total","$128.50")],answer:["initial total"],probe:8,
    model:{id:"shift-cost",title:"Shift cost",inputLabel:"Crew size",outputLabel:"Total",baseCents:3600,unitCents:1850,divisor:1,initial:5,min:4,max:9}}),
  calculator({id:"divide-ticket-fees",title:"Courier ticket split",goal:"Can we try several ticket counts and see how the fixed two-person share changes? Use the fare sheet and keep the split fixed.",
    source:"Total booking $20.00 plus $7.25 per ticket, divided equally between two payers. Try 1 through 6 tickets. Initial 2 gives $17.25 per payer.",
    facts:[fact("initial share","$17.25")],answer:["initial share"],probe:5,
    model:{id:"ticket-fee",title:"Ticket cost split",inputLabel:"Tickets",outputLabel:"Per payer",baseCents:2000,unitCents:725,divisor:2,initial:2,min:1,max:6}}),
  calculator({id:"copy-price-bracket",title:"Outreach print quote",goal:"I want to check several quantities against a print budget before choosing. Give me a reversible way to change the whole-copy count.",
    source:"One color-proof fee of $25.00 plus $0.45 per copy, allowed quantities 20–80, default 40. Initial total $43.00.",
    facts:[fact("initial quote","$43.00")],answer:["initial quote"],probe:75,
    model:{id:"printing-cost",title:"Print quote",inputLabel:"Copies",outputLabel:"Total quote",baseCents:2500,unitCents:45,divisor:1,initial:40,min:20,max:80}}),
  {id:"approved-partition",title:"Moss charter",goal:"Which part of the Moss charter actually applies to Saturday? Keep it short enough to quote, with the precise exception.",
    source:"Only the open-gate provision applies on Saturdays; subject to venue closure.",
    facts:[fact("provision","open-gate provision"),fact("exception","subject to venue closure")],answer:["provision","exception"],mode:"plain"},
  {id:"distinct-handoff-conditions",title:"Loop restoration",goal:"What two things have to be true before the Loop can reopen? Write a short answer for a pager that cannot show controls.",
    source:"Signed desk ruling: headcount cleared and technician present. Restore must wait for both.",
    facts:[fact("condition one","headcount cleared"),fact("condition two","technician present")],answer:["condition one","condition two"],mode:"plain",split:"test"},
  {id:"checklist-verifiable-at-night",title:"Closing checks",goal:"Let the evening team mark the three pre-close checks done as they walk around. Keep Wi-Fi shutdown in its assigned place in the list.",
    source:"Lock archive cabinet; Switch off guest Wi-Fi; Record emergency phone test.",
    facts:[fact("network action","Switch off guest Wi-Fi")],answer:["network action"],mode:"catalog",split:"test",
    section:one("closing-checks","Make the three ordered retained checks tickable.","Lock archive cabinet; Switch off guest Wi-Fi; Record emergency phone test."),
    expected:checklist("closing-checks",["Lock archive cabinet","Switch off guest Wi-Fi","Record emergency phone test"],"Switch off guest Wi-Fi")},
  calculator({id:"held-divide-shared-supplies",title:"Workshop supplies per partner",goal:"Let us try different batch sizes at this meeting and report the share per partner, keeping the three-way split fixed.",
    source:"Shared setup $30.00 plus $6.65 for each batch. Three partners split it equally. Whole batches 2 through 8. For 3 batches initial per partner $16.65.",
    facts:[fact("initial share","$16.65")],answer:["initial share"],probe:7,split:"test",
    model:{id:"supply-share",title:"Supplies per partner",inputLabel:"Batches",outputLabel:"Partner share",baseCents:3000,unitCents:665,divisor:3,initial:3,min:2,max:8}}),
  {id:"held-empty-dimensions",title:"Drying position",goal:"Is the tall crate proven to fit the drying alcove? Give me the retained answer and the missing measurement if fit cannot be verified.",
    source:"Crate height 1.4 m. Alcove ceiling clearance not measured.",
    facts:[fact("gap","Alcove ceiling clearance not measured"),fact("crate height","1.4 m")],answer:["gap","crate height"],mode:"plain",split:"test"},
  {id:"held-inspection-period-selection",title:"Plant room options",goal:"Ask each person to pick which of these valid inspection periods they would like to volunteer for. Don’t mark anything scheduled.",
    source:"Review choices: Dawn group, Noon group, Dusk group. No assignments are scheduled yet.",
    facts:[fact("schedule status","No assignments are scheduled yet")],answer:["schedule status"],mode:"catalog",split:"test",
    section:one("inspection-period","Offer precisely one choice with id inspection-period without scheduling a shift.","Dawn group; Noon group; Dusk group"),
    expected:choice("inspection-period",["Dawn group","Noon group","Dusk group"],"Dusk group")},
  {id:"held-fixed-computation-no-modes",title:"Settled furniture quote",goal:"Give me the signed amount for the agreed eight stools. A one-line figure for billing is all I need.",
    source:"The final eight-stool invoice total is $264.80. Preliminary six-stool estimate $200.00 discarded.",
    facts:[fact("final invoice","$264.80"),fact("discarded estimate","$200.00")],answer:["final invoice"],mode:"plain",split:"test"},
];
export type OpenAudienceWorld=Card&{kind:"audience-response"; workspace:"system"; sourceGroup:string};
export const openAudienceResponseWorlds:OpenAudienceWorld[]=cards.map(row=>({...row,id:"audience-response-"+row.id,
  workspace:"system",kind:"audience-response",sourceGroup:"vibestudio:audience-response:"+row.id}));
export const openAudienceResponseRequiresUnits=["skills/open-user-goal","skills/open-audience-response","skills/visualize"];
