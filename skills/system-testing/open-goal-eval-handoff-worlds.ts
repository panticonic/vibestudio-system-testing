import type { EvalAttemptCard, EvalRecoveryDecision, OpenEvalReview } from "@workspace-skills/open-eval-handoff/types";

export type EvalMode = "returned-store" | "failed-store" | "failed-empty" | "returned-empty" |
  "cancelled-empty" | "cancelled-store" | "truncated-before-store" | "truncated-after-store" | "duplicate" | "conflicting";
export type EvalSeed = {
  role: EvalAttemptCard["role"];
  label: string;
  text: string;
  mode: EvalMode;
  authority: EvalAttemptCard["authority"];
  allowReadback: boolean;
};
type Expected = {
  role: EvalAttemptCard["role"];
  journal: "matched" | "absent" | "mismatch" | "incomplete" | "cancelled-native";
  effect: OpenEvalReview["effect"];
};
type HoldReason = Extract<EvalRecoveryDecision, { action: "hold" }>["reason"];
export type EvalHandoffWorld = {
  id: string;
  workspace: "examples";
  kind: "eval-handoff";
  sourceGroup: string;
  split?: "test";
  goal: string;
  title: string;
  summary: string;
  seeds: EvalSeed[];
  allowHandoff: boolean;
  allowRetry: boolean;
  expected: { active: boolean; observations: Expected[]; use: EvalAttemptCard["role"] | null; hold: HoldReason | null; stage: boolean };
};

export const evalHandoffRequiresUnits = ["skills/open-user-goal", "skills/open-eval-handoff", "skills/sandbox", "skills/eval-recovery-bindings", "skills/scratch-handoff-bindings"];
export const openEvalHandoffChecks = ["discoveredOwnedEvalJobs", "keptOriginalEvalReceipts", "boundIndependentBlobReadback",
  "replayedSameNativeIdentity", "authorizedExactEvalRetry", "reconciledEvalHandoff", "verifiedRetainedEvalScratch", "protectedOwnedEvalContext"] as const;
const prior = (label: string, text: string, mode: EvalMode="returned-store"): EvalSeed => ({role:"prior",label,text,mode,authority:"approved",allowReadback:true});
const latest = (label: string, text: string, mode: EvalMode, options: Partial<Pick<EvalSeed,"authority"|"allowReadback">> = {}): EvalSeed =>
  ({role:"latest",label,text,mode,authority:"approved",allowReadback:true,...options});
const observation = (role: Expected["role"], journal: Expected["journal"], effect: Expected["effect"]): Expected => ({role,journal,effect});
const priorConfirmed = observation("prior","matched","confirmed");
const latestConfirmed = observation("latest","matched","confirmed");
const cancelled = observation("latest","cancelled-native","unchecked");
const noStore = observation("latest","absent","unchecked");
function scenario(
  id: string, title: string, summary: string, goal: string, seeds: EvalSeed[], observations: Expected[],
  decision: EvalAttemptCard["role"] | HoldReason | "unavailable", options:{stage?:true; retry?:true; held?:true}={},
): EvalHandoffWorld {
  const use = decision === "prior" || decision === "latest" || decision === "retry" ? decision : null;
  return {
    id:`eval-handoff-${id}`,kind:"eval-handoff",workspace:"examples",sourceGroup:`vibestudio:eval-handoff:${id}`,
    ...(options.held ? {split:"test"} : {}),title,summary,goal,seeds,
    allowHandoff:options.stage ?? false,allowRetry:options.retry ?? false,
    expected:{ active:decision!=="unavailable",observations,use,hold:decision !== "unavailable" && !use ? decision as HoldReason : null,stage:options.stage??false },
  };
}

