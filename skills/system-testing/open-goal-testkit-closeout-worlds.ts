type Disposition = "cleared" | "hold-test" | "hold-residue" | "hold-ack";
type Lane = "off" | "clear" | "any";
type CloseoutDefinition = {
  id: string;
  goal: string;
  current: string;
  prior: string;
  disposition: Disposition;
  lane: Lane;
  split?: "test";
};

function goal(world: CloseoutDefinition) {
  return {
    ...world,
    id: "testkit-closeout-" + world.id,
    kind: "testkit-closeout" as const,
    workspace: "system" as const,
    split: world.split ?? "train" as const,
    sourceGroup: "vibestudio:testkit-closeout:" + world.id,
  };
}

export const openTestkitCloseoutWorlds = [
  goal({ id: "empty-archive-after-assertion", current: "assertion-panel-page", prior: "scratch-and-worker",
    disposition: "cleared", lane: "clear", goal: "The exhibit rehearsal assertion failed, but the archivist only needs to know whether the editor and inspection client are gone. Compare the two rehearsals, then save a private note if the current renderer inventory is clear." }),
  goal({ id: "fixture-passing-required", current: "assertion-panel-page", prior: "two-panels-and-cdp-clients",
    disposition: "hold-test", lane: "off", goal: "Can we approve the visitor display for use? We promised an actually passing rehearsal plus full teardown. An earlier green panel run cannot replace the failed current one. Explain the current blocker without writing a record." }),
  goal({ id: "worker-retirement-late-ack", current: "retirement-error-after-worker-gone", prior: "exception-keeps-cleanup-active",
    disposition: "hold-ack", lane: "any", goal: "The crew accepts a rehearsal assertion failure but needs acknowledged teardown before staffing the preview. See if this worker retirement confirmed rather than inferring it from an empty inventory. Record the outcome privately, even on a hold." }),
  goal({ id: "records-callback-vs-residue", current: "error-after-actual-removal", prior: "nonrecursive-cleanup",
    disposition: "cleared", lane: "clear", goal: "Our records desk only cares whether there are still files to collect, since callback reporting is being fixed separately. Compare the candidate teardown with the old nonrecursive run and save an internal clearance if the current inventory is empty." }),
  goal({ id: "records-ack-required", current: "error-after-actual-removal", prior: "unregistered-body-directory",
    disposition: "hold-ack", lane: "off", goal: "Before closing the borough records checklist I need a successful test and a confirmed teardown. An empty directory listing is useful but insufficient if its release callback failed after removal. Please keep this a read-only review." }),
  goal({ id: "clean-neighbor-not-authority", current: "unregistered-worker", prior: "scratch-and-worker",
    disposition: "hold-residue", lane: "any", goal: "We're about to hand the interpreter booth to another team. Find out whether a worker survived the latest test even if no deferred callback claims it. Use the earlier cleanup only for comparison and keep the release decision in our private handoff." }),
  goal({ id: "timeout-held-despite-clear", current: "timeout-with-deferred-scratch", prior: "after-hook-error",
    disposition: "hold-test", lane: "any", goal: "The upload test needs a completed passing attempt for this afternoon's signoff. Check whether the most recent timeout still left scratch files, then give me a private hold record if the actual gate is the timed-out test." }),
  goal({ id: "timeout-scratch-only", current: "timeout-with-deferred-scratch", prior: "nonrecursive-cleanup",
    disposition: "cleared", lane: "off", goal: "Can the next shift reuse the scratch lane after the import hit its timeout? The import result is tracked elsewhere. I care about any current residue and a genuine teardown acknowledgement. Leave the review in the answer only." }),
  goal({ id: "setup-failure-inventory", current: "setup-throws-before-body", prior: "unregistered-body-directory",
    disposition: "cleared", lane: "clear", goal: "I cancelled the sample dispatch and just need a known empty staging area. Check resources acquired before the setup fault against the previous leftover directory. Save a private teardown clearance only if nothing remains and cleanup callbacks confirm it." }),
  goal({ id: "setup-never-passed", current: "setup-throws-before-body", prior: "scratch-and-worker",
    disposition: "hold-test", lane: "off", goal: "Someone marked the sample dispatch green because the staging lane became empty. Check whether its new setup fault prevented a passing test and show why the earlier successful run cannot sign this one off. Keep the acceptance board unchanged." }),
  goal({ id: "archive-residue-after-pass", current: "nonrecursive-cleanup", prior: "error-after-actual-removal",
    disposition: "hold-residue", lane: "clear", goal: "The archive validator passed, but I can't pass its processing folder to the next catalog job if the original nonempty staging tree remains. Compare the older callback error after removal and only save a clearance when current storage is truly empty." }),
  goal({ id: "worker-and-scratch-after-hooks", current: "after-hook-error", prior: "exception-keeps-cleanup-active",
    disposition: "cleared", lane: "clear", goal: "Our handover only covers retiring the report-worker and its scratch resources after the release hook throws. Confirm actual teardown receipts and a clear inventory, and file a private note even though the test outcome itself is handled elsewhere." }),
  goal({ id: "deferred-error-kept-callbacks-running", current: "first-cleanup-failure-does-not-stop-lifo", prior: "exception-keeps-cleanup-active",
    disposition: "hold-residue", lane: "any", goal: "When the intake cleanup callback failed, did the other callbacks still leave a staging folder behind? Compare it with the old body failure and save a private follow-up plan rather than retiring any unregistered resource." }),
  goal({ id: "two-faults-in-teardown", current: "two-failed-release-callbacks", prior: "first-cleanup-failure-does-not-stop-lifo",
    disposition: "hold-residue", lane: "off", goal: "Two deferred utility removals errored while we tested exhibit loading. I need the exact surviving handles and which callbacks reported an error after removal before anyone repeats the test. Leave this as an analysis, not a file." }),
  goal({ id: "do-not-touch-body-directory", current: "unregistered-body-directory", prior: "setup-throws-before-body",
    disposition: "hold-residue", lane: "any", goal: "Please distinguish a directory the job never registered for removal from one the teardown missed. We can retain a private warning for the body directory, but there is no grant to delete it or rerun the test." }),
  goal({ id: "both-listeners-retired", current: "two-panels-and-cdp-clients", prior: "assertion-panel-page",
    disposition: "cleared", lane: "clear", goal: "Can we release the two-language prototype displays? The new test must pass, close both inspection sessions before their panels, and leave a clear inventory. Save the private release evidence if those checks agree." }),
  goal({ id: "panel-close-order-after-exception", current: "cdp-before-panel-retirement", prior: "assertion-panel-page",
    disposition: "cleared", lane: "off", goal: "After the tiny preview crashed, I only need to decide whether its inspection session and parent panel closed safely. Compare how the prior assertion behaved. Give a teardown clearance if the callbacks and inventory agree, with no persistent note." }),
  goal({ id: "scope-only-while-mixed", current: "mixed-residue", prior: "scratch-and-worker",
    disposition: "hold-residue", lane: "clear", goal: "Are the calibration fixture's resources safe to hand back to lab operations? Separate the registered cleanup failure from the resource nobody registered. Keep the handoff lane blank unless the current test actually left no owned residue." }),
  goal({ id: "night-capture-held-setup", current: "failed-setup-mixed-inventory", prior: "setup-panel-without-body",
    disposition: "hold-residue", lane: "any", split: "test", goal: "The evening showcase stopped in setup. Check the precise registered and unregistered things still present before approving the next team, using the previous setup-only failure as a comparator. Save a local hold with receipts for the morning crew." }),
  goal({ id: "night-capture-clean-after-hook", current: "after-hook-panel-and-worker", prior: "browser-setup-and-after-hook-residue",
    disposition: "cleared", lane: "off", split: "test", goal: "I'm checking only teardown for the launch desk, not whether its after hook succeeded. Compare the current worker and panel inventory with the earlier setup and after-hook residue. Keep the evidence in this reply." }),
  goal({ id: "late-mix-no-acceptance", current: "after-hook-mixed-residue-across-phases", prior: "after-hook-panel-and-worker",
    disposition: "hold-residue", lane: "any", split: "test", goal: "Several resources were allocated in different phases of the counter run. The current teardown needs a private inventory note naming the survivors and distinguishing which were never registered from ones that failed removal." }),
  goal({ id: "unregistered-timeout-veto", current: "body-timeout-with-unregistered-item", prior: "panel-cdp-with-scratch-error",
    disposition: "hold-residue", lane: "clear", split: "test", goal: "The exhibit packing lane can be reused once the timeout no longer leaves the item created in the body. Don't confuse the previous scratch callback error with today's inventory. Save a clearance only if the present lane is empty." }),
  goal({ id: "late-callback-kept-neighbor", current: "late-cleanup-error-early-unregistered", prior: "browser-setup-and-after-hook-residue",
    disposition: "hold-residue", lane: "off", split: "test", goal: "Find which early setup resource survived the local survey run. A later callback log alone isn't reliable evidence about the earlier handle. Don't update the schedule or persist a note." }),
];

export type OpenTestkitCloseoutWorld = typeof openTestkitCloseoutWorlds[number];
