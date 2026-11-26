export type WakeEventKind = "message" | "terminal" | "failed" | "progress";
export type WakeRow = { name: string; kind: WakeEventKind; target?: "peer" | "both" };
export type WakeOutcome = "advance" | "confirmed" | "hold-connection" | "hold-recipient" |
  "hold-revision" | "hold-cursor" | "hold-evidence" | "hold-policy";
export type DeliveryWakeWorld = {
  id: string; workspace: "system"; kind: "delivery-wake"; sourceGroup: string; split?: "test"; goal: string; subject: string;
  request: string; requestedKind: WakeEventKind; rows: WakeRow[];
  connection: "clean" | "recover" | "unavailable";
  relationship: "pending" | "settled" | "ended" | "detached";
  claim: "exact" | "peer" | "older-revision" | "earlier-cursor" | "later-cursor";
  half: boolean; missing?: string; mayWake: boolean;
  expected: WakeOutcome; requestedAnswerRequired:boolean; recoveryRequested:boolean;
};
type Options = Partial<Pick<DeliveryWakeWorld,
  "connection"|"relationship"|"claim"|"half"|"missing"|"mayWake"|"requestedKind"|"requestedAnswerRequired"|"recoveryRequested">> & { held?: true };
const item = (name: string, kind: WakeEventKind = "message", target?: WakeRow["target"]): WakeRow =>
  ({ name, kind, ...(target ? { target } : {}) });
