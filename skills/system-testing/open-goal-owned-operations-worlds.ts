import type { z } from "zod";
import type { ownedOperationsRequestSchema } from "@workspace/natlang-services/ownedOperationsContracts";

type Request = z.infer<typeof ownedOperationsRequestSchema>;
type Incident = Extract<Request, { kind: "incident-handoff" }>;
type Release = Extract<Request, { kind: "release-continuation" }>;
type Decision = "ready" | "blocked";
type ExpectedRole = { decision?: Decision; decisions?: Decision[]; evidenceIds: string[] };

export type OperationsGoalWorld = {
  id: string;
  kind: "owned-operations";
  workspace: "system";
  goal: string;
  requestedReturnRequired: boolean;
  requestedArtifact: "none" | "if-ready";
  title: string;
  sourceGroup: string;
  split: "train" | "test";
  authority: "local-exercise" | "review-only";
  retainWhenReady: boolean;
  request: Request;
  expected: { kind: Request["kind"]; roles: Record<string, ExpectedRole>; decision: Decision };
};

function incident(id: string, title: string, goal: string, requestedReturnRequired: boolean, impact: [string, string, Decision],
  recovery: [string, string, Decision], options: { held?: boolean; review?: boolean } = {},
): OperationsGoalWorld {
  const request: Incident = {
    kind: "incident-handoff", goal,
    signals: [impact, recovery].map(([id, text]) => ({ id, text })),
  };
  return {
    id: `owned-operations-${id}`, kind: "owned-operations", workspace: "system", goal, title, requestedReturnRequired, requestedArtifact:"none",
    sourceGroup: `vibestudio:open-owned-operations:incident:${id}`, split: options.held ? "test" : "train",
    authority: options.review ? "review-only" : "local-exercise", retainWhenReady: false, request,
    expected: { kind: request.kind, roles: {
      impact: { decision: impact[2], evidenceIds: [impact[0]] },
      recovery: { decision: recovery[2], evidenceIds: [recovery[0]] },
    }, decision: impact[2] === "ready" && recovery[2] === "ready" ? "ready" : "blocked" },
  };
}

type Gate = Release["before"][number]["state"];
function release(id: string, title: string, goal: string, requestedReturnRequired: boolean, requestedArtifact: "none" | "if-ready", gates: [string, Gate, Gate][],
  decisions: [Decision, Decision], options: { held?: boolean; review?: boolean; retain?: boolean } = {},
): OperationsGoalWorld {
  const request: Release = {
    kind: "release-continuation", goal,
    before: gates.map(([id, state]) => ({ id, state })),
    after: gates.map(([id, , state]) => ({ id, state })),
  };
  return {
    id: `owned-operations-${id}`, kind: "owned-operations", workspace: "system", goal, title, requestedReturnRequired, requestedArtifact,
    sourceGroup: `vibestudio:open-owned-operations:release:${id}`, split: options.held ? "test" : "train",
    authority: options.review ? "review-only" : "local-exercise", retainWhenReady: options.retain ?? false, request,
    expected: { kind: request.kind, roles: {
      release: { decisions, evidenceIds: gates.map(([id]) => id) },
    }, decision: decisions[1] },
  };
}

export const openOwnedOperationsRequiresUnits = [
  "skills/open-user-goal", "skills/vibestudio-workflows", "workers/owned-operational-checkpoints",
];