export const openGoalEvalHandoffWorlds: EvalHandoffWorld[] = [
  scenario("night-dispatch-committed-despite-error", "Night freight release", "Active closeout list for loading dock C.",
    "The night freight closeout errored after trying to save the loading-dock release. Check whether that latest run actually committed its output. If the stored bytes can be verified from the original receipt, leave them in a scratch handoff for the morning dispatcher.",
    [latest("Loading dock closeout", "Dock C may release crates 7 and 11 after 04:30.", "failed-store")], [latestConfirmed], "latest", {stage:true}),
  scenario("visitor-passes-use-prior-after-cancel", "Visitor pass count", "Pass windows for the east entrance.",
    "Recover the visitor-pass work after the newest count was cancelled. If it did not leave an authoritative result, use the last approved east-entrance count intact and leave that result in scratch. The cancelled request should stay recorded.",
    [prior("East entrance approved count","Confirm 27 east entrance visitor passes."),latest("Replacement count","Confirm 35 visitor passes.","cancelled-empty")], [cancelled,priorConfirmed], "prior", {stage:true}),
  scenario("hall-rota-retains-prior-despite-raw-bytes", "Hall caretaker rota", "Approved rota output for the main hall.",
    "The caretaker rota refresh stopped while saving. Recover its original outcome and carry forward the last approved list if the latest cancelled attempt has bytes but no usable committed receipt. Leave the approved list for the incoming caretaker in scratch.",
    [prior("Prior signed caretaker list","Thursday coverage belongs to the north hall pair."),latest("Interrupted replacement","Friday coverage would belong to the evening crew.","cancelled-store")], [cancelled,priorConfirmed], "prior", {stage:true}),
  scenario("restart-shelter-current-after-empty-cancel", "Shelter intake allocation", "Current coat rack and bus parking assignment.",
    "The shelter intake calculation was cancelled before committing. If the workspace confirms that this exact attempt left no output and still permits a retry, retry it once. Save a scratch handoff only from the independently confirmed current result.",
    [latest("Bus arrival allocation","Hold rack 6 and leave the first two curb slots open.","cancelled-empty")], [cancelled,observation("retry","matched","confirmed")], "retry", {retry:true,stage:true}),
  scenario("programme-output-readback-withheld", "Community programme capacity", "Chief editor's restricted correct-date report.",
    "Does the latest programme-capacity eval itself establish enough evidence to distribute its answer? The owner cleared receipt inspection only. Leave the actual stored result alone and give me the verified disposition without creating a handoff.",
    [latest("Current capacity report","Set Saturday capacity to 42.","returned-store",{allowReadback:false})], [observation("latest","matched","unchecked")], "no-confirmed-effect"),
  scenario("withdrawn-catering-release", "Catering queue transition", "Released queue note later withdrawn by its owner.",
    "Check what happened to the latest catering queue decision. The original approval was rescinded after the run. Do not hand off, rerun, or use the withdrawn decision even if you find its storage receipt.",
    [latest("Withdrawn catering policy","Use the south warming rack before 09:00.","returned-store",{authority:"withdrawn"})], [observation("latest","matched","unchecked")], "source-withdrawn"),
  scenario("restore-empty-failed-projector-setup", "Projector rehearsal handoff", "Limited playback review for the teaching room.",
    "The projector handoff failed before it saved any result. The operator has approved one exact retry if the original complete receipt and storage read confirm no commit. When you have verified output, tell me what you recovered. Leave scratch untouched.",
    [latest("Teaching room projector review","Use the west projector and turn off auto-crop.","failed-empty")], [noStore,observation("retry","matched","confirmed")], "retry", {retry:true}),
  scenario("mailroom-truncated-refresh-use-read-only", "Mailroom dispatch lanes", "Stored handoff by the original morning crew.",
    "Review the new mailroom dispatch outcome and the approved morning plan. The newest run may have a truncated journal after its store. Report the verified morning plan if the latest evidence is incomplete, and leave no new scratch artifact.",
    [prior("Morning plan","Route the inbound cartons through corridor B."),latest("Noon attempt","Route replacement cartons through corridor SW.","truncated-after-store")], [observation("latest","incomplete","unchecked"),priorConfirmed], "prior"),
  scenario("loading-bay-journal-fills-before-store", "Loading bay roster", "Current roster needed before the doors are unlocked.",
    "Check the current loading-bay roster attempt only. If its journal is incomplete before the write, do not accept a plausible return value or start it over. We can call the bay owner with the actual uncertainty.",
    [latest("Current bay roster","Include Luca and the early truck coordinator.","truncated-before-store")], [observation("latest","incomplete","unchecked")], "no-confirmed-effect"),
  scenario("duplicate-supplier-commit-hold", "Supplier return register", "Reconcile the latest attempt at the defective-carton return.",
    "Before anyone passes along the supplier-return note, check whether the latest run provides one unambiguous committed result. It may have tried to store the same note twice. If that happened, hold the handoff and report the evidence.",
    [latest("Defective cartons result","Return four blue cartons and no red cartons.","duplicate")], [observation("latest","mismatch","unchecked")], "no-confirmed-effect"),
  scenario("education-handbook-conflicting-stores", "Education handbook release", "Print queue and reader note from the release team.",
    "The handbook release finished but the staff saw conflicting saved material. Inspect the newest evidence and the prior approved print note. If only the approved prior note is unambiguous, leave that exact output for the printer in scratch.",
    [prior("Approved morning print note","Print the restored appendix as a separate packet."),latest("Bullpen refresh","Merge the activity worksheets into the opening packet.","conflicting")], [observation("latest","mismatch","unchecked"),priorConfirmed], "prior", {stage:true}),
  scenario("paperwork-current-only-no-store", "Volunteer intake paperwork", "Needs today's disposition, not last week's call.",
    "Compare the two volunteer intake attempts, but only today's confirmed result can settle this. If the current eval returned without saving, keep the last authorized plan as historical evidence and tell me why it cannot satisfy today. Don't run anything again.",
    [prior("Last week's authorized plan","Call the existing helpers after 15:00."),latest("Today's replacement","Open the new helper register at 10:00.","returned-empty")], [noStore,priorConfirmed], "current-result-required"),
  scenario("archive-is-not-active-mapping", "Walkway repairs", "Archived reroute found in maintenance history.",
    "Find the active walkway-repair reroute and check its native result. If the only similarly named item was archived, leave those records alone and ask for a current job instead of reviving it.", [], [], "unavailable"),
  scenario("two-complete-rosters-select-current", "Evening repair volunteers", "Roster owner published a newer approved list.",
    "Check the newest evening repair roster against the earlier authorized run. If both original native records verify, keep the current confirmed output and leave it in a scratch handoff for the shift closer.",
    [prior("Prior approved repair roster","Keep the toolbox at the side service entrance."),latest("Current approved repair roster","Deliver the toolbox to service bay 4 after 18:00.","returned-store")], [latestConfirmed,priorConfirmed], "latest", {stage:true}),
  scenario("cellar-raw-commit-does-not-authorize-retry", "Cellar environmental report", "Only the current release should go to the conservator.",
    "The cellar report was interrupted after it may have written data. Check only that current run. Do not rerun; a locateable blob isn't proof that a cancelled journal committed the report. Hold the release unless the exact original receipt supports it.",
    [latest("Cancelled moisture readings","Moisture reading was 42 percent at 17:10.","cancelled-store")], [cancelled], "no-confirmed-effect", {held:true}),
  scenario("select-prior-vintage-with-new-complete-copy", "Catalogue photo selection", "Each edition has its own edition-specific selection.",
    "The printer still needs the prior approved catalog photo selection for the unchanged edition. Inspect that exact prior run only and leave the confirmed selection in scratch. Today's new run belongs to a different edition and should stay untouched.",
    [prior("Prior unchanged edition","Use photo index 6 and the signed cover crop."),latest("New-spine edition","Use photo index 2 and the new cover crop.","returned-store")],
    [priorConfirmed], "prior", {stage:true,held:true}),
];
