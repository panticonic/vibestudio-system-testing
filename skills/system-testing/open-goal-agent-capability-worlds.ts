type Mode = "returned" | "failed-empty" | "failed-after-save" | "retry-gate" | "large-output" | "large-console" |
  "empty-console" | "scope-values" | "cancelled";
type Task = "audit" | "continue" | "retry";
type Approval = "current" | "read-only" | "older-revision" | "other-notebook" | "withdrawn";
export type AgentCapabilityWorld = {
  id: string; kind: "agent-capability"; workspace: "system"; sourceGroup: string; split?: "test";
  title: string; goal: string; mode: Mode; task: Task; approval: Approval;
  requestedReturnRequired:boolean;
  amended: boolean; unready: boolean; priorMode: Mode;
};
type Options = Partial<Pick<AgentCapabilityWorld, "task" | "approval" | "amended" | "unready" | "priorMode" | "requestedReturnRequired">> & { held?: true };
function world(id: string, title: string, mode: Mode, goal: string, options: Options = {}): AgentCapabilityWorld {
  return { id: "agent-capability-" + id, kind: "agent-capability", workspace: "system", sourceGroup: "vibestudio:agent-capability:" + id,
    ...(options.held ? { split: "test" } : {}), title, goal, mode, task: options.task ?? "audit",
    requestedReturnRequired: options.requestedReturnRequired??true,
    approval: options.approval ?? "current", amended: options.amended ?? false, unready: options.unready ?? false,
    priorMode: options.priorMode ?? "returned" };
}
export const openAgentCapabilityRequiresUnits = [
  "skills/open-user-goal", "packages/agentic-do", "packages/agentic-protocol", "packages/agentic-chat", "workers/agent-worker",
];
export const openAgentCapabilityWorlds = [
  world("routing-receipt-saved-before-exception", "Maintenance route card", "failed-after-save",
    "The latest route-card cell stopped with an error after I edited the maintenance record. Can we keep going with the saved card instead of making a second one?", { task: "continue" }),
  world("music-queue-error-before-change", "Rehearsal queue", "failed-empty",
    "The rehearsal queue error looked like it happened early. Find out whether this notebook actually changed and whether the cell can be recovered without quietly rerunning it."),
  world("calendar-report-prerequisite-repaired", "Calendar reconciliation", "retry-gate",
    "The calendar reconciliation failed when my local prerequisite was missing. I have fixed it. Retry that step if the same revision and retained scope still support it.", { requestedReturnRequired:false, task: "retry" }),
  world("work-order-still-waiting-prerequisite", "Workshop dispatch", "retry-gate",
    "The workshop dispatch cell had a missing prerequisite. Please recover it only if there is current evidence the dependency is ready. Keep the first observation if we still have to wait.", { requestedReturnRequired:false, task: "retry", unready: true }),
  world("lab-console-after-last-line-question", "Lab annotation digest", "large-console",
    "The console card for the lab digest showed only a preview. Check what the actual latest run retained and whether it reached the final note. Don't run the digest again."),
  world("library-listing-read-exact-large-output", "Library holdings review", "large-output",
    "The library holdings cell returned a lot of output. Continue using the stored value if it really belongs to this revision, while preserving the other notebook work.", { requestedReturnRequired:false, task: "continue" }),
  world("voucher-preview-from-another-notebook", "Voucher checkpoint", "returned",
    "My continuation note mentions this voucher checkpoint, but it may belong to another notebook with the same label. Check the exact action and do not act outside the review.", { task: "continue", approval: "other-notebook" }),
  world("harbor-console-does-not-prove-commit", "Harbor allocation", "failed-empty",
    "The harbor allocation printed a progress note before it failed. Determine whether it actually changed the current record. I don't want to duplicate a saved effect.", { task: "continue" }),
  world("survey-confirm-existing-scope-siblings", "Survey register", "scope-values",
    "Use the current survey register if the three independently retained notebook values are still there. Preserve the pending sibling work and verify the exact existing record.", { requestedReturnRequired:false, task: "continue" }),
  world("plant-sale-revisions-share-rehearsal-name", "Plant sale labels", "returned",
    "Two label rehearsals have the same name. Tell me which revision finished the actual label step and separate that from the earlier run's evidence.", { priorMode: "failed-after-save" }),
  world("toolbox-cancelled-before-admission", "Toolbox schedule", "cancelled",
    "Check whether the cancelled toolbox step was actually admitted or produced anything. Leave its notebook and cancellation in place."),
  world("dance-rehearsal-old-approval-new-scope", "Dance rehearsal sheet", "retry-gate",
    "A choreographer approved retrying a cell before this rehearsal sheet revision. Verify whether that authorization applies to the actual current action.", { task: "retry", approval: "older-revision" }),
  world("permit-digest-readable-without-write-grant", "Permit inspection", "large-output",
    "Can you reconcile the permit notebook's long retained output with the active action? The local review can read the result but does not authorize a continuation.", { task: "continue", approval: "read-only" }),
  world("orchard-failure-with-silent-console", "Orchard packing note", "empty-console",
    "The orchard packing step left no console preview. Decide what the original terminal result actually says and whether there is an owned value to recover."),
  world("gallery-revised-after-original-success", "Gallery humidity register", "returned",
    "The gallery notebook was edited after the original successful humidity check. Check whether that old step still backs the current record before continuing.", { task: "continue", amended: true }),
  world("sports-fixture-corrected-prerequisite-read-only", "Sports fixture desk", "retry-gate",
    "Look into the failed sports fixture check and whether the prerequisite is now fixed. I want the evidence only and do not want to start another attempt.", { task: "retry", approval: "read-only" }),
  world("invoicing-follow-up-uses-canonical-failed-output", "Expense reconciliation", "failed-after-save",
    "The expense cell reported an exception. Check whether it still committed the expected reviewed local value before deciding whether to reuse it. Leave other reviewers’ records untouched.", { task: "continue", priorMode: "failed-empty" }),
  world("trail-console-and-stale-run-distinguished", "Trail inventory", "large-console",
    "The trail inventory preview shows a late final line, but another revision ran successfully too. Verify which admitted cell produced the current console and avoid changing the notebook.", { priorMode: "large-console" }),
  world("makerspace-scope-saved-value-audit", "Makerspace station queue", "scope-values",
    "Compare the current makerspace queue with what the preceding sandbox action actually retained. Keep the other scope values unchanged and explain any missing action evidence.", { priorMode: "failed-empty" }),
  world("radio-shift-stored-side-effect-blocks-rerun", "Radio shift log", "failed-after-save",
    "Try recovering the interrupted radio shift cell only if it did not already save the expected log. Avoid another attempt if the value already exists.", { requestedReturnRequired:false, task: "retry" }),
  world("held-theatre-approval-withdrawn", "Theatre cue board", "retry-gate",
    "I withdrew the theatre cue retry after the prerequisite changed. Check what is left in the current action and leave it as it stands.", { task: "retry", approval: "withdrawn", held: true }),
  world("held-travel-output-from-foreign-notebook", "Travel receipts", "large-output",
    "A copied travel receipt reference points at a similar notebook. Inspect the admitted current output before attributing or continuing it under that reference.", { task: "continue", approval: "other-notebook", held: true }),
  world("held-compliance-superseded-revision", "Compliance worksheet", "failed-after-save",
    "The compliance worksheet advanced since a failed cell saved a value. Don't carry the older value forward until there is evidence the new revision still includes it.", { task: "continue", amended: true, held: true }),
  world("held-greenhouse-cancel-not-retry-authority", "Greenhouse observation", "cancelled",
    "Check whether the cancelled greenhouse cell left a reliable effect. The note to try again was from the previous revision.", { task: "retry", approval: "older-revision", held: true }),
  world("held-language-lab-no-code-retry", "Language lab rollup", "failed-empty",
    "The rollup didn't produce a saved result. Tell me whether repeating the failed action would be reliable with today's evidence and leave the notebook if the cause is unresolved.", { task: "retry", held: true }),
  world("held-archives-console-preview-withdrawn", "Archive note batches", "large-console",
    "The archive batch preview is cropped. Find the exact original evidence, but the review was withdrawn before any follow-up could be applied.", { task: "continue", approval: "withdrawn", held: true }),
];
