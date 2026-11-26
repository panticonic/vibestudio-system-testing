export type NotificationSeed = {
  id: string;
  title: string;
  revision?: number;
  at?: number;
  account?: "assigned" | "neighbor";
  read?: boolean;
  kind?: string;
  channel?: string;
};
export type NotificationChange =
  | { put: NotificationSeed }
  | { remove: string; account?: "assigned" | "neighbor" };
type State =
  | "pending"
  | "read"
  | "superseded"
  | "hidden"
  | "missing"
  | "ambiguous"
  | "scope-changed";
type Receipt =
  | "applied"
  | "idempotent"
  | "older"
  | "collision"
  | "removed"
  | "missing"
  | "none";
type CaseInput = {
  requestedAnswer: boolean;
  desk: string;
  initial: NotificationSeed[];
  change?: NotificationChange;
  transition?: "rotate" | "switch" | "retire";
  expected: {
    action: "acknowledge" | "retain" | "hold";
    state: State;
    target: [string, number] | null;
    receipt: Receipt;
    before: string[];
    attention: string[] | null;
    retained: string[] | null;
  };
};
function scenario(
  id: string,
  goal: string,
  source: string,
  split: "train" | "held",
  input: CaseInput,
) {
  return {
    id: `notification-state-${id}`,
    goal,
    split: split === "held" ? "test" : "train",
    sourceGroup: `vibestudio.notification-state.${source}`,
    workspace: "system",
    kind: "notificationState",
    ...input,
  } as const;
}

const n = (
  id: string,
  title: string,
  options: Omit<NotificationSeed, "id" | "title"> = {},
): NotificationSeed => ({ id, title, ...options });

