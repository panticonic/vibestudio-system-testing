type Profile = "activate" | "retry" | "moved" | "pending" | "withdrawn" |
  "preview-only" | "scope-mismatch" | "ambiguous" | "already-active" | "invalid-plan";
type Task = {
  id:string;title:string;operation:string;goal:string;
  profile:Profile;minutes?:number;maxRuns?:number;cadence:"manual"|"interval";held?:true;
};
const tasks:Task[]=[
  {id:"reserve-receipt-monitor",title:"Late shift reserve receipt",operation:"Check the retained reserve receipt",
    goal:"Activate a new private late shift reserve receipt check using the approved fixed script. Keep its results in a fresh local conversation. Start in the approved future window, repeat every 90 minutes, and stop after three runs.",
    profile:"activate",cadence:"interval",minutes:90,maxRuns:3},
  {id:"equipment-labels-on-demand",title:"Equipment labels",operation:"Count recorded equipment labels",
    goal:"Set up the approved equipment-label count so it can be run on demand. It is a fixed local script in its own conversation. Leave it available without running it today or giving it a recurring schedule.",
    profile:"activate",cadence:"manual"},
  {id:"signoff-still-pending",title:"Access inventory count",operation:"Count requested inventory rows",
    goal:"Check whether the signed access inventory count can be activated as a fixed local job every four hours in its own conversation. If the inventory owner has not settled the request, keep this intake quiet.",
    profile:"pending",cadence:"interval",minutes:240},
  {id:"withdrawal-overtakes-retired-approval",title:"Specimen drawer count",operation:"Count sealed drawer labels",
    goal:"The drawer count used to be approved for a private script run when asked. Check the latest owner decision before creating it. Do not let the older approval overrule a subsequent withdrawal.",
    profile:"withdrawn",cadence:"manual"},
  {id:"print-trial-preview-only",title:"Print trial receipt check",operation:"Compare retained print trial receipts",
    goal:"Review whether a proposed private print-trial receipt script could run every five hours for two runs in a fresh conversation. The editor asked for a preview only. Leave the native schedule clean.",
    profile:"preview-only",cadence:"interval",minutes:300,maxRuns:2},
  {id:"similar-different-cabinet",title:"Evening cabinet report",operation:"Count local cabinet report rows",
    goal:"Activate the evening cabinet script only if the current approval actually covers this cabinet check. It should be private, start in its own conversation, and run only on request. Hold if the owner authorized a nearby operation instead.",
    profile:"scope-mismatch",cadence:"manual"},
  {id:"supplier-cards-conflicting-authority",title:"Supplier card tally",operation:"Count supplier cards in the local register",
    goal:"The private supplier-card tally would use a fixed script every two hours. Check both current handoff records before activating it. If current release decisions conflict, ask for one definitive decision without creating the schedule.",
    profile:"ambiguous",cadence:"interval",minutes:120},
  {id:"refresh-during-window-planning",title:"Panel occupancy sample",operation:"Measure private panel occupancy snapshot",
    goal:"Set up one fixed private panel occupancy sample every 75 minutes, with a maximum of four runs, to start in the approved future window and use its own conversation. If the owner revises the consent during the review, leave the sample inactive until fresh approval.",
    profile:"moved",cadence:"interval",minutes:75,maxRuns:4},
  {id:"duplicate-port-label-check",title:"Port label inspection",operation:"Check retained port label list",
    goal:"Make sure the existing approved Port label inspection is available before creating anything. This is a named fixed local script for on-demand use in its own conversation. If one exact active definition already owns that work, preserve it and report the matching definition.",
    profile:"already-active",cadence:"manual"},
  {id:"readback-lost-dispatch-receipt",title:"Loan receipt quick scan",operation:"Count available loan receipts",
    goal:"Activate the approved on-demand fixed script for checking retained loan receipts in a fresh conversation, without dispatching it. If the creation response is lost, recover the same native receipt so that a retry never creates another scan.",
    profile:"retry",cadence:"manual"},
  {id:"held-stale-rescan-consent",title:"Returned label rescan",operation:"Check privately retained return labels",
    goal:"Activate a new private fixed script that checks retained return labels every 150 minutes, with two runs in its own conversation after the agreed start. Stop if approval is replaced before the scheduler accepts it.",
    profile:"moved",cadence:"interval",minutes:150,maxRuns:2,held:true},
  {id:"held-safe-manual-until-intake",title:"Donor intake tally",operation:"Count private donor intake rows",
    goal:"Prepare the approved Donor intake tally as an active on-demand local script in its own conversation. Future intake should trigger it deliberately. Verify that it creates no automatic run now.",
    profile:"activate",cadence:"manual",held:true},
  {id:"held-audit-owner-lost",title:"Repair box inventory",operation:"Count repair box entries",
    goal:"A private repair-box count should run every three hours after the approved start for at most five runs. Use a fresh conversation. Confirm that this owner approved exactly this fixed script, and hold if the live approval belongs to another owner.",
    profile:"scope-mismatch",cadence:"interval",minutes:180,maxRuns:5,held:true},
  {id:"held-cap-not-specified-in-request",title:"Gallery stock tally",operation:"Count local gallery restock rows",
    goal:"Prepare a private fixed Gallery stock tally every two hours in a separate conversation. The owner requires a hard maximum run count before activation. If the requested count is unspecified, leave the proposal inactive.",
    profile:"invalid-plan",cadence:"interval",minutes:120,held:true},
];
export const automationActivationWorlds=tasks.map(task=>({
  ...task,id:"automation-activation-"+task.id,kind:"automationActivation" as const,
  workspace:"system" as const,split:task.held?"test" as const:"train" as const,
  sourceGroup:"vibestudio:automation-activation:"+task.id,
}));
export type AutomationActivationWorld=typeof automationActivationWorlds[number];
