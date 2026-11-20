import type { OpenGoogleHandoffWorld } from "@workspace-skills/open-google-handoff-goal/managed";

type Provider = OpenGoogleHandoffWorld["provider"];
type Thread = Provider["threads"][number];
type Mail = Thread["messages"][number];
type File = Provider["files"][number];
type FileState = Exclude<File["initial"], number>;
type Permission = Exclude<NonNullable<FileState["permissions"]>[number], number>[number];
type Expected = OpenGoogleHandoffWorld["expected"];
type Decision = Expected["decision"];
type Intent = Expected["reviews"][number];
type Stage = OpenGoogleHandoffWorld["canStage"];
const text = "text/plain";
const docs = "application/vnd.google-apps.document";
const shortcut = "application/vnd.google-apps.shortcut";
const time = (hour: number) => "2026-08-06T" + String(hour + 8).padStart(2, "0") + ":00:00Z";
const address = (name: string) => name + "@example.test";
const fileLink = (id: string) => "https://drive.google.com/file/d/" + id + "/view";
const docsLink = (id: string) => "https://docs.google.com/document/d/" + id + "/edit";
const openLink = (id: string) => "https://drive.google.com/open?id=" + id;
const item = (id: string, sender: string, subject: string, body: string, at = 0, multipart = false): Mail =>
  ({ id, from: sender, subject, body, receivedAt: time(at), ...(multipart ? { multipart } : {}) });
const thread = (id: string, messages: readonly Mail[], update?: Pick<Thread, "next" | "status">): Thread =>
  ({ id, messages, ...update });
const state = (id: string, title: string, options: { type?: string; version?: string; bytes?: string | number;
  audience?: FileState["permissions"]; trashed?: boolean } = {}): FileState => ({
    metadata: { id, name: title, mimeType: options.type ?? text, version: options.version ?? "1",
      ...(options.trashed ? { trashed: true } : {}) },
    ...(options.bytes !== undefined ? { bytes: options.bytes } : {}),
    ...(options.audience ? { permissions: options.audience } : {}),
  });
const file = (id: string, initial: File["initial"], next?: File["next"]): File => ({ id, initial, ...(next !== undefined ? { next } : {}) });
const permit = (id: string, type: string, role: string, recipient?: string, deleted = false): Permission => ({
  id, type, role, ...(recipient ? type === "domain" ? { domain: recipient } : { emailAddress: recipient } : {}), ...(deleted ? { deleted } : {}),
});
const intent = (messageId: string, fileId: string, mode: Intent["mode"] = "metadata"): Intent => ({ messageId, fileId, mode });
const ready = (mailIds: string[], assetIds: string[]): Decision => ({ status: "ready", reason: "approved", mailIds, assetIds });
const hold = (reason: Decision["reason"], mailIds: string[]): Decision => ({ status: "held", reason, mailIds, assetIds: [] });
const incomplete = (mailIds: string[] = []): Decision => ({ status: "incomplete", reason: "provider", mailIds, assetIds: [] });
const stale = (mailIds: string[]): Decision => ({ status: "stale", reason: "changed", mailIds, assetIds: [] });
const provider = (threads: readonly Thread[], files: readonly File[] = [], pages?: Provider["pages"], nextPages?: Provider["nextPages"]): Provider =>
  ({ threads, files, pages: pages ?? threads.map(({ id }) => [id]), ...(nextPages ? { nextPages } : {}) });

function scenario(
  id: string, sourceGroup: string, goal: string, world: Provider, decision: Decision,
  reviews: readonly Intent[], canStage: Stage, options: {
    heldOut?: boolean; verify?: Expected["verify"]; stage?: boolean;
  } = {},
) {
  const verify = options.verify ?? (decision.status === "ready" || decision.status === "held" ? { before: decision, result: "current" as const } : undefined);
  return {
    id: "google-handoff-" + id, kind: "google-handoff" as const, workspace: "google-workspace" as const,
    sourceGroup: "vibestudio:google-handoff:" + sourceGroup, split: options.heldOut ? "test" as const : "train" as const,
    goal, provider: world, canStage,
    expected: { reviews, decision, ...(verify ? { verify } : {}),
      stage: options.stage ?? (canStage !== "none" && (decision.status === "ready" || (canStage === "decision" && decision.status === "held"))) },
  };
}

