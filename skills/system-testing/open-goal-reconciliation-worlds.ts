import type { IntegrationFileSeed } from "./vcs-integration-worlds.js";
import type { WorkspaceIntegrationAssignment } from "./vcs-integration-fixture.js";

type EvidenceQuestion = { question: string; path: string; keys: string[] };
type Expected = { status: "integrated" | "held"; handoff: "none" | "held" | "staged"; reason: string[] };
export type ReconciliationWorld = {
  id: string;
  kind: "local-reconciliation";
  workspace: "system";
  sourceGroup: string;
  split?: "test";
  goal: string;
  assignment: WorkspaceIntegrationAssignment;
  evidence: EvidenceQuestion[];
  expected: Expected;
  race?: { kind: "peer-edit"; path: string; field: string; text: string } | { kind: "close-window"; at: "apply" | "handoff"; note: string };
};
export const reconciliationRequiresUnits = [
  "skills/open-user-goal", "skills/open-local-reconciliation", "skills/vibestudio-vcs",
  "skills/scratch-handoff", "skills/scratch-handoff-bindings",
];
const file = (path: string, baseline: IntegrationFileSeed["baseline"], local: IntegrationFileSeed["local"],
  incoming: IntegrationFileSeed["incoming"], ownership?: IntegrationFileSeed["ownership"]): IntegrationFileSeed =>
  ({ path, baseline, local, incoming, ownership });
const quote = (question: string, path: string, ...keys: string[]): EvidenceQuestion => ({ question, path, keys });
const reviewed = (handoff: Expected["handoff"] = "none"): Expected => ({ status: "integrated", handoff, reason: [] });
const blocked = (...reason: string[]): Expected => ({ status: "held", handoff: "none", reason });

function world(id: string, title: string, goal: string, files: IntegrationFileSeed[], expected: Expected, options: {
  window?: WorkspaceIntegrationAssignment["companion"]["window"]; note?: string; race?: ReconciliationWorld["race"];
  evidence?: EvidenceQuestion[]; held?: boolean;
} = {}): ReconciliationWorld {
  return {
    id: "reconcile-" + id, kind: "local-reconciliation", workspace: "system",
    sourceGroup: "vibestudio:local-reconciliation:" + id, ...(options.held ? { split: "test" } : {}), goal,
    assignment: { files, companion: { title, window: options.window ?? "open", note: options.note ?? "Local review permitted." } },
    expected, evidence: options.evidence ?? [], ...(options.race ? { race: options.race } : {}),
  };
}