export const openNotificationStateWorlds = [
  scenario(
    "late-export-update",
    "The Archive desk already closed the export inspection. A delayed status may have arrived. Please check whether it reopened the work or merely replayed an old result, and leave the records alone.",
    "archive-export-reordering",
    "train",
    {
      requestedAnswer:true,
      desk: "Archive",
      initial: [n("export", "Export inspected", { revision: 3, read: true })],
      change: { put: n("export", "Export running", { revision: 2 }) },
      expected: {
        action: "retain",
        state: "read",
        target: ["export", 3],
        receipt: "older",
        before: [],
        attention: [],
        retained: ["export"],
      },
    },
  ),
  scenario(
    "identical-printer-retry",
    "Someone retried the exact receipt on Print Desk after I read it. Tell me whether it needs attention again. Keep the existing receipt and its original read time.",
    "print-idempotency",
    "train",
    {
      requestedAnswer:true,
      desk: "Print Desk",
      initial: [n("print", "Proof printed", { read: true })],
      change: { put: n("print", "Proof printed") },
      expected: {
        action: "retain",
        state: "read",
        target: ["print", 1],
        receipt: "idempotent",
        before: [],
        attention: [],
        retained: ["print"],
      },
    },
  ),
  scenario(
    "frozen-review-conflict",
    "Records Desk shows a discrepancy in the permit-review notice. I need the retained decision and whether it is still pending before I sign anything. Do not acknowledge it.",
    "permit-version-conflict",
    "train",
    {
      requestedAnswer:true,
      desk: "Records Desk",
      initial: [
        n("permit", "Permit review still pending"),
        n("receipt", "Purchase received", { read: true, at: 22 }),
      ],
      change: { put: n("permit", "Permit review cleared") },
      expected: {
        action: "retain",
        state: "pending",
        target: ["permit", 1],
        receipt: "collision",
        before: ["permit"],
        attention: ["permit"],
        retained: ["receipt", "permit"],
      },
    },
  ),
  scenario(
    "stock-count-correction",
    "The Stockroom posted a corrected count under the original notice. Read the latest count and mark that exact corrected notice read so the shift can close.",
    "stockroom-correction",
    "train",
    {
      requestedAnswer:false,
      desk: "Stockroom",
      initial: [n("quantity", "Count 112", { read: true })],
      change: {
        put: n("quantity", "Corrected count 119", { revision: 2, at: 21 }),
      },
      expected: {
        action: "acknowledge",
        state: "pending",
        target: ["quantity", 2],
        receipt: "applied",
        before: [],
        attention: [],
        retained: ["quantity"],
      },
    },
  ),
  scenario(
    "courier-original-only",
    "At Dispatch, clear the 16:00 courier notice only if that is still the notice on file. If the arrival window changed, leave that new notice for the coordinator and explain why.",
    "courier-conditional-clear",
    "train",
    {
      requestedAnswer:true,
      desk: "Dispatch",
      initial: [n("courier", "Courier ETA 16:00")],
      change: {
        put: n("courier", "Courier ETA 18:20", { revision: 2, at: 23 }),
      },
      expected: {
        action: "hold",
        state: "superseded",
        target: ["courier", 2],
        receipt: "applied",
        before: ["courier"],
        attention: ["courier"],
        retained: ["courier"],
      },
    },
  ),
  scenario(
    "photo-proof-backdated",
    "Photo Intake received a corrected ingest record dated earlier than the neighboring contact sheet. Tell me what attention should show now and leave both items pending.",
    "photo-backdated-ingest",
    "train",
    {
      requestedAnswer:true,
      desk: "Photo Intake",
      initial: [
        n("camera", "First ingest", { at: 32 }),
        n("sheet", "Contact sheet", { at: 27 }),
      ],
      change: {
        put: n("camera", "Corrected camera ingest", { revision: 2, at: 22 }),
      },
      expected: {
        action: "retain",
        state: "pending",
        target: ["camera", 2],
        receipt: "applied",
        before: ["camera", "sheet"],
        attention: ["sheet", "camera"],
        retained: ["sheet", "camera"],
      },
    },
  ),
  scenario(
    "duplicate-check-in",
    "Stage Door says the volunteer check-in was already noticed. Confirm the exact retained check-in and avoid touching it if present in the read history.",
    "stage-door-duplicate",
    "train",
    {
      requestedAnswer:true,
      desk: "Stage Door",
      initial: [
        n("volunteer", "Volunteer check-in", { read: true }),
        n("lights", "Lighting check"),
      ],
      expected: {
        action: "retain",
        state: "read",
        target: ["volunteer", 1],
        receipt: "none",
        before: ["lights"],
        attention: ["lights"],
        retained: ["lights", "volunteer"],
      },
    },
  ),
  scenario(
    "matinee-only",
    "At Box Office I've reviewed the matinee access note. Clear that notice only. Keep the evening access follow-up in attention and confirm both are still in the book.",
    "theatre-partial-ack",
    "train",
    {
      requestedAnswer:true,
      desk: "Box Office",
      initial: [
        n("matinee", "Matinee access reviewed"),
        n("evening", "Evening access follow-up", { at: 31 }),
      ],
      expected: {
        action: "acknowledge",
        state: "pending",
        target: ["matinee", 1],
        receipt: "none",
        before: ["evening", "matinee"],
        attention: ["evening"],
        retained: ["evening", "matinee"],
      },
    },
  ),
  scenario(
    "homonymous-hearing",
    "Please mark the Hearing Room intake confirmation read if you can tell which one is mine. My note literally says ‘Intake confirmed’ and has no docket or date.",
    "hearing-identical-label",
    "train",
    {
      requestedAnswer:true,
      desk: "Hearing Room",
      initial: [
        n("intake-a", "Intake confirmed"),
        n("intake-b", "Intake confirmed"),
      ],
      expected: {
        action: "hold",
        state: "ambiguous",
        target: null,
        receipt: "none",
        before: ["intake-a", "intake-b"],
        attention: ["intake-a", "intake-b"],
        retained: ["intake-a", "intake-b"],
      },
    },
  ),
  scenario(
    "same-key-other-desk",
    "I reviewed the maintenance completion on Workshop Desk. A neighboring desk has a same-numbered completion. Clear mine and leave that other desk alone.",
    "workshop-per-account-key",
    "train",
    {
      requestedAnswer:false,
      desk: "Workshop Desk",
      initial: [
        n("done", "Maintenance complete"),
        n("done", "Neighbor maintenance complete", { account: "neighbor" }),
      ],
      expected: {
        action: "acknowledge",
        state: "pending",
        target: ["done", 1],
        receipt: "none",
        before: ["done"],
        attention: [],
        retained: ["done"],
      },
    },
  ),
  scenario(
    "other-mailbox-only",
    "Someone mentioned a proof approval on Art Intake. If it's actually only in another mailbox I want to know this desk has nothing to clear, and leave the other review alone.",
    "proof-foreign-evidence",
    "train",
    {
      requestedAnswer:true,
      desk: "Art Intake",
      initial: [n("approval", "Proof approved", { account: "neighbor" })],
      expected: {
        action: "hold",
        state: "missing",
        target: null,
        receipt: "none",
        before: [],
        attention: [],
        retained: [],
      },
    },
  ),
  scenario(
    "withdrawn-facilities-alert",
    "See whether the withdrawn Facilities water-isolation alert is still in attention or in history. I need to distinguish a producer withdrawal from somebody reading it.",
    "facilities-withdrawal",
    "train",
    {
      requestedAnswer:true,
      desk: "Facilities",
      initial: [
        n("water", "Water isolation"),
        n("local", "Key pickup", { at: 23 }),
      ],
      change: { remove: "water" },
      expected: {
        action: "hold",
        state: "missing",
        target: null,
        receipt: "removed",
        before: ["local", "water"],
        attention: ["local"],
        retained: ["local"],
      },
    },
  ),
  scenario(
    "removed-history",
    "At Registration an obsolete attendee-export receipt was removed after it was read. Check whether the old read entry still survives and keep the current accessibility note.",
    "registration-history-remove",
    "train",
    {
      requestedAnswer:true,
      desk: "Registration",
      initial: [
        n("old", "Obsolete attendee export", { read: true }),
        n("access", "Accessibility requests"),
      ],
      change: { remove: "old" },
      expected: {
        action: "hold",
        state: "missing",
        target: null,
        receipt: "removed",
        before: ["access"],
        attention: ["access"],
        retained: ["access"],
      },
    },
  ),
  scenario(
    "retire-neighbor-row",
    "The Permit Desk item and an adjacent mailbox item share a key. Check that a withdrawal on the other mailbox didn't remove the permit here. Leave our permit in attention.",
    "permit-withdrawal-isolation",
    "train",
    {
      requestedAnswer:true,
      desk: "Permit Desk",
      initial: [
        n("renew", "Local renewal notice"),
        n("renew", "Adjacent renewal notice", { account: "neighbor" }),
      ],
      change: { remove: "renew", account: "neighbor" },
      expected: {
        action: "retain",
        state: "pending",
        target: ["renew", 1],
        receipt: "removed",
        before: ["renew"],
        attention: ["renew"],
        retained: ["renew"],
      },
    },
  ),
  scenario(
    "repeat-removal",
    "Nothing should remain of last week's returned-kit alert on Tool Desk. Verify the repeated withdrawal was harmless and leave the inventory receipt in place.",
    "tool-desk-absent-removal",
    "train",
    {
      requestedAnswer:true,
      desk: "Tool Desk",
      initial: [n("inventory", "Inventory recorded", { read: true })],
      change: { remove: "returned" },
      expected: {
        action: "hold",
        state: "missing",
        target: null,
        receipt: "missing",
        before: [],
        attention: [],
        retained: ["inventory"],
      },
    },
  ),
  scenario(
    "invite-replaced-by-brief",
    "Our Green Room invitation disappeared after a briefing message. Find which event explains it. I don't want either record acknowledged or anyone contacted.",
    "green-room-invite-suppression",
    "train",
    {
      requestedAnswer:true,
      desk: "Green Room",
      initial: [
        n("invite", "Green Room invitation", {
          kind: "channel.invite",
          channel: "green",
        }),
      ],
      change: {
        put: n("brief", "Production briefing", {
          kind: "agent.message",
          channel: "green",
          at: 18,
        }),
      },
      expected: {
        action: "retain",
        state: "hidden",
        target: ["invite", 1],
        receipt: "applied",
        before: ["invite"],
        attention: ["brief"],
        retained: ["brief"],
      },
    },
  ),
  scenario(
    "read-brief-invite-hidden",
    "I remember the Cast Lounge invitation before the production note arrived. The note is already read. Check why the invitation didn't come back and keep the retained evidence.",
    "cast-message-history-suppression",
    "train",
    {
      requestedAnswer:true,
      desk: "Cast Lounge",
      initial: [
        n("invite", "Cast Lounge invitation", {
          kind: "channel.invite",
          channel: "cast",
        }),
      ],
      change: {
        put: n("note", "Production note", {
          kind: "agent.message",
          channel: "cast",
          read: true,
        }),
      },
      expected: {
        action: "retain",
        state: "hidden",
        target: ["invite", 1],
        receipt: "applied",
        before: ["invite"],
        attention: [],
        retained: ["note"],
      },
    },
  ),
  scenario(
    "other-channel-not-suppressing",
    "On Sound Desk I have read the rehearsal invitation. A note in the equipment channel should be kept pending. Clear only the rehearsal invitation if both items still resolve independently.",
    "sound-cross-channel",
    "train",
    {
      requestedAnswer:false,
      desk: "Sound Desk",
      initial: [
        n("invite", "Rehearsal invitation", {
          kind: "channel.invite",
          channel: "rehearsal",
        }),
      ],
      change: {
        put: n("gear", "Equipment note", {
          kind: "agent.message",
          channel: "gear",
          at: 17,
        }),
      },
      expected: {
        action: "acknowledge",
        state: "pending",
        target: ["invite", 1],
        receipt: "applied",
        before: ["invite"],
        attention: ["gear"],
        retained: ["gear", "invite"],
      },
    },
  ),
  scenario(
    "other-account-not-suppressing",
    "Gallery Desk still needs its preview invitation even if another account got a note from the same preview channel. Verify that separation and leave it pending.",
    "gallery-cross-account-suppression",
    "train",
    {
      requestedAnswer:true,
      desk: "Gallery Desk",
      initial: [
        n("invite", "Preview invitation", {
          kind: "channel.invite",
          channel: "preview",
        }),
      ],
      change: {
        put: n("neighbor-note", "Neighbor preview note", {
          kind: "agent.message",
          channel: "preview",
          account: "neighbor",
        }),
      },
      expected: {
        action: "retain",
        state: "pending",
        target: ["invite", 1],
        receipt: "applied",
        before: ["invite"],
        attention: ["invite"],
        retained: ["invite"],
      },
    },
  ),
  scenario(
    "withdrawal-reveals-invite",
    "The Technical Desk briefing was withdrawn. If its surviving invitation becomes visible again, keep it pending and explain the difference between the two records.",
    "technical-reveal-after-removal",
    "train",
    {
      requestedAnswer:true,
      desk: "Technical Desk",
      initial: [
        n("invite", "Technical invitation", {
          kind: "channel.invite",
          channel: "tech",
        }),
        n("brief", "Withdrawn briefing", {
          kind: "agent.message",
          channel: "tech",
          at: 29,
        }),
      ],
      change: { remove: "brief" },
      expected: {
        action: "retain",
        state: "pending",
        target: ["invite", 1],
        receipt: "removed",
        before: ["brief"],
        attention: ["invite"],
        retained: ["invite"],
      },
    },
  ),
  scenario(
    "restored-owner-generation",
    "Wardrobe Desk briefly reconnected. Clear the fitting receipt if that same desk is still authorized and the current receipt is the unchanged one I reviewed.",
    "wardrobe-reconnect",
    "train",
    {
      requestedAnswer:false,
      desk: "Wardrobe Desk",
      initial: [n("fitting", "Fitting receipt")],
      transition: "rotate",
      expected: {
        action: "acknowledge",
        state: "pending",
        target: ["fitting", 1],
        receipt: "none",
        before: ["fitting"],
        attention: [],
        retained: ["fitting"],
      },
    },
  ),
  scenario(
    "handover-retired",
    "Closing Desk was retired during handover. I don't want spare inbox access. Check whether the old opening checklist can still be reviewed or cleared, and report where authority ended.",
    "closing-desk-revocation",
    "train",
    {
      requestedAnswer:true,
      desk: "Closing Desk",
      initial: [n("checklist", "Opening checklist")],
      transition: "retire",
      expected: {
        action: "hold",
        state: "scope-changed",
        target: null,
        receipt: "none",
        before: ["checklist"],
        attention: null,
        retained: null,
      },
    },
  ),
  scenario(
    "new-owner-same-slug",
    "Please clear the payroll receipt on the Finance Review desk I had open. If the subscription moved to someone else's desk, leave both records and tell me it needs a fresh assignment.",
    "finance-owner-handover",
    "train",
    {
      requestedAnswer:true,
      desk: "Finance Review",
      initial: [
        n("payroll", "Payroll receipt"),
        n("payroll", "Payroll receipt", { account: "neighbor", revision: 2 }),
      ],
      transition: "switch",
      expected: {
        action: "hold",
        state: "scope-changed",
        target: null,
        receipt: "none",
        before: ["payroll"],
        attention: null,
        retained: null,
      },
    },
  ),
  scenario(
    "held-safety-revision-collision",
    "An “all clear” appeared to use the same incident version as the already-read blocked report on Safety File. Determine whether the all-clear is authoritative. Keep the earlier reviewed record as evidence.",
    "retained-safety-collision",
    "held",
    {
      requestedAnswer:true,
      desk: "Safety File",
      initial: [
        n("incident", "East access remains blocked", {
          revision: 8,
          read: true,
          at: 33,
        }),
      ],
      change: {
        put: n("incident", "East access all clear", { revision: 8, at: 33 }),
      },
      expected: {
        action: "retain",
        state: "read",
        target: ["incident", 8],
        receipt: "collision",
        before: [],
        attention: [],
        retained: ["incident"],
      },
    },
  ),
  scenario(
    "held-cold-storage-reopened",
    "Cold Storage says there was a new reading on a valve check I cleared last shift. Check if it needs attention again and keep the new reading for the oncoming lead.",
    "cold-storage-reopen",
    "held",
    {
      requestedAnswer:true,
      desk: "Cold Storage",
      initial: [
        n("valve", "Valve checked 7°C", { read: true, revision: 4, at: 78 }),
      ],
      change: {
        put: n("valve", "Valve checked 11°C", { revision: 5, at: 80 }),
      },
      expected: {
        action: "retain",
        state: "pending",
        target: ["valve", 5],
        receipt: "applied",
        before: [],
        attention: ["valve"],
        retained: ["valve"],
      },
    },
  ),
  scenario(
    "held-catalog-missing-replacement",
    "At Label Catalog, confirm whether the published blue-label draft is still waiting. I only reviewed the original draft, so shouldn't clear an unreviewed correction.",
    "catalog-unreviewed-revision",
    "held",
    {
      requestedAnswer:true,
      desk: "Label Catalog",
      initial: [n("label", "Blue-label draft")],
      transition: "rotate",
      change: {
        put: n("label", "Blue-label revised edition", { revision: 6, at: 82 }),
      },
      expected: {
        action: "hold",
        state: "superseded",
        target: ["label", 6],
        receipt: "applied",
        before: ["label"],
        attention: ["label"],
        retained: ["label"],
      },
    },
  ),
  scenario(
    "held-audit-no-credential-turnover",
    "Exhibit Review moved to a different review subscription while I was opening the checklist. Record the last authorized attention state. Do not approve or read any successor records.",
    "exhibit-review-authority-transition",
    "held",
    {
      requestedAnswer:true,
      desk: "Exhibit Review",
      initial: [
        n("exam", "Opening checklist"),
        n("receipt", "Approved lighting receipt", { read: true }),
        n("exam", "Another checklist", { account: "neighbor" }),
      ],
      transition: "switch",
      change: { put: n("exam", "Current opening checklist", { revision: 2 }) },
      expected: {
        action: "hold",
        state: "scope-changed",
        target: null,
        receipt: "applied",
        before: ["exam"],
        attention: null,
        retained: null,
      },
    },
  ),
  scenario(
    "held-assembly-message-removal-read-invite",
    "The Assembly Desk's already-read invitation vanished once the corresponding message arrived. The message was withdrawn. Verify whether the old invitation returned only to history, and preserve its original read timestamp.",
    "assembly-archived-invite-reappearance",
    "held",
    {
      requestedAnswer:true,
      desk: "Assembly Desk",
      initial: [
        n("invite", "Assembly invitation", {
          kind: "channel.invite",
          channel: "assemble",
          read: true,
        }),
        n("message", "Run-of-show", {
          kind: "agent.message",
          channel: "assemble",
        }),
      ],
      change: { remove: "message" },
      expected: {
        action: "retain",
        state: "read",
        target: ["invite", 1],
        receipt: "removed",
        before: ["message"],
        attention: [],
        retained: ["invite"],
      },
    },
  ),
  scenario(
    "held-map-tied-ids-target",
    "On Map Desk the contour and boundary review notifications share a timestamp. I signed off on the boundaries only. Mark that notice read and confirm the contour work remains queued.",
    "map-tied-time-partial-clear",
    "held",
    {
      requestedAnswer:true,
      desk: "Map Desk",
      initial: [
        n("boundary", "Boundaries reviewed", { at: 60 }),
        n("contour", "Contour review pending", { at: 60 }),
      ],
      expected: {
        action: "acknowledge",
        state: "pending",
        target: ["boundary", 1],
        receipt: "none",
        before: ["boundary", "contour"],
        attention: ["contour"],
        retained: ["boundary", "contour"],
      },
    },
  ),
] as const;

export type NotificationStateWorld =
  (typeof openNotificationStateWorlds)[number];
