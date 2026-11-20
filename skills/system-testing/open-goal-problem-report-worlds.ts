import type { ManagedProblemDraftWorld } from "./problem-draft-managed.js";

export type OpenProblemWorld = ManagedProblemDraftWorld & {
  kind: "problem-report";
  workspace: "examples";
  sourceGroup: string;
  split: "train" | "test";
  surface: string;
  archive: string;
};

type Case = Omit<OpenProblemWorld, "kind" | "workspace" | "sourceGroup" | "account"> & {
  intent: string;
  observed: string;
  expected: string;
  attempts: string;
  operation: string | null;
  reproduced?: boolean;
};
function incident({ intent, observed, expected, attempts, operation, reproduced = false, ...caseInfo }: Case): OpenProblemWorld {
  return { kind: "problem-report", workspace: "examples", sourceGroup: "local-problem-" + caseInfo.id,
    ...caseInfo, account: { goal: intent, observed, expected, attempts, operation, reproduced } };
}

export const problemReportRequiresUnits = ["skills/open-user-goal", "skills/problem-reporting"];
export const openProblemReportWorlds = [
  incident({ id: "problem-draft-lane-filter", mode: "new", split: "train", defect: "platform", surface: "Task board",
    goal: "The current Task board still hides the review lane after I clear the filters. Give me a local incident draft with a way to check the reset. The old archived filter report was about an empty search.",
    intent: "Show all current Task board lanes.", observed: "Clearing all filters still hid the Review lane.",
    expected: "Clearing filters shows the Review lane with its seven current cards.", attempts: "A second filter reset showed the same result.",
    operation: "taskBoard.clearFilters", reproduced: true, archive: "An earlier empty-search issue had no Review cards." }),
  incident({ id: "problem-draft-print-extension", mode: "existing", split: "train", defect: "user-code", surface: "Print preview extension",
    goal: "Add a check to my current Print preview extension draft. It is the landscape footer crash in our own source. Keep the existing symptom and leave the archived printer connection report alone.",
    intent: "Preview our worksheet in landscape orientation.", observed: "Our extension throws ReferenceError: footerRows is not defined.",
    expected: "Landscape Print preview shows the same footer rows as the worksheet.", attempts: "Portrait still works using our extension.",
    operation: "printPreview.render", archive: "A retired desktop report concerned pairing the office printer." }),
  incident({ id: "problem-draft-policy-refusal", mode: "new", split: "train", defect: "refusal", surface: "Workspace publishing",
    goal: "Write a private draft about the current publishing refusal for the unreviewed draft; label what happened accurately and explain what to verify. I do not want you to publish or request approval.",
    intent: "Try a local publish from a draft revision.", observed: "Publishing reported APPROVAL_REQUIRED for the draft revision.",
    expected: "An unapproved revision remains a draft and shows the relevant approval state.", attempts: "The owner confirmed review is still pending.",
    operation: "website.publish", archive: "The archived incident concerned image assets missing from an approved release." }),
  incident({ id: "problem-draft-preview-retry", mode: "new", split: "train", defect: "transient", surface: "Housekeeping preview",
    goal: "The housekeeping preview timed out once and worked on retry. File a local incident note for that current episode with one check for recurrence. The previous outage is already closed.",
    intent: "Load today's preview for the housekeeping checklist.", observed: "The preview returned a one-off gateway timeout.",
    expected: "The same preview opens with today's housekeeping checklist.", attempts: "An immediate retry succeeded and showed today's checklist.",
    operation: "panel.preview", archive: "The retired issue was a consistently blank preview after a source build." }),
  incident({ id: "problem-draft-calendar-color-review", mode: "stale", split: "train", defect: "platform", surface: "Shared calendar",
    goal: "In my reviewed Calendar draft about overwritten meeting colors, add a test only if the draft still matches the review. If another note arrived, tell me it is held and leave the new note intact.",
    intent: "Preserve my color coding while updating the shared event title.", observed: "Editing only the title changed the existing color.",
    expected: "Updating the event title leaves its previous category color unchanged.", attempts: "The update was reproduced on the copied calendar.",
    operation: "calendar.updateTitle", reproduced: true, archive: "An archived Calendar issue was about a missing timezone field." }),
  incident({ id: "problem-draft-indexer-space", mode: "new", split: "train", defect: "user-code", surface: "Library card indexer",
    goal: "Could you leave me a report draft for our Library card indexer dropping names with double spaces? Capture what our code did and a safe repeat check. The older deduplication incident doesn't belong in it.",
    intent: "Index names containing two adjacent spaces.", observed: "Our parser drops the whole card when the middle name is empty.",
    expected: "The card is retained with the original display spacing.", attempts: "The same parser failed for two different names.",
    operation: "indexer.parseCard", reproduced: true, archive: "The archived issue removed actual duplicate card numbers." }),
  incident({ id: "problem-draft-transfer-path-hold", mode: "existing", split: "train", defect: "refusal", surface: "Shared folder transfer",
    goal: "Leave a verification step in the active shared-folder transfer draft. The system blocked a destination outside the team-owned folder as intended. Preserve my original note, and do not attempt a transfer or change permissions.",
    intent: "Understand why the preview transfer was rejected.", observed: "The destination path was outside the workspace's owned route.",
    expected: "An out-of-scope preview destination is rejected with an ownership explanation.", attempts: "A dry-run check for the existing allowed route was already green.",
    operation: "workspace.transferPreview", archive: "The completed note concerned interruption inside a legitimate allowed folder." }),
  incident({ id: "problem-draft-scratch-duplicates", mode: "existing", split: "train", defect: "platform", surface: "Scratch handoff panel",
    goal: "Consolidate evidence in my existing local draft for the active Scratch handoff issue. It is about one preview showing the same saved handoff twice, not the completed issue about two separately saved handoffs.",
    intent: "Read the retained handoff without making another.", observed: "One stored handoff ID was rendered as two copies in the preview.",
    expected: "The Scratch handoff view shows each retained handoff once.", attempts: "Reopening showed the same duplicate ID.",
    operation: "scratch.review", reproduced: true, archive: "Two contributors had each saved a different handoff during the older incident." }),
  incident({ id: "problem-draft-draft-revision-hold", mode: "stale", split: "train", defect: "user-code", surface: "Map legend panel",
    goal: "Add the map test to my earlier review of the current legend bug only if the incident draft is still at the version I signed off. Leave a later teammate edit intact and keep the report private.",
    intent: "Render an empty map layer without coordinates.", observed: "Our legend script dereferences an empty bounds list.",
    expected: "The map displays its existing legend for an empty layer.", attempts: "The controlled import reproduced the same stack.",
    operation: "mapLegend.bounds", reproduced: true, archive: "The old rendering issue affected filled layers at the north edge." }),
  incident({ id: "problem-draft-quota-recovered", mode: "existing", split: "train", defect: "transient", surface: "Workspace thumbnail rendering",
    goal: "Add a recurrence check to my existing thumbnail report for the recent quota window. The render worked after the window reopened. Preserve the local draft instead of opening a second incident or asking to increase quota.",
    intent: "Render the approved local thumbnail.", observed: "The renderer returned a temporary rate-limit response.",
    expected: "The thumbnail renders after the existing quota window reopens.", attempts: "The scheduled retry produced the thumbnail at the same revision.",
    operation: "thumbnail.render", archive: "The archived report involved a malformed width argument on every attempt." }),
  incident({ id: "problem-draft-approval-hold", mode: "stale", split: "train", defect: "refusal", surface: "Handoff approval",
    goal: "I reviewed an active local draft about the correct handoff approval hold yesterday. Only amend that reviewed draft. If today's rewrite is there, keep it unchanged; don't seek a decision on the handoff.",
    intent: "Understand why the draft handoff is still waiting.", observed: "The workspace held a handoff whose owner approval was pending.",
    expected: "A pending owner approval blocks the handoff and retains its public status.", attempts: "The owner has not approved the proposed target.",
    operation: "handoff.release", archive: "The archived issue released an already approved handoff." }),
  incident({ id: "problem-draft-board-count", mode: "new", split: "train", defect: "platform", surface: "Review badge panel",
    goal: "Keep a local defect draft for the new Review badge mismatch after the approved item moved between queues. Include a focused check for the discrepancy. The old team count from before migration is unrelated.",
    intent: "Reconcile the badge and the current persisted review queue.", observed: "The Review badge reported three despite two matching stored items.",
    expected: "The Review badge agrees with the two current retained queue entries.", attempts: "Refreshing the badge still showed three.",
    operation: "reviewBadge.refresh", reproduced: true, archive: "A pre-migration report excluded the entire review queue." }),
  incident({ id: "problem-draft-vault-link-rewrite", mode: "existing", split: "test", defect: "platform", surface: "Vault alias",
    goal: "Pick up my unsent report on the live vault alias rewrite after renaming the north wing page. Add a verification step while preserving what I wrote. Leave the old indexing note closed.",
    intent: "Open the renamed vault page through its retained alias.", observed: "The retained alias opened the retired north wing page.",
    expected: "The existing alias resolves to the renamed active north wing page.", attempts: "A fresh renderer repeated the old destination.",
    operation: "vault.resolveAlias", reproduced: true, archive: "The indexing note described delays finding an unrelated new page." }),
  incident({ id: "problem-draft-translation-null", mode: "new", split: "test", defect: "user-code", surface: "Translation summary worker",
    goal: "Our translation summary drops the record if the optional locale is empty. Write a local report for that bug in our worker and show how to verify the default is used. The upstream provider incident was resolved last week.",
    intent: "Summarize a record that omits its optional locale.", observed: "Our worker returned an empty result after dereferencing a null locale.",
    expected: "The worker emits an English summary when the optional locale is absent.", attempts: "The owned replay fails even without the upstream provider.",
    operation: "translation.useLocale", reproduced: true, archive: "The closed upstream issue involved unavailable translation quota." }),
  incident({ id: "problem-draft-pair-code-recovered", mode: "new", split: "test", defect: "transient", surface: "Reading room device setup",
    goal: "For the reading-room tablet that paired on a second attempt, save a private troubleshooting draft with a recurrence check. The old problem was a code for the wrong device; do not reuse anything from it.",
    intent: "Pair the reading-room tablet during its current setup.", observed: "The first pairing acknowledgement timed out.",
    expected: "A pairing attempt acknowledges the exact device within the normal window.", attempts: "Retrying for the same device succeeded.",
    operation: "devicePair.claim", archive: "The archived event used a cancelled code for a different tablet." }),
  incident({ id: "problem-draft-abandoned-sensor-check", mode: "stale", split: "test", defect: "platform", surface: "Sensor trace filter",
    goal: "If my approved local draft about the current sensor filter still has the reviewed revision, add a verification step. A technician may have rewritten it since then. Preserve their newer draft if so, and stay out of the archived calibration report.",
    intent: "Show all retained sensor traces after clearing the minimum threshold.", observed: "The cleared filter kept rejecting zero-valued traces.",
    expected: "Clearing the filter retains zero-valued traces in the list.", attempts: "A clean view reproduced the filter behavior.",
    operation: "sensorFilter.clear", reproduced: true, archive: "An older incident was a hardware calibration failure below zero." }),
] satisfies OpenProblemWorld[];