export const openReconciliationWorlds = [
  world("dispatch-channel-and-guard", "Union dispatch",
    "Bring the union dispatch change into our local settings in time for the shift. The floor's review quorum still applies. Leave dispatch a note that shows what is enabled and what protects it.",
    [file("dispatch.json", { channel: "off", quorum: 1, signature: true }, { quorum: 4 }, { channel: "crew-mail" })],
    reviewed("staged"), { evidence: [quote("What channel and review quorum are in effect?", "dispatch.json", "channel", "quorum")] }),
  world("partial-approval-uses-prior-cap", "Laboratory intake",
    "Settle the incoming lab intake change. Keep the cap our intake desk already set when it disagrees with the proposal, and adopt the new retry schedule. Keep the untouched policy intact.",
    [file("queue.json", { cap: 12, retrySeconds: [20], receipts: true }, { cap: 7 }, { cap: 40, retrySeconds: [5, 30] }, { cap: "local" })],
    reviewed()),
  world("restricted-route-and-local-custody", "Print redaction",
    "Bring in the normalized print routing while keeping our current redaction scope private and the shorter custody period. Give the next desk evidence of where output goes and how long records stay.",
    [file("route.json", { visibility: "team", destination: "/raw", format: "json" }, { visibility: "private" }, { destination: "/redacted", format: "jsonl" }),
      file("custody.json", { days: 45, legalHold: false, archive: "batch" }, { days: 8 }, { legalHold: true })],
    reviewed("staged"), { evidence: [quote("Where does the redacted output go?", "route.json", "destination", "visibility"),
      quote("Which custody duration and hold apply?", "custody.json", "days", "legalHold")] }),
  world("regional-render-approved-replacement", "Museum program catalog",
    "The print lead approved the incoming display mode for the museum's local catalog, even where ours differs. Keep our selected language and typography scale. Give me a local note about the resolved mode and language.",
    [file("render.json", { mode: "classic", locale: "en", typeScale: 1 }, { mode: "compact", locale: "cy", typeScale: 1.2 },
      { mode: "shadow", captions: true }, { mode: "incoming" })], reviewed("staged"),
    { evidence: [quote("Which mode and language did the local review settle?", "render.json", "mode", "locale")] }),
  world("roster-desk-note-at-edit", "Visitor roster",
    "Bring the new late-arrival intake rule into our visitor roster and keep the desk's current review threshold. The desk may be adding a note for the evening crew while you work. Carry forward any note it leaves and keep an evidence handoff for the crew.",
    [file("roster.json", { threshold: 1, late: false, deskNote: "Morning desk" }, { threshold: 6 }, { late: true })],
    reviewed("staged"), { race: { kind: "peer-edit", path: "roster.json", field: "deskNote", text: "Evening team checks the east entry." },
      evidence: [quote("Which threshold, late policy and desk note survived the reconciliation?", "roster.json", "threshold", "late", "deskNote")] }),
  world("preserve-clock-shift-at-edit", "Studio booking",
    "Resolve the studio calendar: along with the incoming fallback booking behavior, keep the change our desk made to the safety buffer. If the booking desk has just revised its timezone note, preserve what it now says.",
    [file("bookings.json", { buffer: 15, fallback: "decline", timezoneNote: "Desk time" }, { buffer: 25 }, { fallback: "queue" })],
    reviewed(), { race: { kind: "peer-edit", path: "bookings.json", field: "timezoneNote", text: "Desk uses venue local time after 18:00." } }),
  world("end-window-hold-before-edit", "Evidence returns",
    "Can the returns desk adopt the proposed indexing change today? Check whether its local review window still permits an integration. If it has closed, tell me why and leave our in-progress return settings where they are.",
    [file("return.json", { index: false, owner: "desk", localOnly: true }, { owner: "archive" }, { index: true })],
    blocked("closed"), { window: "closed", note: "Closing reviewer retired the returns window." }),
  world("review-pending-before-mode-choice", "Classroom recording",
    "Please reconcile the classroom recording mode only if the review desk has accepted a choice. The current and incoming modes don't carry their own approval. Explain where it stands.",
    [file("capture.json", { mode: "off", retained: 10 }, { mode: "local" }, { mode: "portable" })],
    blocked("pending"), { window: "pending", note: "Reviewer still considering local and portable capture." }),
  world("approval-retires-at-handoff", "Emergency theater rehearsal",
    "Bring the revised emergency rehearsal route into the local venue plan and keep our restricted audience. Retain a receipt for the crew if the approval window still covers it at handoff time.",
    [file("rehearsal.json", { route: "lobby", audience: "venue", staffOnly: true }, { audience: "supervisors" }, { route: "annex" })],
    reviewed("held"), { race: { kind: "close-window", at: "handoff", note: "Duty reviewer ended the rehearsal handoff window after integration." },
      evidence: [quote("Which route and audience are in the reviewed venue plan?", "rehearsal.json", "route", "audience")] }),
  world("unanswered-new-record-approver", "Transit archive",
    "Bring in the revised accession state while keeping the local archive lane. Retain a handoff only if the workspace can name the new accession approver as well as the state and archive lane.",
    [file("accession.json", { status: "pending", lane: "trial", locked: true }, { lane: "desk-a" }, { status: "accepted" })],
    reviewed("held"), { evidence: [quote("What is the accession state and lane?", "accession.json", "status", "lane"),
      quote("Who approved the new accession?", "accession.json", "approver")] }),
  world("analyze-only-override-conflict", "Print-room release audit",
    "I'm only reviewing the print-room proposal. Tell me whether the local and incoming changes to the page ceiling agree and whether either one has precedence. Leave the working settings as they are.",
    [file("print.json", { maxPages: 20, header: "approved" }, { maxPages: 12 }, { maxPages: 60 })],
    blocked("ceiling")),
  world("three-part-preservation", "Library indexing",
    "Complete the library's local indexing review across ingestion, retention, and lookup. Keep the current owner, retention horizon, and branch aliases. Bring in the new intake formatting, preservation flag, and lookup weighting for the branch. Leave reference evidence for the desk.",
    [file("ingest.json", { owner: "pool", format: "plain", queue: "books" }, { owner: "reference" }, { format: "marc" }),
      file("retain.json", { days: 45, freeze: false }, { days: 90 }, { freeze: true }),
      file("lookup.json", { aliases: ["all"], weight: 1 }, { aliases: ["north", "staff"] }, { weight: 3 })],
    reviewed("staged"), { evidence: [quote("What intake format and custody owner were retained?", "ingest.json", "owner", "format"),
      quote("How long is retention and is preservation on?", "retain.json", "days", "freeze"),
      quote("Which aliases and weighting apply to lookup?", "lookup.json", "aliases", "weight")] }),

  world("approved-window-withdrawn-during-edit", "Dock arrival registry",
    "The dock desk is still deciding whether to keep the arrival review open. If it stays open, pick up the incoming arrival-notice change and keep our existing berth queue. If the duty desk pulls the review while you're working, leave both settings as they are and tell me whether we can proceed.",
    [file("arrivals.json", { notice: "paper", queue: "general", gate: "staff" }, { queue: "bay-2" }, { notice: "shift-board" })],
    blocked("closed"), { race: { kind: "close-window", at: "apply", note: "The duty desk withdrew the dock approval during the review." } }),
  world("paired-actions-retain-exact-owner", "Registrar transfer ledger",
    "The registrar approved the incoming transfer mode over the draft's mode. Keep our current records custodian and the ledger's existing witness requirement. Leave an evidence note for the next registrar showing the resolved mode and the pending transfer's assigned custodian.",
    [file("transfer.json", { mode: "copy", witness: true }, { mode: "move" }, { mode: "staged", checksum: true }, { mode: "incoming" }),
      file("roles.json", { custodian: "records", routing: "inbox" }, { custodian: "registrar-on-duty" }, { routing: "private-window" })],
    reviewed("staged"), { evidence: [quote("Which transfer mode and witness requirement apply?", "transfer.json", "mode", "witness"),
      quote("Which custodian owns the pending transfer?", "roles.json", "custodian")] }),

  world("tidal-sample-reconciliation", "Tide sample station",
    "Review the incoming tide sample cadence. Keep our capped sample size and use the new interval. Give the next watch a local receipt for both decisions.",
    [file("samples.json", { cap: 8, interval: 15, coordinates: "local" }, { cap: 5 }, { cap: 40, interval: 6 }, { cap: "local" })],
    reviewed("staged"), { held: true, evidence: [quote("What cap and interval does the next watch use?", "samples.json", "cap", "interval")] }),
  world("winter-refuge-revision", "Winter lodge occupancy",
    "Settle the lodge occupancy settings with the incoming standby list and our two-step review. The night desk is revising its arrival instruction. Keep its current instruction and make me a receipt about it.",
    [file("occupancy.json", { standby: false, review: 1, instruction: "Wait outside" }, { review: 2 }, { standby: true })],
    reviewed("staged"), { held: true, race: { kind: "peer-edit", path: "occupancy.json", field: "instruction", text: "Ring the service bell twice." },
      evidence: [quote("Which night instruction and review count should we follow?", "occupancy.json", "instruction", "review")] }),
  world("forecast-window-cannot-release", "Community forecast",
    "Would the community forecast changes be ready today? If the desk withdrew its review authorization, keep the live settings and tell me the missing condition instead of staging the changes.",
    [file("forecast.json", { public: false, interval: 15 }, { interval: 5 }, { public: true })],
    blocked("closed"), { held: true, window: "closed", note: "Forecast desk ended review with no replacement authorization." }),
  world("reserved-gallery-handoff-hold", "Gallery caption policy",
    "Reconcile the gallery caption fallback with the approved incoming default, keeping our current caption owner. Before handing it to the desk, find the retaining language reviewer in the settled policy. Hold the handoff if their identity is unavailable.",
    [file("captions.json", { captionOwner: "library", fallback: "original", checksum: "verified" },
      { captionOwner: "gallery", fallback: "silence" }, { fallback: "transcribed" }, { fallback: "incoming" })],
    reviewed("held"), { held: true, evidence: [quote("Who owns captions and which fallback won?", "captions.json", "captionOwner", "fallback"),
      quote("Who is the retaining language reviewer?", "captions.json", "languageReviewer")] }),
];
