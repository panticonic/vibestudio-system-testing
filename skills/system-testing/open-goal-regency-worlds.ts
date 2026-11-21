import type { Horizon, RegencyClaim, RegencyDecision, RegencyPlan, RealmCurrentCheck, RealmTrendCheck, Source } from "@workspace-skills/open-regency-briefing/types";

type RealmOpening = { month:number; between?:Horizon; pending?:boolean };
type Scenario = {
  id:string; goal:string; realmTitle:string; memo?:string; initial:RealmOpening; plan:RegencyPlan; action:RegencyDecision["action"];
  expected:("supported"|"contradicted"|"not-observed")[]; terms:string[]; split?:"test";
};
type Draft = Omit<Scenario,"realmTitle">;
const settle=(source:Source,check:RealmCurrentCheck):RegencyClaim=>({kind:"settlement",source,check});
const trend=(from:Source,to:Source,check:RealmTrendCheck,assertCommitted=false):RegencyClaim=>({kind:"compare",from,to,check,assertCommitted});
const check=(horizons:Horizon[],claims:RegencyClaim[],opts:Partial<Omit<RegencyPlan,"horizons"|"claims">>={}):RegencyPlan=>
  ({horizons,claims,localNote:false,advance:null,treasuryFloor:null,...opts});
const grain=(region:string,amount:number):RealmCurrentCheck=>({kind:"region-grain-at-least",region,amount});
const cargo=(route:string):RealmCurrentCheck=>({kind:"cargo-under-capacity",route});
const crossing:RealmCurrentCheck={kind:"crossing-reopened",route:"east-crossing"};
const debt:RealmCurrentCheck={kind:"has-debt"};
const surplus:RealmCurrentCheck={kind:"net-positive"};
const growth:RealmTrendCheck={kind:"treasury-grew"};
const drafts:Draft[]=[
  {id:"opening-capacity-needs-settlement",initial:{month:0},
    goal:"In Regency, someone read an opening map marker as recorded East Ferry cargo. Compare whether cargo is within capacity in the opening ledger and after one projected month. Tell me which one can actually be checked.",
    plan:check([1],[settle("opening",cargo("east-ferry")),settle(1,cargo("east-ferry"))]),action:"report",
    expected:["not-observed","supported"],terms:["cargo","project"]},
  {id:"paid-ferry-versus-unused-ferry",initial:{month:2},
    goal:"Before asking for a ferry subsidy in Regency, check the saved claim that East Ferry was being paid to sit idle, then see whether ferry cargo stays within measured capacity two months out. Leave a private council note.",
    plan:check([2],[settle("current",{kind:"subsidy-paid-and-idle",route:"east-ferry"}),settle(2,cargo("east-ferry"))],{localNote:true}),action:"stage",
    expected:["contradicted","supported"],terms:["subsid","capacity"]},
  {id:"works-progress-versus-route-flow",initial:{month:1},
    goal:"The Regency route summary shows East Crossing usage. Check whether actual repair progress grew from the saved ledger to a two-month projection, then test whether the crossing is projected fully reopened.",
    plan:check([2],[trend("current",2,{kind:"route-works-progressed",route:"east-crossing"}),settle(2,crossing)]),action:"report",
    expected:["contradicted","contradicted"],terms:["progress","crossing"]},
  {id:"ledger-still-solvent-though-loss",initial:{month:3},
    goal:"For this Regency council, prepare a private note on whether the latest month closed with a surplus and whether there is already booked debt. The note should distinguish cash and the monthly result.",
    plan:check([],[settle("current",surplus),settle("current",debt)],{localNote:true}),action:"stage",
    expected:["contradicted","contradicted"],terms:["debt","surplus"]},
  {id:"actual-deficit-not-booked-debt",initial:{month:9},
    goal:"Our Regency balance has crossed zero. Please review the saved ledger for booked debt and a positive month and make a private note recording both separately.",
    plan:check([],[settle("current",debt),settle("current",surplus)],{localNote:true}),action:"stage",
    expected:["contradicted","contradicted"],terms:["debt","balance"]},
  {id:"crownlands-threshold-after-new-return",initial:{month:3,between:1},
    goal:"A new Regency account return may arrive during review. Check whether Crownlands is at or above five grain in the opening receipt and in the newest saved receipt. Record the difference privately.",
    plan:check([],[settle("opening",grain("crownlands",5)),settle("current",grain("crownlands",5))],{localNote:true}),action:"stage",
    expected:["supported","contradicted"],terms:["crownlands","five"]},
  {id:"eastbank-will-grow-while-port-depletes",initial:{month:2},
    goal:"In Regency, compare Eastbank's grain against today's saved amount after three forecast months. Check the projected Harbor separately for at least four grain and explain the contrast.",
    plan:check([3],[trend("current",3,{kind:"regional-grain-grew",region:"eastbank"}),settle(3,grain("harbor",4))]),action:"report",
    expected:["supported","contradicted"],terms:["eastbank","harbor"]},
  {id:"two-horizons-different-market-service",initial:{month:1},
    goal:"Check the Regency Port Road at one and three forecast months. Is recorded projected cargo within the measured capacity at each horizon, and is it proper to say the road carries cargo in both of them?",
    plan:check([1,3],[settle(1,cargo("port-road")),settle(3,cargo("port-road"))]),action:"report",
    expected:["supported","supported"],terms:["cargo","port"]},
  {id:"forecast-should-not-enter-historical-budget",initial:{month:7},
    memo:"Draft finance minutes: The forecasted increase in treasury two months from this basis is a committed result.",
    goal:"The finance page of the saved Regency draft minutes seems to misstate what has actually settled. Read the draft claim in the council file, check it against current records and hold it if its source is only a projection.",
    plan:check([2],[trend("current",2,growth,true)]),action:"hold",
    expected:["not-observed"],terms:["forecast","commit"]},
  {id:"named-route-absent-from-book",initial:{month:4},
    goal:"The Regency market steward cited a North Ferry capacity result. Check that route against a one-month forecast and contrast it with the actual East Ferry before relying on the steward's claim.",
    plan:check([1],[settle(1,cargo("north-ferry")),settle(1,cargo("east-ferry"))]),action:"report",
    expected:["not-observed","supported"],terms:["north","east"]},
  {id:"harbor-population-stress-already-settled",initial:{month:10,between:1},
    goal:"Use the opening and latest saved Regency accounts to check whether the Harbor population already fell. Keep any two-month projected Harbor population change separate, then stage a private handoff of both findings.",
    plan:check([2],[trend("opening","current",{kind:"population-fell",region:"harbor"}),trend("current",2,{kind:"population-fell",region:"harbor"})],{localNote:true}),
    action:"stage",expected:["supported","supported"],terms:["harbor","project"]},
  {id:"far-horizon-outside-contract",initial:{month:4},
    goal:"I need a six-month Regency preview with the actual engine's projected treasury. If that horizon is unavailable, leave the calendar unchanged and tell me what limit the installed workflow supports.",
    plan:check([],[]),action:"hold",expected:[],terms:["month","three"]},
  {id:"near-horizon-clears-treasury-floor",initial:{month:2},
    goal:"In Regency, check for outstanding debt after a one-month preview. If none is booked and the projected treasury is at least 70 crowns, advance exactly one month in this private realm.",
    plan:check([1],[settle(1,debt)],{advance:1,treasuryFloor:70}),action:"advance",expected:["contradicted"],terms:["debt","treasury"]},
  {id:"capital-threshold-protects-two-month-advance",initial:{month:3},
    goal:"Advance our Regency realm by exactly two months only if the projection keeps the treasury at 50 crowns or above. Also tell the council whether the second projected month runs a surplus.",
    plan:check([2],[settle(2,surplus)],{advance:2,treasuryFloor:50}),action:"hold",expected:["contradicted"],terms:["50","treasury"]},
  {id:"current-pending-blocks-authorized-next-turn",initial:{month:3,pending:true},
    goal:"If the Regency council is clear, advance one month once the preview confirms the next month has at least 50 crowns remaining. Read the latest council status before you try another turn.",
    plan:check([1],[],{advance:1,treasuryFloor:50}),action:"hold",expected:[],terms:["pending","turn"]},
  {id:"month-advance-and-observed-handoff",initial:{month:0},
    goal:"For the private Regency tutorial, forecast three months and check that East Crossing cargo remains within capacity. If the projected treasury is at least 75 crowns, advance those three months and leave a private note with the new committed ledger.",
    plan:check([3],[settle(3,cargo("east-crossing"))],{advance:3,treasuryFloor:75,localNote:true}),action:"advance",expected:["supported"],terms:["cargo","commit"]},
  {id:"changed-basis-after-draft-budget",initial:{month:6,between:1},
    memo:"Reserve desk draft for the opening receipt: after it closes, consider another one-month advance only if the projected balance is at least ten crowns.",
    goal:"The Regency reserve desk may have closed another month since its first receipt. Compare saved treasury growth between those receipts, then apply the one-month authority and floor in the saved reserve desk draft rather than trusting its basis.",
    plan:check([1],[trend("opening","current",growth)],{advance:1,treasuryFloor:10}),action:"hold",expected:["contradicted"],terms:["treasury","10","draft"]},
  {id:"compare-two-forecasts-no-lineage-upgrade",initial:{month:4},
    goal:"Contrast Eastbank's grain at the one-month and three-month Regency projections. Show the forecast comparison for the council but leave its year and accounting state untouched.",
    plan:check([1,3],[trend(1,3,{kind:"regional-grain-grew",region:"eastbank"})]),action:"report",expected:["supported"],terms:["eastbank","forecast"]},
  {id:"current-pending-ledger-still-usable",initial:{month:5,pending:true},
    goal:"A Regency narrative response is still pending, but I only need a private note from the settled month. Check the current Harbor ledger for at least one grain and identify the pending work as separate.",
    plan:check([],[settle("current",grain("harbor",1))],{localNote:true}),action:"stage",expected:["contradicted"],terms:["harbor","pending"]},
  {id:"held-unmet-operating-prerequisite",initial:{month:1},split:"test",
    goal:"In the Regency training save, check a two-month projection for a fully reopened East Crossing. Advance those two months only if it reopens and the treasury stays at or above 70 crowns.",
    plan:check([2],[settle(2,crossing)],{advance:2,treasuryFloor:70}),action:"hold",expected:["contradicted"],terms:["crossing","open"]},
  {id:"held-negative-treasury-same-debt-class",initial:{month:8},split:"test",
    goal:"Our Regency audit tracks the difference between booked debt and cash. Check debt in the saved ledger and a one-month projection, and describe if cash itself is forecast to cross zero. Keep the report read-only.",
    plan:check([1],[settle("current",debt),settle(1,debt)]),action:"report",expected:["contradicted","contradicted"],terms:["debt","zero"]},
  {id:"held-equality-qualifies-bounded-advance",initial:{month:3},split:"test",
    goal:"The Regency clerk authorized one month if the preview's treasury is at least 61.8 crowns, including an exact match. Please check the authorized inequality and carry out that one move only when it qualifies.",
    plan:check([1],[],{advance:1,treasuryFloor:61.8}),action:"advance",expected:[],terms:["61.8","month"]},
  {id:"held-no-forecast-needed-for-confirmed-churn",initial:{month:11,between:1},split:"test",
    goal:"For the Regency year-end desk, compare the two actual Harbor population records and check reserve coverage for at least two grain in the newest saved Northwood entry. Create a private note about both without forecasting.",
    plan:check([],[trend("opening","current",{kind:"population-fell",region:"harbor"}),settle("current",grain("northwood",2))],{localNote:true}),
    action:"stage",expected:["supported","contradicted"],terms:["harbor","northwood"]},
  {id:"held-named-region-has-no-proof",initial:{month:2},split:"test",
    memo:"Draft endorsement: Westbank is forecast to hold at least four grain one month after the saved balance.",
    goal:"The steward left a Regency endorsement draft in this realm. Recover and verify its exact regional reserve claim, and file a private endorsement only if that location has evidence.",
    plan:check([1],[settle(1,grain("westbank",4))],{localNote:true}),action:"hold",expected:["not-observed"],terms:["westbank","evidence"]},
  {id:"held-horizon-specific-crownlands-threshold",initial:{month:0},split:"test",
    goal:"Which Regency planning window keeps the Crownlands reserve at 15 grain or more, one month out or two? Check both projected balances and leave a private record of the shorter viable option.",
    plan:check([1,2],[settle(1,grain("crownlands",15)),settle(2,grain("crownlands",15))],{localNote:true}),
    action:"stage",expected:["supported","contradicted"],terms:["crownlands","15"]},
  {id:"compare-actual-closure-to-early-opening",initial:{month:0,between:2},
    goal:"The Regency crossing clerk believes a cargo return became usable after the first two actual settlements. Check East Crossing capacity at both saved checkpoints and flag any forecast citation as out of scope.",
    plan:check([],[settle("opening",cargo("east-crossing")),settle("current",cargo("east-crossing"))]),action:"report",
    expected:["not-observed","supported"],terms:["crossing","capacity"]},
];
export type OpenRegencyWorld = Scenario & {kind:"regency-briefing";workspace:"examples";sourceGroup:string};
export const openRegencyWorlds:OpenRegencyWorld[]=drafts.map(row=>({
  ...row,id:`regency-briefing-${row.id}`,realmTitle:"The Regency council realm",kind:"regency-briefing",workspace:"examples",
  sourceGroup:`vibestudio:regency:open-council:${row.id}`,
}));
export const openRegencyRequiresUnits=["skills/open-user-goal","skills/open-regency-briefing","skills/examples-review",
  "skills/examples-review-fixtures","skills/scratch-handoff-bindings","panels/regency-fixture-player","workers/regency-realm","workers/pubsub-channel"];
