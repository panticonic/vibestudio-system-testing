import { addedPublicationGoalWorlds } from "./open-goal-publication-expansion-worlds.js";

type Intent = {
  provider: "vercel" | "cloudflare-pages";
  destination: string;
  environment: "preview" | "production";
};
type Target = {
  id: string;
  name: string;
  intent: Intent;
  audience: string;
  review?: { intent: Intent; entryApproved?: false };
  journal?: { phase: "prepared" | "destination-ready" | "uploaded" | "submitted"; digest?: "prior" };
};
type Choice = {
  targetId: string;
  preflight: "prepare" | "check-existing" | null;
  compareRevision: boolean;
};
export type PublicationGoalWorld = {
  kind: "publication";
  workspace: "examples";
  id: string;
  goal: string;
  sourceGroup: string;
  split?: "test";
  title: string;
  caption: string;
  revisedCaption?: string;
  labels?: { id: string; text: string; packageOnly?: true }[];
  targets: Target[];
  expected: {
    choice: Choice;
    preflight?: {
      blockers: string[];
      status: "ready-for-review" | "waiting" | "blocked";
      next?: "hold-review" | "recover-receipt" | "resume-operation" | "watch-provider";
    };
    decision?: "keep-review" | "review-public-change" | "review-target";
  };
};

const candidate = (
  id: string, name: string, destination: string, audience: string,
  provider: Intent["provider"], environment: Intent["environment"] = "preview",
): Target => ({ id, name, audience, intent: { destination, provider, environment } });
const reviewed = (target: Target, reviewIntent = target.intent): Target =>
  ({ ...target, review: { intent: reviewIntent } });
const scope = (target: Target, preflight: Choice["preflight"], compareRevision = false): Choice =>
  ({ targetId: target.id, preflight, compareRevision });
const photoDesk = reviewed(candidate("preview", "Photo desk preview", "photo-desk/review", "Catalog photographers", "cloudflare-pages"));
const cityPanel = reviewed(candidate("city", "City catalog preview", "photo-desk/city", "Municipal archives", "vercel"));
const stationPress = reviewed(candidate("station-press", "Station press preview", "station/press", "Station press reviewers", "vercel"));
const stationOperations = candidate("station-ops", "Operations site", "station/operations", "Operations staff", "cloudflare-pages", "production");
const libraryPartner = reviewed(candidate("partner", "Library partners preview", "library/partner", "Library partners", "cloudflare-pages"));
const libraryDesk = reviewed(candidate("desk", "Internal desk preview", "library/desk", "Library reception", "vercel"));
const councilPublic = candidate("live", "Public notices production", "council/notices", "Households", "cloudflare-pages", "production");
const councilPreview = reviewed(candidate("council-preview", "Council communications preview", "council/notices", "Council communications", "cloudflare-pages"));
const trailPress = reviewed(candidate("trail-press", "Trail opening preview", "trail/opening", "Hiking press", "cloudflare-pages"));
const trailSupport = candidate("trail-help", "Trail volunteers", "trail/volunteers", "Volunteer guides", "vercel");
const collections = reviewed(candidate("collection-research", "Research edition preview", "collection/research", "Researchers", "vercel"));
const student = candidate("collection-student", "Student guide preview", "collection/student", "Students", "cloudflare-pages");
const emergency = reviewed(candidate("emergency", "Emergency desk preview", "harbor/emergency", "Duty supervisors", "cloudflare-pages"));
const bulletin = reviewed(candidate("bulletin", "Weekly dock bulletin", "harbor/bulletin", "Marina subscribers", "vercel"));
const festival = reviewed(candidate("festival-guides", "Festival access guide preview", "festival/access", "Mobility advisers", "vercel"));
const festivalLive = candidate("festival-live", "Festival arrivals production", "festival/arrivals", "All visitors", "vercel", "production");

