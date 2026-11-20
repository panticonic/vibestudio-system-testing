import type { PublicationGoalWorld } from "./open-goal-publication-worlds.js";

type Target = PublicationGoalWorld["targets"][number];
const target = (id: string, name: string, audience: string, provider: Target["intent"]["provider"],
  destination: string, environment: Target["intent"]["environment"] = "preview"): Target =>
  ({ id, name, audience, intent: { provider, destination, environment } });
const reviewed = (destination: Target, intent = destination.intent) => ({ ...destination, review: { intent } });

const peerTraining = target("peer-training", "Peer mentors preview", "Volunteer mentors", "vercel", "training/peer");
const openTraining = target("open-training", "Public training directory", "New volunteers", "cloudflare-pages", "training/public", "production");
const gate = target("reader-gate", "Signed-reader preview", "Reading-room volunteers", "cloudflare-pages", "reader/desk");
const gateInternal = target("desk-ops", "Reading room internal handbook", "Duty staff", "vercel", "reader/ops");
const outage = target("outage-weekend", "Weekend service preview", "Transit operations", "vercel", "transit/weekend");
const outageStaff = target("weekday-staff", "Weekday service preview", "Weekday drivers", "vercel", "transit/weekday");
const sponsor = target("sponsor-pack", "Sponsor handout preview", "Festival sponsors", "vercel", "sponsor/review");
const visitor = target("visitor-guide", "Visitor site destination", "Festival visitors", "cloudflare-pages", "visitors/site", "production");
const study = target("study-board", "Board audit preview", "Research audit board", "cloudflare-pages", "study/audit");
const outreach = target("study-outreach", "Outreach preview", "Community instructors", "vercel", "study/outreach");
const night = target("night-harvest", "Night harvest operations preview", "Night harvest coordinators", "vercel", "harvest/night");
const day = target("trail-day", "Day trail operations preview", "Day crew", "vercel", "harvest/day");

export const addedPublicationGoalWorlds: readonly PublicationGoalWorld[] = [
  {
    kind: "publication", workspace: "examples", id: "distinguish-submitted-peer-training-preview",
    goal: "My team thinks the peer mentors preview needs resubmission because the public training directory has no submission. Check the journal for the mentors' actual target, confirm the mentor sign-in note is visible, and tell me whether to wait or restart. Leave both destinations alone.",
    sourceGroup: "vibestudio:publication:volunteer-training-release",
    title: "Volunteer mentor orientation", caption: "Collect the induction card at reception",
    labels: [{ id: "sign-in", text: "Mentors sign in through the side entrance" }],
    targets: [{ ...reviewed(peerTraining), journal: { phase: "submitted" } }, { ...openTraining, journal: { phase: "prepared" } }],
    expected: { choice: { targetId: peerTraining.id, preflight: "check-existing", compareRevision: false },
      preflight: { status: "waiting", blockers: ["awaiting-provider"], next: "watch-provider" } },
  },
  {
    kind: "publication", workspace: "examples", id: "resume-reader-preview-with-retained-approval",
    goal: "We need to recover the signed-reader preview before the reading room opens. Does its retained approval still cover this package, and did the journal reach submission? Tell me where the handoff should resume without creating another operation.",
    sourceGroup: "vibestudio:publication:reader-signoff-continuity",
    title: "Reading room reader handbook", caption: "Collect readers' folders from the side room",
    targets: [{ ...reviewed(gateInternal), journal: { phase: "submitted" } }, { ...reviewed(gate), journal: { phase: "destination-ready" } }],
    expected: { choice: { targetId: gate.id, preflight: "check-existing", compareRevision: true },
      decision: "keep-review", preflight: { status: "waiting", blockers: ["awaiting-provider"], next: "resume-operation" } },
  },
  {
    kind: "publication", workspace: "examples", id: "hold-outage-preview-with-hidden-correction",
    goal: "Weekend operations approved the old rail replacement preview. The route wording changed and the accessibility warning is supposed to appear in the browser. Compare the old review with the current bundle and say whether the live preview is fit to return to the reviewers. Do not send it.",
    sourceGroup: "vibestudio:publication:rail-replacement-change",
    title: "Weekend rail replacement", caption: "Buses leave from Station Square",
    revisedCaption: "Buses leave from Market Place",
    labels: [{ id: "lift-notice", text: "The Station Square lift closes at 17:30", packageOnly: true }],
    targets: [reviewed(outageStaff), reviewed(outage)],
    expected: { choice: { targetId: outage.id, preflight: "prepare", compareRevision: true },
      decision: "review-public-change", preflight: { status: "blocked", blockers: ["missing-presentation"] } },
  },
  {
    kind: "publication", workspace: "examples", id: "separate-sponsor-approval-from-visitor-production",
    goal: "The sponsor group reviewed their preview, then the festival changed the entrance wording. Can the public visitor production destination inherit the previous review? Check both the retained intent and whether the current package includes the required opening note. Give me the disposition without publishing.",
    sourceGroup: "vibestudio:publication:sponsored-event-audience-boundary",
    title: "Festival welcome information", caption: "Visitor entry is through the sound garden",
    revisedCaption: "Visitor entry is through the courtyard",
    labels: [{ id: "opening-note", text: "The street entrance opens at nine" }],
    targets: [reviewed(sponsor), reviewed(visitor, sponsor.intent)],
    expected: { choice: { targetId: visitor.id, preflight: "prepare", compareRevision: true },
      decision: "review-target", preflight: { status: "blocked", blockers: ["different-request"] } },
  },
  {
    kind: "publication", workspace: "examples", id: "block-audit-preview-after-submission-on-earlier-packet", split: "test",
    goal: "The audit preview journal shows a submission from before the sample cutoff was corrected. Is that submission for the artifact now on screen, and can the audit board still use the old review? Distinguish the board preview from the outreach link and leave both operations alone.",
    sourceGroup: "vibestudio:publication:board-audit-submission-lineage",
    title: "Field study audit brief", caption: "Sample deliveries stop at 15:30",
    revisedCaption: "Sample deliveries stop at 14:45",
    targets: [{ ...reviewed(study), journal: { phase: "submitted", digest: "prior" } }, reviewed(outreach)],
    expected: { choice: { targetId: study.id, preflight: "check-existing", compareRevision: true },
      decision: "review-public-change", preflight: { status: "blocked", blockers: ["different-publication"], next: "hold-review" } },
  },
  {
    kind: "publication", workspace: "examples", id: "hold-night-harvest-preview-with-missing-package-approval", split: "test",
    goal: "The night coordinators want to recover their preview of the equipment collection plan. Find any journal entry for the night target and check whether the earlier review covers the actual entry the browser serves. The day crew's progress doesn't count. Leave the preview on hold if its entry still needs review.",
    sourceGroup: "vibestudio:publication:community-harvest-entry-clearance",
    title: "Harvest equipment collection plan", caption: "Night crews collect radios from Unit 5",
    targets: [{ ...reviewed(day), journal: { phase: "uploaded" } },
      { ...night, review: { intent: night.intent, entryApproved: false } }],
    expected: { choice: { targetId: night.id, preflight: "check-existing", compareRevision: false },
      preflight: { status: "blocked", blockers: ["public-paths", "missing-publication"], next: "hold-review" } },
  },
];
