import type {GardenCriterion, GardenTransition, Horizon, PortfolioDecision, PortfolioFinding, PortfolioPlan, RealmCondition, RealmCriterion, RealmTrend} from "@workspace-skills/open-demo-portfolio/types";

export type GardenAction = "pip"|"sol"|number;
type Draft = {
  id:string; goal:string; opening?:GardenAction[]; garden:GardenAction[]; realm?:number; drift?:number;
  card?:{title:string;earlier:string;current:string}; plan:Omit<PortfolioPlan,"criteriaBasis">;
  readings:[PortfolioFinding["decision"][],PortfolioFinding["decision"][]]; status:PortfolioDecision["status"];
  words:string[]; split?:"test";
};
const hab=(kind:"meets-needs"|"is-home"|"settled",resident:string,home:string):GardenCriterion=>({kind:"habitat",check:{kind,resident,home}});
const move=(check:GardenTransition):GardenCriterion=>({kind:"transition",check});
const stat=(check:RealmCondition,basis:"saved"|"forecast"="saved"):RealmCriterion=>({kind:"settlement",basis,check});
const change=(check:RealmTrend,basis:"saved"|"forecast"="forecast",assertCommitted=false):RealmCriterion=>
  ({kind:"compare",basis,check,assertCommitted});
const reserve=(region:string,amount:number):RealmCondition=>({kind:"region-grain-at-least",region,amount});
const cargo=(route:string):RealmCondition=>({kind:"cargo-under-capacity",route});
const day=move({kind:"day-advanced"}),phase=move({kind:"phase-advanced"}),weather=move({kind:"weather-changed"});
const discovery=move({kind:"new-discovery"});
const debt={kind:"has-debt"} as const, reopening={kind:"crossing-reopened",route:"east-crossing"} as const;
const plan=(garden:GardenCriterion[],realm:RealmCriterion[],months:Horizon|null=null,note:PortfolioPlan["note"]="none"):Draft["plan"]=>
  ({garden,realm,months,note});