export const publicationGoalWorlds: readonly PublicationGoalWorld[] = [
  {
    kind: "publication", workspace: "examples", id: "review-photo-desk-caption",
    goal: "The photographers want to review the Photo Desk preview this afternoon. Check the actual package and what reviewers will see, including the note about credit lines. Tell me whether it is ready for their review.",
    sourceGroup: "vibestudio:publication:photo-catalog-preview",
    title: "Historic image catalog", caption: "Photographs selected for the winter catalog",
    labels: [{ id: "credit", text: "Credit lines are listed beneath each photograph" }],
    targets: [cityPanel, photoDesk],
    expected: { choice: scope(photoDesk, "prepare"), preflight: { status: "ready-for-review", blockers: [] } },
  },
  {
    kind: "publication", workspace: "examples", id: "identify-station-press-package-only-warning",
    goal: "We can send the station press link for review only if the rendered preview shows the lift closure. Check that press preview and hold it if the warning is only in the package. Keep the operations site out of the decision.",
    sourceGroup: "vibestudio:publication:station-press-presentation",
    title: "Station reopening information", caption: "Pedestrian entrances open on Saturday",
    labels: [{ id: "lift-closure", text: "Lift A will remain out of service", packageOnly: true }],
    targets: [stationOperations, stationPress],
    expected: { choice: scope(stationPress, "prepare"), preflight: { status: "blocked", blockers: ["missing-presentation"] } },
  },
  {
    kind: "publication", workspace: "examples", id: "recover-library-partner-upload",
    goal: "My previous session disappeared while preparing the library partners preview. Reconstruct progress for the Cloudflare Pages partner destination and say whether to resume or wait. The reception desk preview is a different job.",
    sourceGroup: "vibestudio:publication:library-partner-recovery",
    title: "Library summer visiting hours", caption: "Use the courtyard entrance before ten",
    targets: [{ ...libraryDesk, journal: { phase: "submitted" } }, { ...libraryPartner, journal: { phase: "uploaded" } }],
    expected: { choice: scope(libraryPartner, "check-existing"), preflight: {
      status: "waiting", blockers: ["awaiting-provider"], next: "resume-operation",
    } },
  },
  {
    kind: "publication", workspace: "examples", id: "evaluate-council-production-transfer",
    goal: "Council communications signed off on the notices preview. The team wants to use the same bundle for the public production destination. Does the earlier review apply if the files are identical? Assess approval scope without changing anything.",
    sourceGroup: "vibestudio:publication:council-production-review",
    title: "Council waste collection notices", caption: "Holiday dates are listed by ward",
    targets: [councilPreview, reviewed(councilPublic, councilPreview.intent)],
    expected: { choice: scope(councilPublic, null, true), decision: "review-target" },
  },
  {
    kind: "publication", workspace: "examples", id: "reassess-trail-preview-after-correction",
    goal: "The trail opening team's preview approval predates the corrected opening date. For the trail opening preview, compare the retained package with the current package and check whether the visible preview is otherwise ready. Tell me what needs to go back to the reviewers.",
    sourceGroup: "vibestudio:publication:trail-opening-revision",
    title: "Trail opening press guide", caption: "The trail opens on Thursday",
    revisedCaption: "The trail opens on Friday",
    labels: [{ id: "crossing", text: "Use the river crossing after noon" }],
    targets: [trailSupport, trailPress],
    expected: { choice: scope(trailPress, "prepare", true), decision: "review-public-change",
      preflight: { status: "ready-for-review", blockers: [] },
    },
  },
  {
    kind: "publication", workspace: "examples", id: "recover-research-edition-without-receipt", split: "test",
    goal: "The research edition preview was meant to be deployed through Vercel, but I lost the receipt. Distinguish anything actually recorded for it from the student guide and report what needs recovering.",
    sourceGroup: "vibestudio:publication:collections-research-receipt",
    title: "Museum research collection", caption: "Sources use original catalog numerals",
    targets: [{ ...reviewed(student), journal: { phase: "submitted" } }, collections],
    expected: { choice: scope(collections, "check-existing"), preflight: {
      status: "blocked", blockers: ["missing-publication"], next: "recover-receipt",
    } },
  },
  {
    kind: "publication", workspace: "examples", id: "hold-harbor-upload-for-previous-brief",
    goal: "Someone says the Harbor emergency desk upload can resume after the handover wording changed. Check whether the retained upload is for this version. Hold it if the recorded artifact belongs to the previous brief.",
    sourceGroup: "vibestudio:publication:harbor-superseded-upload",
    title: "Harbor emergency handover", caption: "Report to the north dock",
    revisedCaption: "Report to the west dock",
    targets: [bulletin, { ...emergency, journal: { phase: "uploaded", digest: "prior" } }],
    expected: { choice: scope(emergency, "check-existing"), preflight: {
      status: "blocked", blockers: ["different-publication"], next: "hold-review",
    } },
  },
  {
    kind: "publication", workspace: "examples", id: "hold-festival-preview-with-unreviewed-entry", split: "test",
    goal: "The mobility advisers approved some files for the Festival access guide preview. Confirm whether the approved inventory really includes what the browser would serve. Stay with the advisers’ preview and flag any gap.",
    sourceGroup: "vibestudio:publication:festival-access-public-inventory",
    title: "Festival access guide", caption: "Step-free arrivals use the east courtyard",
    targets: [festivalLive, { ...festival, review: { intent: festival.intent, entryApproved: false } }],
    expected: { choice: scope(festival, "prepare"), preflight: { status: "blocked", blockers: ["public-paths"] } },
  },
  ...addedPublicationGoalWorlds,
];

export function publicationGoalLaunchFacts(world: PublicationGoalWorld) {
  return {
    title: world.title,
    labels: (world.labels ?? []).map(({ id, text }) => ({ id, text })),
    targets: world.targets.map(({ journal: _journal, ...target }) => target),
  };
}