function world(id: string, subject: string, goal: string, request: string, rows: WakeRow[], expected: WakeOutcome, opts: Options = {}): DeliveryWakeWorld {
  return {
    id: "delivery-wake-" + id, kind: "delivery-wake", requestedAnswerRequired:opts.requestedAnswerRequired??true,recoveryRequested:opts.recoveryRequested??false, workspace: "system", sourceGroup: "vibestudio:delivery-wake:" + id,
    ...(opts.held ? { split: "test" } : {}), goal, subject, request, rows, expected, requestedKind: opts.requestedKind ?? "message",
    connection: opts.connection ?? "clean", relationship: opts.relationship ?? "pending", claim: opts.claim ?? "exact",
    half: opts.half ?? false, mayWake: opts.mayWake ?? true, ...(opts.missing ? { missing: opts.missing } : {}),
  };
}
export const openDeliveryWakeRequiresUnits = [
  "skills/open-user-goal", "skills/messaging", "skills/system-testing", "workers/system-test-runner",
  "workers/pubsub-channel", "workers/delivery-wake-fixture", "packages/pubsub",
];
export const openDeliveryWakeWorlds = [
  world("rejected-first-join-backlog-once", "Dispatch notices",
    "The Dispatch notices tab rejected my first connection. Check whether the current terminal can safely recover the missed notice and keep it as one delivery.",
    "northern-loading-bay", [item("northern-loading-bay"),item("south dock","message","peer")], "advance", {requestedAnswerRequired:true,recoveryRequested:true,connection:"recover"}),
  world("no-ready-surface-hold-mailbox", "Workshop bookings",
    "I haven't been able to reconnect to Workshop bookings. Verify readiness before touching the held reservation notice.",
    "booking-update", [item("booking-update")], "hold-connection", {requestedAnswerRequired:true,recoveryRequested:false,connection:"unavailable"}),
  world("one-original-terminal-after-wake", "Volunteer rota",
    "The rota assistant woke up while its original approval was still outstanding. Recover the actual completed approval for that receiver and avoid another delivery.",
    "approve-rota", [item("approve-rota","terminal"),item("get-roster","progress")], "advance", {requestedAnswerRequired:false,recoveryRequested:true,requestedKind:"terminal"}),
  world("pre-wake-progress-is-no-terminal", "Music rehearsal",
    "The rehearsal assistant reported progress before disconnecting. Check for the real completed preparation result before accepting a wake continuation.",
    "prepare-program", [item("prepare-program","progress"),item("setup-stage","terminal")], "hold-evidence", {requestedAnswerRequired:true,recoveryRequested:false,requestedKind:"terminal"}),
  world("redrive-already-settled", "Supply cupboards",
    "The Supply cupboard notice may already have been recovered during wake. Confirm it on the exact receipt without adding another entry.",
    "new-cupboard-access", [item("new-cupboard-access")], "confirmed", {requestedAnswerRequired:true,recoveryRequested:false,relationship:"settled"}),
  world("saved-point-too-early-after-progress", "Cart reservations",
    "My saved Cart reservation pointer may predate the part that already resumed. Check it against the retained receiver before making any change.",
    "reserve-cart", [item("reserve-cart"),item("reservation-accepted","message","peer")], "hold-cursor", {requestedAnswerRequired:true,recoveryRequested:false,half:true,claim:"earlier-cursor"}),
  world("saved-point-too-far-forward", "Lock changes",
    "I was told to resume Lock changes from the position shown in the other browser. Verify that it doesn't skip an undelivered entry before resuming.",
    "lock-shift-change", [item("lock-shift-change"),item("end-lock-review")], "hold-cursor", {requestedAnswerRequired:true,recoveryRequested:false,claim:"later-cursor"}),
  world("current-lease-not-previous-revision", "Venue keys",
    "The Venue keys notice was addressed to an earlier subscription. Check the current recipient revision before continuing from the old checkpoint.",
    "key-collection", [item("key-collection")], "hold-revision", {requestedAnswerRequired:true,recoveryRequested:false,claim:"older-revision"}),
  world("detach-no-live-reattach", "Book returns",
    "The Book returns receiver disconnected before the return reminder. Establish whether its current subscription actually reattached before trying to recover it.",
    "return-reminder", [item("return-reminder")], "hold-recipient", {requestedAnswerRequired:true,recoveryRequested:false,relationship:"detached"}),
  world("original-recipient-departed", "Exhibit badge handoff",
    "The badge handoff's original recipient may have left. Verify whether their exact delivery is available before trying to resume it.",
    "badge-shift-handoff", [item("badge-shift-handoff"),item("badge-shift-handoff","message","peer")], "hold-recipient", {requestedAnswerRequired:true,recoveryRequested:false,relationship:"ended"}),
  world("confirmed-even-after-first-rejected", "Café change log",
    "The first Café log connection failed, but the change may already be in the right mailbox. Verify the recovered view and leave the existing entry alone.",
    "menu-change", [item("menu-change")], "confirmed", {requestedAnswerRequired:true,recoveryRequested:false,relationship:"settled",connection:"recover"}),
  world("context-one-for-two-receivers", "Hall openings",
    "The Hall opening notice went to two owned recipients before one woke. Recover the missed copy for the returning receiver and keep the original context shared.",
    "front-door-open", [item("front-door-open","message","both"),item("gate-check","terminal","peer")], "advance",{requestedAnswerRequired:false,recoveryRequested:true}),
  world("wrong-subscriber-even-same-terminal", "Space plan",
    "There are similar terminal replies in the Space plan. Verify whether the named receiver is the active owner before continuing any delivery.",
    "accept-room-plan", [item("accept-room-plan","terminal","both")], "hold-recipient", {requestedAnswerRequired:true,recoveryRequested:false,claim:"peer",requestedKind:"terminal"}),
  world("gapped-range-before-valid-terminal", "Library lending",
    "The Library lending completion looks correct, but a portion of the missed range may be missing. Only continue if the full original range is still available.",
    "lending-approved", [item("queue-joined"),item("lending-approved","terminal")], "hold-evidence", {requestedAnswerRequired:false,recoveryRequested:true,missing:"queue-joined",requestedKind:"terminal"}),
  world("explicit-hold-despite-complete-backfill-source", "Audio cue sheet",
    "Check whether the Audio cue handoff can recover from the saved state. The operator wants a report only while the booth is live.",
    "intermission-cue", [item("intermission-cue")], "hold-policy", {requestedAnswerRequired:true,recoveryRequested:false,mayWake:false}),
  world("current-failed-terminal-is-a-result", "Print rollers",
    "The Rollers test stopped with a failure, and the receiver restarted. Recover that exact failure acknowledgement so it can be investigated.",
    "rollers-check", [item("rollers-check","failed"),item("another-press","terminal","peer")], "advance", {requestedAnswerRequired:false,recoveryRequested:true,requestedKind:"failed"}),
  world("same-lookalike-completion-different-recipient", "Safety signs",
    "Find whether the Safety signs result belongs to the returning receiver before continuing. The other corridor has a completion with the same label.",
    "approval-signing", [item("approval-signing","terminal","peer"),item("approval-signing","progress")], "hold-evidence", {requestedAnswerRequired:true,recoveryRequested:false,requestedKind:"terminal"}),
  world("resume-after-retained-half", "Index cards",
    "The Index cards wake might have already finished the first part of the missing range. Continue from the exact saved place and preserve what is already retained.",
    "workcard-closeout", [item("start-card-index"),item("workcard-closeout","terminal")], "advance", {requestedAnswerRequired:false,recoveryRequested:true,half:true,requestedKind:"terminal"}),
  world("owned-event-shared-text-different-address", "Guest access",
    "Two Guest access roll calls used the same wording. Confirm the original addressed receiver's receipt and keep it intact.",
    "guest-pass", [item("guest-pass","message","peer"),item("guest-pass")], "confirmed", {requestedAnswerRequired:true,recoveryRequested:false,relationship:"settled"}),
  world("same-recipient-two-distinct-terminal-envelopes", "Dock confirmations",
    "The Dock confirmation receiver sees two completion lines under the same display label. Recover only the exact original outcome when it can be identified from the retained channel.",
    "dock-check", [item("dock-check","terminal"),item("dock-check","terminal")], "hold-evidence", {requestedAnswerRequired:false,recoveryRequested:true,requestedKind:"terminal"}),
  world("held-first-rejected-old-revision", "Warehouse directory",
    "I eventually reconnected to Warehouse directory. Verify whether today's receipt belongs to the subscription I bookmarked. Leave delivery pending if it doesn't.",
    "directory-released", [item("directory-released","terminal")], "hold-revision", {requestedAnswerRequired:true,recoveryRequested:false,held:true,connection:"recover",claim:"older-revision",requestedKind:"terminal"}),
  world("held-replay-advance-with-neighbor-terminal", "Field staff register",
    "The Field staff receiver missed interviews while it woke. Another receiver finished its own approval. Resume only the current recipient's surviving request.",
    "field-register-check", [item("field-register-check","terminal","peer"),item("field-register-check","terminal")], "advance",
    {requestedAnswerRequired:false,recoveryRequested:true,held:true,half:true,connection:"recover",requestedKind:"terminal"}),
  world("held-similar-ready-with-terminal-missing", "Room access",
    "An old Room access turn shows a closing result. Check if the newly connected conversation can actually prove the same original terminal.",
    "verify-access-close", [item("verify-access-close","progress"),item("verify-other-close","terminal")], "hold-evidence",
    {requestedAnswerRequired:true,recoveryRequested:false,held:true,connection:"recover",requestedKind:"terminal"}),
  world("held-loss-in-late-source-row", "Bike lockers",
    "The Bike locker receiver woke after the active shift. Verify the whole outstanding range before doing anything even if the earlier message is available.",
    "lockers-open", [item("lockers-open"),item("late-ledger-completion","terminal")], "hold-evidence",
    {requestedAnswerRequired:true,recoveryRequested:false,held:true,missing:"late-ledger-completion"}),
  world("held-no-owner-ready-even-if-settled", "Clinic supplies",
    "I need the Clinic supply receipt after reconnecting. The stored status alone isn't enough to hand it off while the original conversation still won't open.",
    "supplies-accepted", [item("supplies-accepted")], "hold-connection", {requestedAnswerRequired:true,recoveryRequested:false,held:true,connection:"unavailable",relationship:"settled"}),
  world("held-completed-two-receivers-one-context", "Guide routes",
    "Please verify that the original Guide route receipt remained intact through reconnect and that the two intended recipients didn't get duplicate context copies.",
    "guide-route-signed", [item("guide-route-signed","message","both")], "confirmed", {requestedAnswerRequired:true,recoveryRequested:false,held:true,relationship:"settled",connection:"recover"}),
  world("held-wake-failed-outcome-exactly-once", "Archive returns",
    "The Archive return tool didn't complete successfully but a terminal receipt may have survived wake. Recover that exact failure so the operator can decide what to do.",
    "scan-return-document", [item("scan-return-document","progress"),item("scan-return-document","failed")], "advance",
    {requestedAnswerRequired:false,recoveryRequested:true,held:true,half:true,requestedKind:"failed"}),
  world("held-other-scope-cursor-is-not-current", "Late visitor list",
    "The Late visitor list has an otherwise valid stored receipt. I copied a resume position from a newer view. Verify it against the original lane before advancing anything.",
    "late-visitors-reviewed", [item("late-visitors-reviewed"),item("shift-note","message","peer")], "hold-cursor",
    {requestedAnswerRequired:true,recoveryRequested:false,held:true,claim:"later-cursor"}),
] satisfies DeliveryWakeWorld[];