export const openGoalGoogleHandoffWorlds = [
  scenario("lighting-packet", "theatre-lighting-first-authorized",
    "Get the lighting crew the packet Rowan personally cleared for the dress rehearsal. The discussion had a suggested file before the decision. Confirm Rowan’s actual packet still exists and save a workspace handoff for the crew.",
    provider([thread("lighting", [
      item("suggest", address("pat"), "Lighting rehearsal", "Maybe use " + fileLink("draft")),
      item("clear", "Rowan <rowan@example.test>", "Lighting rehearsal", "I clear this rehearsal packet for the crew: " + fileLink("light"), 1),
    ])], [file("light", state("light", "Dress rehearsal cue packet")), file("draft", state("draft", "Early cue list"))]),
    ready(["clear"], ["light"]), [intent("clear", "light")], "ready"),
  scenario("color-replacement", "print-color-cross-thread-replacement",
    "The print crew needs Dana’s current color card for the field guide. A first approval and a replacement went out separately. Confirm that the current Google Doc specifies warm gray paper, then save the decision for production.",
    provider([
      thread("old-print", [item("first", address("dana"), "Field guide production", "Approved the first color card: " + docsLink("first"))]),
      thread("new-print", [item("replace", address("dana"), "Field guide correction", "Replace my first approval. Use this new approved card: " + docsLink("new"), 2)]),
    ], [file("first", state("first", "Earlier colors", { type: docs, bytes: "Paper: cool gray." })),
      file("new", state("new", "Current colors", { type: docs, bytes: "Paper: warm gray. Ink: blue." }))]),
    ready(["replace"], ["new"]), [intent("replace", "new", "content")], "ready"),
  scenario("cabinet-check", "museum-report-only-byte-evidence",
    "What lock code label did Casey clear for the exhibit cabinet? I need to know whether the approved text still says RED TAG, and only need an answer here.",
    provider([thread("museum", [item("clear", address("casey"), "Cabinet label", "The approved label proof is " + openLink("label"), 1, true)])],
      [file("label", state("label", "Cabinet label", { bytes: "Label: RED TAG" }))]),
    { ...ready(["clear"], ["label"]), facts: [{ fileId: "label", quote: "RED TAG" }] }, [intent("clear", "label", "content")], "none"),
  scenario("legal-kit-external-write", "legal-kit-late-audience-page",
    "Can we use Morgan’s approved legal kit for internal training? It must have no outside writers. Our people use example.test. Record a held decision for the training coordinator if the kit is still exposed.",
    provider([thread("legal", [item("approve", address("morgan"), "Internal legal training", "Approved legal kit: " + fileLink("kit"))])],
      [file("kit", state("kit", "Legal training kit", { audience: [[permit("int", "user", "writer", address("morgan"))],
        [permit("ext", "user", "writer", "contractor@outside.test")]] }))]),
    hold("audience", ["approve"]), [intent("approve", "kit", "audience")], "decision"),
  scenario("guide-public-read", "civic-public-read-internal-write",
    "We need Kai’s approved final visitor guide. It can be read by anyone, but only example.test can edit it. Confirm those roles on Drive and leave a handoff if we can use it.",
    provider([thread("guide", [item("approved", address("kai"), "Visitor guide approval", "This is the final approved guide: " + docsLink("guide"))])],
      [file("guide", state("guide", "Visitor guide", { type: docs, audience: [[permit("public", "anyone", "reader"), permit("office", "domain", "writer", "example.test")]] }))]),
    ready(["approved"], ["guide"]), [intent("approved", "guide", "audience")], "ready"),
  scenario("two-approved-label-variants", "shipping-fallback-content-and-audience",
    "Jules cleared two shipping labels. Dispatch needs both compared on whether they still say BAY 4 and whether sharing stays inside example.test. Take the preferred label if it meets both. If it fails either condition, save the fallback only if it meets both.",
    provider([thread("labels", [item("approved", address("jules"), "Shipping labels", "Approved preferred: " + fileLink("preferred") +
      "\nApproved fallback: " + fileLink("fallback"))])], [
      file("preferred", state("preferred", "Preferred label", { bytes: "BAY 3", audience: [[permit("crew", "domain", "reader", "example.test")]] })),
      file("fallback", state("fallback", "Fallback label", { bytes: "BAY 4", audience: [[permit("lead", "user", "reader", address("dispatch"))]] })),
    ]),
    ready(["approved"], ["fallback"]), [intent("approved", "preferred", "content-and-audience"), intent("approved", "fallback", "content-and-audience")], "ready"),
  scenario("stage-program-and-map", "festival-independent-approvals",
    "We need an approved run-of-show and the approved venue map for the festival. Use Nadia’s schedule and Erin’s map. Nadia corrected the schedule later that day. Confirm that the corrected run-of-show and the unchanged map still exist and leave one handoff with both.",
    provider([
      thread("schedule", [item("early", address("nadia"), "Stage schedule", "First schedule approved: " + fileLink("v1")),
        item("corrected", address("nadia"), "Stage schedule", "This replaces my earlier schedule: " + fileLink("v2"), 1)]),
      thread("mapping", [item("map-clear", address("erin"), "Venue map", "Map is approved: " + fileLink("map"))]),
    ], [file("v2", state("v2", "Corrected run-of-show")), file("map", state("map", "Venue map"))]),
    ready(["corrected", "map-clear"], ["v2", "map"]), [intent("corrected", "v2"), intent("map-clear", "map")], "ready"),
  scenario("withdrawn-audio", "archive-authority-revocation",
    "Recover Lee’s decision about the audio transcription release. If Lee withdrew it, leave the archivists a written hold with the controlling mail and keep the recording on hold.",
    provider([thread("recordings", [
      item("clear", address("lee"), "Release transcript", "Approved for release: " + fileLink("audio")),
      item("withdraw", address("lee"), "Release transcript", "I withdraw my approval. Do not use the transcript until a new rights check.", 2),
    ])], [file("audio", state("audio", "Transcript"))]),
    hold("withdrawn", ["withdraw"]), [], "decision"),
  scenario("forward-is-not-clearance", "advisory-photo-quoted-authority",
    "Tell me whether Rosa herself cleared the headshot for the advisory panel. Our policy needs her direct approval. Record a workspace hold if all we have is somebody’s forward.",
    provider([thread("heads", [item("forward", address("assistant"), "Fwd: Rosa headshot", "Forwarded text attributed to Rosa: Approved. Use " + fileLink("picture"))])],
      [file("picture", state("picture", "Panel headshot"))]),
    hold("unresolved", ["forward"]), [], "decision"),
  scenario("simultaneous-cochair-disagreement", "governance-unresolved-cochair-approval",
    "Alma and Jo are co-chairs and both must clear the same budget summary. Can the finance team use it? Keep a written record of the gating decision either way.",
    provider([
      thread("alma", [item("approve", address("alma"), "Budget summary", "I approve " + fileLink("budget"), 1)]),
      thread("jo", [item("reject", address("jo"), "Budget summary", "I withhold approval pending the audit.", 1)]),
    ], [file("budget", state("budget", "Budget summary"))]),
    hold("unresolved", ["approve", "reject"]), [], "decision"),
  scenario("no-version-link", "maintenance-unbound-local-version",
    "Uma says the current maintenance checklist is cleared. Can you identify and confirm the exact shared file the techs can use? Please save a handoff only when that file can be established.",
    provider([thread("checklist", [item("versionless", address("uma"), "Maintenance check", "My local copy of the checklist is approved. I haven’t linked the Drive copy yet.")])]),
    hold("unresolved", ["versionless"]), [], "ready"),
  scenario("caption-without-images", "publication-partial-approval",
    "Prepare a handoff for the feature only if Ash approved both the caption and the image. The follow-up sounded promising, but the editor needs permission to use the pair together.",
    provider([thread("feature", [
      item("partial", address("ash"), "Feature approvals", "Caption approved: " + fileLink("caption") + ". Image " + fileLink("photo") + " is still in review."),
      item("other", address("riley"), "Feature approvals", "I’m happy with the image. Ash still has to decide.", 1),
    ])], [file("caption", state("caption", "Approved caption")), file("photo", state("photo", "Feature image"))]),
    hold("unresolved", ["partial"]), [], "ready"),
  scenario("trash-follow-up", "field-maps-trashed-approval",
    "The survey crew needs the original map Mar cleared. Give the crew a handoff with its current status, and keep any same-name copy out of the decision.",
    provider([thread("survey", [item("mar", address("mar"), "Survey map", "Use this exact approved copy: " + fileLink("route"))])],
      [file("route", state("route", "Survey map", { trashed: true })), file("copy", state("copy", "Duplicate map"))]),
    hold("trashed", ["mar"]), [intent("mar", "route")], "decision"),
  scenario("shortcut-is-not-original", "lab-safety-shortcut-boundary",
    "Can the lab use the safety checklist Brook linked? A shortcut is insufficient because we need Brook’s approval of the actual linked original. Record the decision either way.",
    provider([thread("safety", [item("brook", address("brook"), "Safety checklist approval", "Approved: " + fileLink("shortcut"))])],
      [file("shortcut", state("shortcut", "Safety checklist pointer", { type: shortcut }))]),
    hold("shortcut", ["brook"]), [intent("brook", "shortcut")], "decision"),
  scenario("404-exact-link", "grants-deleted-submission-link",
    "The grants team needs proof that the specific submission Jordan approved is retrievable. Save the decision in the workspace. A same-name copy will not satisfy the review.",
    provider([thread("grant", [item("jordan", address("jordan"), "Grant submission", "This final submission is approved: " + docsLink("grant"))])],
      [file("grant", 404), file("copy", state("copy", "Grant submission", { type: docs }))]),
    hold("missing", ["jordan"]), [intent("jordan", "grant")], "decision"),
  scenario("permissions-denied", "regional-plan-private-owner-barrier",
    "Ari signed off on the regional rollout plan. Tell me whether our connected account can get that specific Drive file. Leave a handoff if it is usable and flag access problems for me here.",
    provider([thread("regions", [item("signed", address("ari"), "Rollout signoff", "Approved plan: " + fileLink("rollout"))])],
      [file("rollout", 403)]),
    hold("inaccessible", ["signed"]), [intent("signed", "rollout")], "ready"),
  scenario("drive-rate-limit", "support-guide-provider-throttle",
    "Recover Kai’s approved support playbook. Save the link for the support shift only when the provider confirms it is usable. Someone should be able to retry if the provider cannot answer today.",
    provider([thread("support", [item("signed", address("kai"), "Support playbook", "Approved: " + fileLink("support"))])],
      [file("support", 429)]),
    incomplete(["signed"]), [intent("signed", "support")], "ready"),
  scenario("unreadable-final-thread", "approvals-disappeared-thread",
    "Piper’s note about the site report was in a follow-up. Confirm the full approval picture before we use the file. I want a handoff only if the approval can be established.",
    provider([thread("main", [item("draft", address("piper"), "Site report", "Proposed report: " + fileLink("site"))]),
      thread("followup", [], { status: 404 })], [file("site", state("site", "Site report"))]),
    incomplete(), [], "ready"),
  scenario("mail-search-tail-failure", "mail-scan-lost-final-page",
    "A second decision from Sam might supersede the first for the drill packet. Confirm which packet is approved before saving anything for tomorrow’s drill.",
    provider([thread("visible", [item("first", address("sam"), "Drill packet", "Initial approval: " + fileLink("drill"))])],
      [file("drill", state("drill", "Drill packet"))], [["visible"], 503]),
    incomplete(), [], "ready"),
  scenario("permission-audit-tail-failure", "shift-manual-audit-partial-read",
    "Please review Kim’s final shift manual and check that nobody outside example.test has direct access. If you can establish it, give the operations team a workspace handoff.",
    provider([thread("approval", [item("signed", address("kim"), "Shift manual", "Approved final manual: " + fileLink("manual"))])],
      [file("manual", state("manual", "Shift manual", { audience: [[permit("crew", "domain", "reader", "example.test")], 503] }))]),
    incomplete(["signed"]), [intent("signed", "manual", "audience")], "ready"),
  scenario("content-does-not-match-approval", "catering-menu-actual-content",
    "Noor approved the catering Google Doc for an allergy-safe dinner only if the current menu says SESAME-FREE. Save a written hold if the file’s actual text contradicts that requirement.",
    provider([thread("menu", [item("noor", address("noor"), "Catering approval", "Safe to use if marked sesame-free: " + docsLink("menu"))])],
      [file("menu", state("menu", "Catering menu", { type: docs, bytes: "Starter: bread with sesame oil. Entrée: rice with sesame topping." }))]),
    hold("content", ["noor"]), [intent("noor", "menu", "content")], "decision"),
  scenario("revocation-on-refresh", "purchasing-late-revocation-separate-thread",
    "Can we use Isabel’s authorized purchase sheet? Isabel may send a last-minute stop in a separate thread. Give the buyer a workspace handoff if the approval and asset stay current.",
    provider([
      thread("initial", [item("isabel", address("isabel"), "Purchase sheet", "Use this approved purchase sheet " + fileLink("order"))]),
      thread("stop", [item("revoked", address("isabel"), "Purchase sheet stop", "I withdraw my earlier approval. Pause the order.", 2)]),
    ], [file("order", state("order", "Purchase sheet"))], [["initial"]], [["initial"], ["stop"]]),
    stale(["isabel"]), [intent("isabel", "order")], "ready",
    { heldOut: true, verify: { before: ready(["isabel"], ["order"]), result: "changed" } }),
  scenario("same-version-changed-sharing", "distributor-sharing-drift-without-version-change",
    "Can we stage Reese’s distributor notice for the private example.test editorial team? Confirm direct access is still private when leaving the handoff. A recent sharing change may not alter the document revision.",
    provider([thread("notice", [item("reese", address("reese"), "Distributor notice", "Approved private notice: " + docsLink("notice"))])], [
      file("notice", state("notice", "Distributor notice", { type: docs, version: "8", audience: [[permit("team", "domain", "reader", "example.test")]] }),
        state("notice", "Distributor notice", { type: docs, version: "8", audience: [[permit("team", "domain", "reader", "example.test"), permit("everyone", "anyone", "reader")]] })),
    ]),
    stale(["reese"]), [intent("reese", "notice", "audience")], "ready",
    { heldOut: true, verify: { before: ready(["reese"], ["notice"]), result: "changed" } }),
  scenario("native-doc-changes-during-readback", "construction-current-cue-revision",
    "Save the current worksite handoff for Adi’s approved gate plan only if the Google Doc still calls for GATE 6. The site update is being changed while we’re coordinating.",
    provider([thread("site", [item("adi", address("adi"), "Gate plan", "Approved if the plan reads GATE 6: " + docsLink("gate"))])], [
      file("gate", state("gate", "Gate plan", { type: docs, version: "4", bytes: "GATE 6" }),
        state("gate", "Gate plan", { type: docs, version: "5", bytes: "GATE 9" })),
    ]),
    stale(["adi"]), [intent("adi", "gate", "content")], "ready",
    { heldOut: true, verify: { before: ready(["adi"], ["gate"]), result: "changed" } }),
  scenario("recheck-service-fails", "inspection-mail-readback-outage",
    "Get Devon’s approved cabinet inspection list ready for the inspectors. Leave a handoff only if the same approval is still available immediately before staging.",
    provider([thread("lists", [item("devon", address("devon"), "Inspection list", "Final list approved: " + fileLink("list"))], { next: 503 })],
      [file("list", state("list", "Cabinet inspection list"))]),
    incomplete(["devon"]), [intent("devon", "list")], "ready",
    { heldOut: true, verify: { before: ready(["devon"], ["list"]), result: "unavailable" } }),
  scenario("removed-guest-access", "clinic-deleted-audience-entry",
    "Confirm Uma’s approved volunteer roster says CHECK IN AT WEST DESK, and only people in example.test can see it. Former access has already been revoked. If it meets both conditions, save the handoff for the coordinator.",
    provider([thread("roster", [item("uma", address("uma"), "Volunteer roster", "This approved roster gives the check-in instruction: " + docsLink("roster"))])], [
      file("roster", state("roster", "Volunteer roster", { type: docs, bytes: "CHECK IN AT WEST DESK", audience: [
        [permit("staff", "group", "reader", address("volunteers"))], [permit("guest", "user", "reader", "visitor@outside.test", true)],
      ] })),
    ]),
    ready(["uma"], ["roster"]), [intent("uma", "roster", "content-and-audience")], "ready", { heldOut: true }),
  scenario("inherited-versus-direct-access", "community-policy-direct-versus-inherited-rights",
    "Milo approved the community operating notes. Review direct editing grants for the file. Our example.test members may edit. The shared drive's inherited vendor access is managed separately. Leave a handoff if the file has no direct external writers.",
    provider([thread("community", [item("milo", address("milo"), "Operating notes", "Approved community notes: " + docsLink("notes"))])],
      [file("notes", state("notes", "Operating notes", { type: docs, audience: [
        [{ ...permit("vendor", "group", "writer", "vendors@outside.test"),
          permissionDetails: [{ role: "writer", inherited: true }, { role: "reader", inherited: false }] }],
        [permit("members", "domain", "writer", "example.test")],
      ] }))]),
    ready(["milo"], ["notes"]), [intent("milo", "notes", "audience")], "ready", { heldOut: true }),
];
