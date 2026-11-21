export type SkillFunctionContract = {
  path: string;
  args: Record<string, string>;
  returns: string;
};
type Disposition =
  | "stage-local-patch"
  | "hold-authorization"
  | "hold-stale"
  | "hold-evidence"
  | "keep-current";
type FixtureOptions = {
  before: SkillFunctionContract[];
  target: SkillFunctionContract[];
  remove?: string[];
  scope?: { original: string[]; required: string[] };
  evidence?: "archive";
  authority?: "denied";
  advance?: true;
  action: Disposition;
};

function entry(
  path: string,
  args: Record<string, string>,
  returns: string,
): SkillFunctionContract {
  return { path: path + ".nl", args, returns };
}
function task(
  id: string,
  split: "train" | "test",
  name: string,
  goal: string,
  fixture: FixtureOptions,
) {
  return {
    id: `skill-maintenance-${id}`,
    sourceGroup: `vibestudio:skill-maintenance:${id}`,
    kind: "skillMaintenance",
    workspace: "examples",
    split,
    name,
    goal,
    ...fixture,
  } as const;
}

export const openSkillMaintenanceWorlds = [
  task(
    "board-priorities-typed-batch",
    "train",
    "Review Board Queue",
    "The reusable Review Board Queue is giving callers one priority label even when the retained trial expects the complete ordered queue. Repair the helper's contract for a list and keep the public entrypoint stable. Make a local working change only.",
    {
      before: [
        entry("run/triage/choosePriorities", { tickets: "string[]" }, "string"),
      ],
      target: [
        entry(
          "run/triage/choosePriorities",
          { tickets: "string[]" },
          "string[]",
        ),
      ],
      action: "stage-local-patch",
    },
  ),
  task(
    "invoice-currency-context",
    "train",
    "Invoice Triage",
    "Invoice Triage lost the currency context on the nested amount check. The retained verification should make clear whether the problem is still current. If it is, make the reusable check accept an explicit currency and preserve its numeric result.",
    {
      before: [
        entry("run/verify/verifyAmount", { amount: "number" }, "number"),
      ],
      target: [
        entry(
          "run/verify/verifyAmount",
          { amount: "number", currency: "string" },
          "number",
        ),
      ],
      action: "stage-local-patch",
    },
  ),
  task(
    "shelf-two-stage-check",
    "train",
    "Archive Shelf Review",
    "Bring the Archive Shelf Review up to the retained check: it needs one nested stage that confirms a shelf reference and a separate one that lists the surviving titles. Fix both local contracts so each has a single responsibility.",
    {
      before: [
        entry("run/verify/confirmShelf", { shelf: "string" }, "string"),
        entry("run/verify/survivingTitles", { shelf: "string" }, "number"),
      ],
      target: [
        entry("run/verify/confirmShelf", { shelf: "string" }, "boolean"),
        entry("run/verify/survivingTitles", { shelf: "string" }, "string[]"),
      ],
      action: "stage-local-patch",
    },
  ),
  task(
    "pickup-parent-public-id",
    "train",
    "Pickup Review",
    "The Pickup Review caller now holds only a retained pickup ID. Make that ID a named input at the existing review boundary while keeping the helper's prior note input and the public review type intact.",
    {
      before: [
        entry("run", { goal: "string" }, "string"),
        entry("run/inspect/qualifyNote", { note: "string" }, "boolean"),
      ],
      target: [entry("run", { goal: "string", pickupId: "string" }, "string")],
      action: "stage-local-patch",
    },
  ),
  task(
    "labels-move-cleaner-below-policy",
    "train",
    "Label Repair",
    "A Label Repair caller found the cleaner sitting at the stale top-level helper path. Put the typed cleaner under the review stage, and retire the stale public helper name if the retained witness confirms that boundary is missing.",
    {
      before: [entry("run/cleanLabel", { label: "string" }, "string")],
      target: [entry("run/review/cleanLabel", { label: "string" }, "string")],
      remove: ["run/cleanLabel.nl"],
      action: "stage-local-patch",
    },
  ),
  task(
    "article-helper-add-under-intake",
    "train",
    "Article Intake",
    "Article Intake needs a reusable title check under intake, where article titles are already validated before they are handed off. Add the missing typed confirmation callable without recasting the existing article review.",
    {
      before: [
        entry("run/intake/normalizeTitle", { title: "string" }, "string"),
      ],
      target: [
        entry("run/intake/confirmTitle", { title: "string" }, "boolean"),
      ],
      action: "stage-local-patch",
    },
  ),
  task(
    "notice-authority-narrowed-to-child",
    "train",
    "Notice Desk Review",
    "Notice Desk Review currently lets the whole entrypoint hold the notification reader. Confirm the retained boundary evidence and narrow the service to the exact compiled readNotice child inside inspect. Keep the same compiled code and service.",
    {
      before: [entry("run/inspect/readNotice", { id: "string" }, "string")],
      target: [entry("run/inspect/readNotice", { id: "string" }, "string")],
      scope: { original: ["run.nl"], required: ["run/inspect/readNotice.nl"] },
      action: "stage-local-patch",
    },
  ),
  task(
    "labels-protected-authority",
    "train",
    "Records Labels",
    "The Records Labels readout doesn't match the current labels check. Find which contract failed, but I'm a reviewer here. Leave the reusable skill untouched and tell me who needs to approve a correction.",
    {
      before: [entry("run/review/recordLabel", { id: "string" }, "number")],
      target: [entry("run/review/recordLabel", { id: "string" }, "string")],
      authority: "denied",
      action: "hold-authorization",
    },
  ),
  task(
    "archives-foreign-receipt",
    "train",
    "Archive Handoff",
    "Archive Handoff has a failed check from the previous edition. Check whether it really proves a defect in the working skill before making any local repair, and stop if it belongs to the archive.",
    {
      before: [entry("run/choose/selectHandoff", { note: "string" }, "number")],
      target: [entry("run/choose/selectHandoff", { note: "string" }, "string")],
      evidence: "archive",
      action: "hold-evidence",
    },
  ),
  task(
    "receipts-concurrent-frontier",
    "train",
    "Receipt Recovery",
    "I reviewed the Receipt Recovery change request, then another editor opened a new working revision. Preserve their work. Stage a local correction only if the failing evidence still names the exact current revision.",
    {
      before: [
        entry("run/reconcile/pickReceipt", { options: "string[]" }, "boolean"),
      ],
      target: [
        entry("run/reconcile/pickReceipt", { options: "string[]" }, "string"),
      ],
      advance: true,
      action: "hold-stale",
    },
  ),
  task(
    "inventory-confirm-passing",
    "train",
    "Inventory Review",
    "Someone proposed teaching Inventory Review a new number result. First inspect the retained checks and its exact count helper. If the typed count contract already passes, preserve the skill as-is.",
    {
      before: [
        entry("run/inspect/countStock", { entries: "string[]" }, "number"),
      ],
      target: [
        entry("run/inspect/countStock", { entries: "string[]" }, "number"),
      ],
      action: "keep-current",
    },
  ),
  task(
    "orders-buyer-lane",
    "train",
    "Order Intake",
    "Order Intake is merging the buyer name with the order identifier. Fix the reusable child boundary so that the order identity and buyer supplied by upstream callers are two separate named inputs.",
    {
      before: [entry("run/intake/resolveOrder", { order: "string" }, "string")],
      target: [
        entry(
          "run/intake/resolveOrder",
          { order: "string", buyer: "string" },
          "string",
        ),
      ],
      action: "stage-local-patch",
    },
  ),
  task(
    "events-expiry-compare",
    "train",
    "Event Holds",
    "When Event Holds decides whether a reserved room is still on hold, it needs the observation time, not just the expiry. Fix that internal boolean contract under the evidence stage and retain the stable top-level API.",
    {
      before: [
        entry("run/evidence/checkExpiry", { expiresAt: "number" }, "boolean"),
      ],
      target: [
        entry(
          "run/evidence/checkExpiry",
          { expiresAt: "number", observedAt: "number" },
          "boolean",
        ),
      ],
      action: "stage-local-patch",
    },
  ),
  task(
    "survey-child-boolean-gate",
    "train",
    "Survey Review",
    "Callers of Survey Review are treating the result of its eligibility gate as a free-form explanation. Align that nested gate with its intended yes/no meaning, while leaving the separate explanation callable intact.",
    {
      before: [
        entry("run/eligibility/eligible", { age: "number" }, "string"),
        entry("run/eligibility/explain", { answer: "boolean" }, "string"),
      ],
      target: [entry("run/eligibility/eligible", { age: "number" }, "boolean")],
      action: "stage-local-patch",
    },
  ),
  task(
    "shift-missing-audit",
    "train",
    "Shift Notes",
    "Shift Notes needs a separate checklist audit under its handoff stage. Give that child a list of required checkpoints as input and a list of unresolved checkpoint names as output. Don't change the existing numbered note helper.",
    {
      before: [entry("run/handoff/numberNote", { note: "string" }, "number")],
      target: [
        entry(
          "run/handoff/auditChecklist",
          { checkpoints: "string[]" },
          "string[]",
        ),
      ],
      action: "stage-local-patch",
    },
  ),
  task(
    "route-older-superseded",
    "train",
    "Routing Review",
    "The failed helper report for Routing Review might have been attached to the archived skill rather than the open working copy. Identify the source of that evidence and only repair if it proves a current failure.",
    {
      before: [
        entry("run/diagnose/routeContext", { cue: "string" }, "boolean"),
      ],
      target: [entry("run/diagnose/routeContext", { cue: "string" }, "string")],
      evidence: "archive",
      action: "hold-evidence",
    },
  ),
  task(
    "roster-stable-scope",
    "train",
    "Roster Check",
    "A patch was proposed for Roster Check's name-list helper. Compare what the exact retained check asked for with the compiled working skill and avoid a cosmetic rewrite if the contract is already satisfied.",
    {
      before: [
        entry("run/verify/rosterNames", { members: "string[]" }, "string[]"),
      ],
      target: [
        entry("run/verify/rosterNames", { members: "string[]" }, "string[]"),
      ],
      action: "keep-current",
    },
  ),
  task(
    "payments-review-no-write",
    "train",
    "Payment Evidence",
    "I need to diagnose the Payment Evidence policy's malformed nested receipt result. The owner has frozen edits for this review. Identify the current failing child and preserve its working and retained versions.",
    {
      before: [
        entry("run/review/receiptAccepted", { receipt: "string" }, "string"),
      ],
      target: [
        entry("run/review/receiptAccepted", { receipt: "string" }, "boolean"),
      ],
      authority: "denied",
      action: "hold-authorization",
    },
  ),
  task(
    "clinical-handoff-coedit",
    "train",
    "Supplies Handoff",
    "A coordinator started a coedit on Supplies Handoff after the retained count check ran. Check the authorization revision before repairing the tally helper. Keep her changes if the authorized moment has moved.",
    {
      before: [
        entry(
          "run/count/availableSupplies",
          { supplies: "string[]" },
          "string",
        ),
      ],
      target: [
        entry(
          "run/count/availableSupplies",
          { supplies: "string[]" },
          "number",
        ),
      ],
      advance: true,
      action: "hold-stale",
    },
  ),
  task(
    "warehouse-review-leaf-location",
    "train",
    "Bin Assignment",
    "Bin Assignment's generator placed the reserve check outside the allocation folder. Repair its location under the allocation stage where future callers can find it, and remove the old callable so there is only one authoritative path.",
    {
      before: [entry("run/reserveCheck", { bin: "string" }, "boolean")],
      target: [
        entry("run/allocate/reserveCheck", { bin: "string" }, "boolean"),
      ],
      remove: ["run/reserveCheck.nl"],
      action: "stage-local-patch",
    },
  ),
  task(
    "held-screening-batches",
    "test",
    "Committee Screen",
    "Committee Screen currently treats an entire referral batch as one note. Review the exact retained regression and repair the sibling stages so the first accepts separate referral IDs and the second explains one held referral with the ID intact.",
    {
      before: [
        entry("run/screen/chooseReferrals", { note: "string" }, "string[]"),
        entry("run/explain/explainHold", { reason: "string" }, "string"),
      ],
      target: [
        entry(
          "run/screen/chooseReferrals",
          { referralIds: "string[]" },
          "string[]",
        ),
        entry(
          "run/explain/explainHold",
          { reason: "string", referralId: "string" },
          "string",
        ),
      ],
      action: "stage-local-patch",
    },
  ),
  task(
    "held-safety-pass-no-change",
    "test",
    "Gate Validation",
    "The morning report says Gate Validation needs a different disposition. Check the retained current acceptance witness and confirm whether its gate already returns the typed yes/no answer without making any change.",
    {
      before: [entry("run/gate/allowPassage", { gate: "string" }, "boolean")],
      target: [entry("run/gate/allowPassage", { gate: "string" }, "boolean")],
      action: "keep-current",
    },
  ),
  task(
    "held-neighbor-service-regression",
    "test",
    "Desk Triage",
    "Desk Triage's ownership review says only its deepest notice probe should have the notification service. Use the latest check to put the scope on that exact callable and keep the public dispatcher free of the service.",
    {
      before: [entry("run/check/notes/readUnseen", { id: "string" }, "string")],
      target: [entry("run/check/notes/readUnseen", { id: "string" }, "string")],
      scope: {
        original: ["run.nl", "run/check/notes/readUnseen.nl"],
        required: ["run/check/notes/readUnseen.nl"],
      },
      action: "stage-local-patch",
    },
  ),
  task(
    "held-authorization-lag",
    "test",
    "Hearing Intake",
    "The Hearing Intake maintainer approved one snapshot before the clerk changed the docket metadata. Confirm whether that approval still covers the working head before changing the nested docket check. Keep the clerk's revision intact.",
    {
      before: [entry("run/triage/checkDocket", { docket: "string" }, "number")],
      target: [
        entry("run/triage/checkDocket", { docket: "string" }, "boolean"),
      ],
      advance: true,
      action: "hold-stale",
    },
  ),
  task(
    "held-archive-same-local-name",
    "test",
    "Document Routing",
    "Two editions of Document Routing have the same helper name. Find which edition produced the failing native check, and don't edit the operating skill when the evidence only belongs to the older copy.",
    {
      before: [entry("run/check/pickFolder", { document: "string" }, "string")],
      target: [
        entry(
          "run/check/pickFolder",
          { document: "string", directory: "string" },
          "string",
        ),
      ],
      evidence: "archive",
      action: "hold-evidence",
    },
  ),
  task(
    "held-review-approved-but-readonly",
    "test",
    "Equipment Returns",
    "I am authorized to inspect the exact retained Equipment Returns run, but the actual skill edit isn't approved. Identify how the typed condition differs from the current child outcome and leave both source editions untouched.",
    {
      before: [entry("run/confirm/isReturned", { item: "string" }, "string")],
      target: [entry("run/confirm/isReturned", { item: "string" }, "boolean")],
      authority: "denied",
      action: "hold-authorization",
    },
  ),
] as const;

export type SkillMaintenanceWorld = (typeof openSkillMaintenanceWorlds)[number];