const S="supported", C="contradicted", U="not-observed";
const rows:Draft[]=[
  {id:"dawn-and-actual-harbor-reserve",garden:[2],realm:1,
    goal:"Can we pass the Examples demo pair today? The garden needs to have reached a new day and the saved Regency Harbor needs at least 18 grain. Record the decision in a private handoff.",
    plan:plan([day],[stat(reserve("harbor",18))],null,"decision"),readings:[[S],[S]],status:"ready",words:["day","harbor"]},
  {id:"one-phase-cannot-pass-dawn",garden:[1],realm:2,
    goal:"Hold the paired demo if Grimoire has only changed phase without crossing dawn. Also confirm the saved East Crossing cargo is within its measured capacity. Write a private handoff only if both gates pass.",
    plan:plan([phase,day],[stat(cargo("east-crossing"))],null,"ready-only"),readings:[[S,C],[S]],status:"blocked",words:["dawn","crossing"]},
  {id:"recognition-and-projected-port-capacity",garden:["pip",2,"pip"],realm:1,
    goal:"For the two Examples demos, verify that Pip has newly started recognizing the caretaker and projected Port Road cargo stays within capacity after one month. Leave a private ready note if both checks pass.",
    plan:plan([move({kind:"recognized",resident:"pip"})],[stat(cargo("port-road"),"forecast")],1,"ready-only"),
    readings:[[S],[S]],status:"ready",words:["pip","project"]},
  {id:"repeat-visit-and-untallied-ferry",garden:["pip","pip"],
    goal:"The recorded demo run shows two taps on Pip and a route marker for East Ferry. Check whether recognition actually began and whether the saved ferry cargo is measurable within its capacity. I want an audit, even if readiness fails, in private scratch.",
    plan:plan([move({kind:"recognized",resident:"pip"})],[stat(cargo("east-ferry"))],null,"decision"),
    readings:[[C],[U]],status:"blocked",words:["pip","ferry"]},
  {id:"discovery-and-unfinished-crossing",garden:[9],realm:2,
    goal:"Make a private triage note for the Examples pair. Check whether there is a new garden discovery and whether Regency projects a fully reopened East Crossing two months out. If one demo is behind, identify which.",
    plan:plan([discovery],[stat(reopening,"forecast")],2,"decision"),readings:[[S],[C]],status:"blocked",words:["discovery","crossing"]},
  {id:"rain-local-support-versus-treasury-projection",garden:[7],realm:3,
    goal:"For the rehearsal pairing, check whether the Grimoire weather changed and the projected Regency treasury grows within one month. I only need to know whether both acceptance checks are supported.",
    plan:plan([weather],[change({kind:"treasury-grew"})],1),readings:[[S],[C]],status:"blocked",words:["weather","treasury"]},
  {id:"home-does-not-guarantee-comfort",garden:[],realm:2,
    goal:"The Grimoire caption says the hollow is Sol's home and meets all his public comfort needs. Verify both independently. The Regency side needs a saved Crownlands reserve of at least 12 grain. Write the complete private review.",
    plan:plan([hab("is-home","sol","hollow"),hab("meets-needs","sol","hollow")],[stat(reserve("crownlands",12))],null,"decision"),
    readings:[[S,C],[S]],status:"blocked",words:["hollow","crownlands"]},
  {id:"unseen-neighbor-and-grounded-balance",garden:[1],realm:2,
    goal:"We want to show Moss as a settled Grimoire resident in the hollow and enough saved Eastbank grain, at least 60. See whether the portfolio has evidence for both before the read-only demo review.",
    plan:plan([hab("settled","moss","hollow")],[stat(reserve("eastbank",60))]),readings:[[U],[S]],status:"incomplete",words:["moss","eastbank"]},
  {id:"unchanged-weather-after-full-day",garden:[4],realm:2,
    goal:"Review the Examples side-by-side time lapse. The garden needs a new calendar day, and I want to know separately whether the final weather actually changed. Regency must show its two-month projected crossing cargo within capacity. Keep a private assessment.",
    plan:plan([day,weather],[stat(cargo("east-crossing"),"forecast")],2,"decision"),
    readings:[[S,C],[S]],status:"blocked",words:["weather","project"]},
  {id:"saved-change-is-not-projected-population",garden:["sol",2,"sol"],realm:10,drift:1,
    goal:"For the closed rehearsal evidence, confirm Sol's attachment grew, then verify from two saved Regency ledgers that Harbor population has already fallen. Put both confirmed changes in a private ready note.",
    plan:plan([move({kind:"attachment-grew",resident:"sol"})],[change({kind:"population-fell",region:"harbor"},"saved")],null,"ready-only"),
    readings:[[S],[S]],status:"ready",words:["sol","harbor"]},
  {id:"recognition-is-not-relocation",opening:[7],garden:["pip",3,"pip"],realm:1,
    goal:"Can the paired demo describe Pip as newly relocated and Regency as maintaining at least 13 Crownlands grain in its one-month projection? The Grimoire note about a visit should not settle a different claim.",
    plan:plan([move({kind:"relocated",resident:"pip"})],[stat(reserve("crownlands",13),"forecast")],1),
    readings:[[C],[S]],status:"blocked",words:["pip","relocat"]},
  {id:"garden-settled-realm-not-closed-out",garden:[7],realm:3,
    goal:"Verify Sol is settled in the old hollow. Then check the claim that the two-month Eastbank grain projection is already a completed increase. Give me a private note on what the two demos can actually claim.",
    plan:plan([hab("settled","sol","hollow")],[change({kind:"regional-grain-grew",region:"eastbank"},"forecast",true)],2,"decision"),
    readings:[[S],[U]],status:"incomplete",words:["settled","commit"]},
  {id:"no-historical-forecast-endorsement",garden:[2],realm:6,
    goal:"The press rehearsal is private and I only want a ready handoff if both claims are defensible. Check that the garden has crossed a day boundary and that the predicted treasury growth a month out really counts as history.",
    plan:plan([day],[change({kind:"treasury-grew"},"forecast",true)],1,"ready-only"),readings:[[S],[U]],status:"incomplete",words:["forecast","history"]},
  {id:"opened-route-claim-and-retained-discovery",opening:[9],garden:[1],realm:3,
    goal:"Today's Grimoire card still shows a keepsake. Check whether this round added any discovery, and independently check whether saved East Crossing has reopened. Return a private negative or positive decision.",
    plan:plan([discovery],[stat(reopening)],null,"decision"),readings:[[C],[C]],status:"blocked",words:["discovery","crossing"]},
  {id:"card-latest-harbor-floor",garden:[2],realm:2,drift:1,
    card:{title:"Harbor demo acceptance",earlier:"Accept a new Grimoire day and at least 10 grain in the saved Harbor.",
      current:"Current acceptance: demonstrate a new Grimoire day and at least 8 grain in the latest saved Harbor."},
    goal:"Use the latest Harbor demo acceptance card to check both Examples applications. Write a private ready note only if the revised gates are satisfied.",
    plan:plan([day],[stat(reserve("harbor",8))],null,"ready-only"),readings:[[S],[C]],status:"blocked",words:["card","harbor"]},
  {id:"card-corrects-target-habitat-and-route",garden:[],realm:1,
    card:{title:"Installation tour gates",earlier:"Check that Pip lives on the river bank and North Ferry cargo is at capacity.",
      current:"Check Pip's actual home in the moonflower patch (meadow) and confirm saved East Ferry cargo is within measured capacity."},
    goal:"The Examples installation tour has a corrected acceptance card. Resolve the current named habitat and route, then leave a private note if both live demos are ready.",
    plan:plan([hab("is-home","pip","meadow")],[stat(cargo("east-ferry"))],null,"ready-only"),
    readings:[[S],[S]],status:"ready",words:["pip","card"]},
  {id:"card-replaces-settlement-with-projection",garden:[1],realm:4,
    card:{title:"Projection rehearsal",earlier:"Check garden day change and verify currently recorded Eastbank has 100 grain.",
      current:"Check a Grimoire phase advance and project Eastbank at least 100 grain one month out."},
    goal:"Read the updated Projection rehearsal card for our live Examples pairing. Stage a private readiness note on the current criteria whatever they show.",
    plan:plan([phase],[stat(reserve("eastbank",100),"forecast")],1,"decision"),readings:[[S],[S]],status:"ready",words:["phase","project"]},
  {id:"card-diagnostic-cannot-certify-unseen-place",garden:[2],realm:3,
    card:{title:"Specific stages run sheet",earlier:"Check that Pip lives at the moonflower patch and saved Eastbank has 60 grain.",
      current:"Check that Pip lives at Blue Fen (blue-fen) and saved Eastbank has at least 60 grain."},
    goal:"Inspect the current Specific stages run sheet for the two demos. Leave a private diagnostic even if the new garden placement claim is unobservable.",
    plan:plan([hab("is-home","pip","blue-fen")],[stat(reserve("eastbank",60))],null,"decision"),
    readings:[[U],[S]],status:"incomplete",words:["fen","eastbank"]},
  {id:"seasonal-contrast-has-no-fiscal-surplus",garden:[2],realm:9,
    goal:"Before we demo, verify Grimoire's weather changed. Then check both the latest positive monthly settlement claim and the booked debt claim from Regency, keeping a cash deficit distinct. Dry-run this portfolio check without a handoff.",
    plan:plan([weather],[stat({kind:"net-positive"}),stat(debt)]),readings:[[S],[C,C]],status:"blocked",words:["debt","weather"]},
  {id:"single-visit-enough-for-attachment",garden:["sol"],realm:0,
    goal:"Verify that the first Grimoire contact increased Sol's attachment while the projected East Crossing still shows cargo within capacity at month two. Build a private ready handoff if that's sufficient for both demos.",
    plan:plan([move({kind:"attachment-grew",resident:"sol"})],[stat(cargo("east-crossing"),"forecast")],2,"ready-only"),
    readings:[[S],[S]],status:"ready",words:["sol","capacity"]},
  {id:"held-card-tightens-discovery-gate",garden:[8],realm:3,split:"test",
    card:{title:"Museum demo checks",earlier:"The garden must feel different and saved Eastbank should have 70 grain.",
      current:"Require a newly recorded Grimoire discovery and a saved Eastbank reserve of at least 70 grain."},
    goal:"We need a read-only readiness call for the Museum pairing. Find the latest acceptance card and state which of the two demos misses its current gate.",
    plan:plan([discovery],[stat(reserve("eastbank",70))]),readings:[[C],[S]],status:"blocked",words:["discovery","eastbank"]},
  {id:"held-card-missing-region-not-substitutable",garden:[7],realm:4,split:"test",
    card:{title:"Release desk pairing",earlier:"Sol settled in the hollow and at least 70 saved Eastbank grain.",
      current:"Sol settled in the hollow and at least 70 grain in the saved Westbank row."},
    goal:"Use the current Release desk pairing card without substituting a nearby place. File a local ready note only if both Grimoire and Regency can support it.",
    plan:plan([hab("settled","sol","hollow")],[stat(reserve("westbank",70))],null,"ready-only"),readings:[[S],[U]],
    status:"incomplete",words:["westbank","sol"]},
  {id:"held-projection-bounded-by-current-month",garden:["pip",2,"pip"],realm:1,drift:1,split:"test",
    goal:"For the joint tutorial, require Pip's new recognition and at least 72 grain in Eastbank after one projected month from the latest saved realm. Write the approved private handoff if both pass.",
    plan:plan([move({kind:"recognized",resident:"pip"})],[stat(reserve("eastbank",72),"forecast")],1,"ready-only"),
    readings:[[S],[S]],status:"ready",words:["pip","eastbank"]},
  {id:"held-quiet-phase-versus-rail-metadata",garden:[],realm:2,split:"test",
    goal:"The showcase brief expects an elapsed garden phase and within-capacity traffic on the North Ferry in saved Regency. Inspect both gaps and keep the draft decision private.",
    plan:plan([phase],[stat(cargo("north-ferry"))],null,"decision"),readings:[[C],[U]],status:"blocked",words:["phase","ferry"]},
  {id:"held-visit-early-and-reserve-persisted",opening:["pip"],garden:["pip",1],realm:2,drift:1,split:"test",
    goal:"Check if a second Pip visit since the opening demo receipt actually increased attachment, and if saved Crownlands grain remains at least eight. Keep a private decision that identifies any unresolved acceptance criterion.",
    plan:plan([move({kind:"attachment-grew",resident:"pip"})],[stat(reserve("crownlands",8))],null,"decision"),
    readings:[[C],[S]],status:"blocked",words:["pip","crownlands"]},
  {id:"held-ready-snapshot-versus-treasury-improvement",garden:[9],realm:8,split:"test",
    goal:"We need a Grimoire discovery plus a real treasury increase in the newest one-month Regency forecast. Compare the future balance to the saved one and give the decision for both without writing a note.",
    plan:plan([discovery],[change({kind:"treasury-grew"})],1),readings:[[S],[C]],status:"blocked",words:["discovery","treasury"]},
];
export type OpenPortfolioWorld = Draft & {kind:"demo-portfolio";workspace:"examples";sourceGroup:string};
export const openPortfolioWorlds:OpenPortfolioWorld[]=rows.map(row=>({
  ...row,id:`demo-portfolio-${row.id}`,kind:"demo-portfolio",workspace:"examples",sourceGroup:`vibestudio:examples:paired-demo:${row.id}`,
}));
export const openPortfolioRequiresUnits=["skills/open-user-goal","skills/open-demo-portfolio","skills/examples-review",
  "skills/examples-review-fixtures","skills/scratch-handoff-bindings","panels/grimoire","panels/regency-fixture-player","workers/grimoire-world","workers/regency-realm","workers/pubsub-channel"];