export const openOwnedOperationsWorlds = [
  incident("billing-view-reading", "Billing view", "Split the Billing view incident between someone checking what customers still see and someone checking recovery readiness. Give me a local shift handoff grounded in both.", true,
    ["customer-view", "Customers can open the Billing view, but the current-cycle total is still absent for one cohort.", "blocked"],
    ["rebuild-drill", "The dry rebuild restored the current and previous cycle in the owned mirror. The recovery owner confirmed readiness.", "ready"]),
  incident("delivery-window-recovery", "Delivery window", "For Delivery window, establish whether customers still see late estimates and whether the recovery plan can actually be used. Review the two responsibilities independently.", true,
    ["estimate-probe", "The follow-up sampling found current delivery estimates on every previously affected customer group, with no remaining stale pages.", "ready"],
    ["replay-dependency", "The recovery exercise could not verify the queue replay dependency and remains unfinished.", "blocked"]),
  incident("duplicate-receipt-rehearsal", "Duplicate receipt", "Close out the Duplicate receipt rehearsal if the observed receipts and the recovery work both justify it. Keep the assessment inside the workspace.", true,
    ["receipt-census", "Every account in the affected receipt batch now has exactly one visible receipt and no duplicate remains.", "ready"],
    ["replay-run", "Replay of the archived batch completed, and the recovery operator verified the complete reconciliation.", "ready"]),
  incident("inbox-attachment-handoff", "Inbox attachment", "The Inbox attachment incident needs a joint handoff. Find out what is still affecting readers and whether attachment recovery has all its prerequisites.", true,
    ["affected-readers", "Participants in the affected inbox still receive attachment placeholders that cannot be opened.", "blocked"],
    ["restore-input", "The final encrypted attachment archive needed for the local restoration has not arrived.", "blocked"]),
  incident("kiosk-schedule-readback", "Kiosk schedule", "Can the next shift stand down for Kiosk schedule? Get separate conclusions about public display impact and whether the valid recovery method has been exercised.", true,
    ["kiosk-display", "All formerly stale kiosk screens now display the correct schedule and no customer issue remains.", "ready"],
    ["backup-origin", "Recovery is verified after confirming the restored offline origin and repeating the display sync with it.", "ready"]),
  incident("pickup-labels-ownership-hold", "Pickup labels", "Check the current Pickup labels docket and give me its locally approved disposition for an incident rehearsal. I need the next owner to understand what they may do.", true,
    ["pickup-visible", "All corrected pickup labels are currently visible and the affected dispatch line is clear.", "ready"],
    ["respool-control", "The approved respool of the retained queue recovered every ordered label.", "ready"], { review: true }),
  incident("import-completion-caveat", "Import completion", "I need an Import completion shift handoff. The person checking the visitors' view and the person checking the recovery path should each stick to their own evidence.", true,
    ["visitor-check", "The completion notice is missing for attendees in the final upload group.", "blocked"],
    ["owner-recovery", "The recovery owner validated the retry plan against all archived imports with a verified complete manifest.", "ready"]),
  incident("catalog-thumbnail-fallback", "Catalog thumbnail", "Qualify the local Catalog thumbnail handoff after the fallback. Determine what still needs attention before it can go back to the owning team.", true,
    ["visible-fallback", "The fallback is working in the owned mirror, but thumbnail requests still fail for visitors in the first affected storefront.", "blocked"],
    ["rollback-lane", "The rollback rehearsal found missing source derivatives and stopped before it could restore the catalog.", "blocked"]),
  incident("scheduling-tiles-continuity", "Scheduling tiles", "Prepare a local go or hold assessment for Scheduling tiles. The customer-visible result and restoration procedure need separate review before any conclusion.", true,
    ["calendar-census", "Every affected account now has the correct tiles with no unresolved schedule visibility problems.", "ready"],
    ["backfill-block", "The restoration backfill still cannot read one time-zone shard and has no verified substitute.", "blocked"], { held: true }),
  incident("training-room-warmup", "Training room warmup", "Decide whether Training room warmup is ready to hand to the morning shift. Verify what attendees can see and the caretaker's recovery readiness independently.", true,
    ["warmup-view", "All enrolled attendees can see the revised room assignment and the old issue is gone.", "ready"],
    ["room-restoration", "The caretaker tested a full restore from the exact approved room roster fixture and confirmed it was ready.", "ready"], { held: true }),
  incident("dashboard-row-reconciliation", "Dashboard row", "I need an internal disposition for the Dashboard row incident. Use any authority already on the current case and explain who should take the next step.", true,
    ["metric-row", "The dashboard still omits the current reporting row for affected viewers.", "blocked"],
    ["snapshot-read", "The recovery archive is incomplete and still has no verified replacement.", "blocked"], { review: true, held: true }),
  incident("asset-reader-permissions", "Asset reader", "For Asset reader, find out whether affected readers are still blocked and whether the tested restore is safe to hand off. Keep the review local.", true,
    ["reader-pass", "The old reader error is gone, but affected readers still cannot obtain the corresponding document.", "blocked"],
    ["access-restore", "The isolated restore has the exact scoped permission records and passed the complete local readback.", "ready"]),

  release("register-staff-training", "Register staff training", "Carry the local Register staff training release review through a worker restart and leave a private dossier only if the updated training and approval evidence permits proceeding.", false, "if-ready",
    [["shift-training", "pending", "approved"], ["floor-signoff", "approved", "approved"]], ["blocked", "ready"], { retain: true }),
  release("library-metadata-credit", "Library metadata credit", "The Library metadata credit handoff already has an approval on file. Check it after restarting the checkpoint worker against the current license and catalog evidence before anyone treats it as cleared.", true, "none",
    [["license-credit", "approved", "rejected"], ["catalog-review", "approved", "approved"]], ["ready", "blocked"]),
  release("returns-desk-partial", "Returns desk drawer", "Take the Returns desk drawer review through the retained worker boundary. The desk wants a private release record only if every outstanding signoff has cleared.", false, "if-ready",
    [["desk-lead", "pending", "approved"], ["cash-review", "pending", "pending"], ["device-check", "approved", "approved"]], ["blocked", "blocked"], { retain: true }),
  release("printer-routing-proof", "Printer routing", "Show whether Printer routing can resume after moving the release worker through its restart. Keep evidence of both assessments and privately retain the readiness dossier if the current checks justify it.", true, "if-ready",
    [["queue-probe", "approved", "approved"], ["location-owner", "approved", "approved"], ["stock-check", "approved", "approved"]], ["ready", "ready"], { retain: true }),
  release("accessible-kiosk-renewal", "Accessible kiosk reader", "Reconcile the earlier and current signoffs for Accessible kiosk reader across a restart of the owned worker. Prepare a local private readiness record if the restored checkpoint and new signoffs agree.", false, "if-ready",
    [["keyboard-review", "rejected", "approved"], ["audible-guide", "approved", "approved"]], ["blocked", "ready"], { retain: true }),
  release("warehouse-translation-review", "Warehouse translation", "Give the Warehouse translation owner an internal release disposition based on the current docket authority. Check whether they can carry its past decision forward without engaging a public release.", true, "none",
    [["hazard-copy", "approved", "approved"], ["locale-sample", "approved", "approved"]], ["ready", "ready"], { review: true, retain: true }),
  release("offline-receipt-restore", "Offline receipt staging", "Can Offline receipt staging come out of its release hold? Recover the prior assessment in the restarted local worker, then check whether the current tape recovery and layout evidence justify a change.", true, "none",
    [["tape-recovery", "pending", "approved"], ["print-layout", "rejected", "rejected"]], ["blocked", "blocked"]),
  release("visitor-direction-board", "Visitor direction board", "Bring Visitor direction board back to its retained release assessment after restarting the owned worker. Use the new map and assistance review and leave a private record if the remaining gate really cleared.", false, "if-ready",
    [["map-owner", "approved", "approved"], ["assistance-review", "pending", "approved"], ["east-entry-report", "approved", "approved"]], ["blocked", "ready"], { retain: true, held: true }),
  release("catalog-preview-withdrawal", "Catalog preview credit", "Review the Catalog preview credit release across its worker restart. The old decision may be misleading if image permission or the preview owner's readiness has changed. Keep any eligible notes private.", true, "none",
    [["preview-owner", "approved", "approved"], ["image-permission", "approved", "pending"]], ["ready", "blocked"], { retain: true, held: true }),
  release("service-counter-runbook", "Service counter runbook", "Carry Service counter runbook through a local restart exercise and reconfirm the signoffs after reading its persisted checkpoint. I only need a handover in this conversation.", true, "none",
    [["counter-lead", "approved", "approved"], ["closing-test", "approved", "approved"]], ["ready", "ready"]),
  release("dock-dispatch-approval", "Dock dispatch instructions", "Preserve the Dock dispatch instructions' earlier gated state, restart the local assessment worker, and tell me what the current gate evidence allows. Keep a readiness dossier when it qualifies.", true, "if-ready",
    [["dispatch-captain", "rejected", "approved"], ["coverage", "pending", "approved"], ["forklift-window", "approved", "approved"]], ["blocked", "ready"], { retain: true }),
  release("cashier-guide-observe", "Cashier guide", "Find the current Cashier guide release docket and tell me what the local owner permits before I ask anyone to continue its checkpoint or retain a dossier.", true, "none",
    [["training-signoff", "pending", "approved"], ["counter-readback", "approved", "approved"]], ["blocked", "ready"], { review: true, held: true }),
] satisfies OperationsGoalWorld[];
