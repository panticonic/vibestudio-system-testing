import type { OpenGoogleSetupWorld } from "@workspace-skills/google-drive/open-google-setup-managed";

type World = OpenGoogleSetupWorld;
type Profile = World["profile"];
type Checkpoint = Profile["current"];
type Action = World["expected"]["actions"][number];

const workspace = { kind: "scope", scope: "workspace" } satisfies Action;
const here = { kind: "browser", opening: "here" } satisfies Action;
const reload = { kind: "reload" } satisfies Action;
const narrow = { kind: "viewport", width: 320 } satisfies Action;
const phone = { kind: "viewport", width: 390 } satisfies Action;
const desktop = { kind: "viewport", width: 1280 } satisfies Action;

function checkpoint(
  profileId: string,
  id: string,
  phase: Checkpoint["phase"],
  coverage: Checkpoint["coverage"] = "none",
  warning: Checkpoint["warning"] = null,
  durable = phase === "verified" && warning !== "session-only",
): Checkpoint {
  return { profileId, id, phase, coverage, durable, warning };
}
const withCurrent = (
  label: string,
  current: Checkpoint,
  history: Checkpoint[] = [],
): Profile => ({ profileId: current.profileId, label, current, history });

type Case = Omit<World, "kind" | "workspace" | "sourceGroup" | "allowed"> & {
  allowed?: World["allowed"];
};
function goal(caseData: Case): World {
  return {
    kind: "googleSetup",
    workspace: "google-workspace",
    sourceGroup: `vibestudio:google-onboarding:${caseData.id}`,
    ...caseData,
    allowed: caseData.allowed ?? ["scope", "browser", "viewport", "reload"],
  };
}
const outcome = (
  route: World["expected"]["route"],
  marker: string,
  options: Partial<World["expected"]> = {},
): World["expected"] => ({
  route,
  marker,
  actions: [],
  requestedScope: "gmail",
  history: [],
  stage: false,
  launch: false,
  scope: "gmail",
  opening: null,
  width: 1280,
  ...options,
});

export const openGoalGoogleSetupWorlds = [
  goal({
    id: "google-setup-library-first-phone-handoff",
    goal: "I'm handing this new Library Workspace to our volunteer who only needs Gmail. Set the welcome view to a 320px phone width, leave cloud steps set to this app, and stage the first thing they must do. Confirm the Gmail gate before handing the phone over.",
    profile: withCurrent(
      "New Library Workspace",
      checkpoint("library", "library-untouched", "needs-setup"),
    ),
    expected: outcome("configure-desktop", "unconfigured", {
      actions: [narrow, here],
      opening: "here",
      width: 320,
      stage: true,
    }),
  }),
  goal({
    id: "google-setup-makerspace-keep-normal-browser",
    goal: "The Makerspace will eventually use Calendar, Drive and Gmail. Show the full Workspace setup guidance in the welcome panel and keep the setup steps in my usual browser. Tell me which work belongs to our project owner before any Google connection can start.",
    profile: withCurrent(
      "Makerspace",
      checkpoint("makers", "makers-no-project", "needs-setup"),
    ),
    expected: outcome("configure-desktop", "unconfigured", {
      actions: [workspace],
      scope: "workspace",
      requestedScope: "workspace",
      opening: "external",
    }),
  }),
  goal({
    id: "google-setup-coastal-details-ready",
    goal: "Our coastal survey already saved Desktop app details. Tell me if I should create another cloud app or review consent for the original one. Leave a short handoff with the next owner action, but don't start consent.",
    profile: withCurrent(
      "Coastal survey",
      checkpoint("coastal", "coastal-desktop-saved", "ready-to-connect"),
      [checkpoint("coastal", "coastal-original-checklist", "needs-setup")],
    ),
    expected: outcome("review-consent", "configured", {
      history: ["coastal-original-checklist"],
      stage: true,
    }),
  }),
  goal({
    id: "google-setup-reopen-declined-training-consent",
    goal: "A volunteer declined consent for the Training Desk after we saved the app. Reopen the welcome panel, compare the retained decline with what is available now, and stage advice for the account owner. They decide whether to continue.",
    profile: withCurrent(
      "Training Desk",
      checkpoint(
        "training",
        "training-decline",
        "ready-to-connect",
        "none",
        "declined",
      ),
      [checkpoint("training", "training-app-saved", "ready-to-connect")],
    ),
    expected: outcome("review-consent", "configured", {
      actions: [reload],
      history: ["training-app-saved"],
      stage: true,
    }),
  }),
  goal({
    id: "google-setup-archive-drive-grant-does-not-unlock-mail",
    goal: "The archive team says the Drive setup was verified and assumes their mail is ready too. Check whether the Gmail assistant can launch, and explain the additional permission they need. Leave the existing Drive grant and welcome choices alone.",
    profile: withCurrent(
      "Municipal archive",
      checkpoint("archive", "archive-drive-proof", "verified", "drive"),
    ),
    expected: outcome("review-missing-permissions", "coverage-gap"),
  }),
  goal({
    id: "google-setup-pressroom-gmail-does-not-cover-all-apps",
    goal: "For the Press Room, show All Workspace apps in welcome and check if today's mail-only grant covers the full list. Stage what the owner should review next, without closing a usable Gmail route or opening a new consent screen.",
    profile: withCurrent(
      "Press Room",
      checkpoint("press", "press-gmail-proof", "verified", "gmail"),
    ),
    expected: outcome("review-missing-permissions", "coverage-gap", {
      actions: [workspace],
      scope: "workspace",
      requestedScope: "workspace",
      launch: true,
      stage: true,
    }),
  }),
  goal({
    id: "google-setup-community-confirmation-lost-at-reopen",
    split: "test",
    goal: "The Community Clinic said the shared inbox was verified earlier today. Reopen welcome and confirm whether that proof still holds before we promise the team access. If it was lost, preserve the old confirmation and stage the recovery for the account owner.",
    profile: withCurrent(
      "Community Clinic",
      checkpoint("clinic", "clinic-earlier-gmail", "verified", "gmail"),
    ),
    next: checkpoint(
      "clinic",
      "clinic-revoked",
      "connected",
      "none",
      "revoked",
    ),
    expected: outcome("recover-authorization", "unverified", {
      actions: [reload],
      history: ["clinic-earlier-gmail"],
      stage: true,
    }),
  }),
  goal({
    id: "google-setup-show-room-panel-choice-resets",
    split: "test",
    goal: "On the Show Room's unfinished setup, open the welcome view at 390px, switch it to show all apps and use Here for the Cloud steps. Reopen it to see which of those choices really survived. Keep the reopened choices as observed. Tell me what this says about setup progress.",
    profile: withCurrent(
      "Show Room",
      checkpoint("showroom", "showroom-unconfigured", "needs-setup"),
    ),
    expected: outcome("configure-desktop", "unconfigured", {
      actions: [phone, workspace, here, reload],
      requestedScope: "workspace",
      opening: "external",
      width: 390,
    }),
  }),
  goal({
    id: "google-setup-community-radio-ready-at-both-widths",
    goal: "The Community Radio coordinator needs to know if their Gmail link remains usable on a small phone and a full desktop. Check at 320px then 1280px, keep the current Gmail-only scope, and report whether the launch link stays available. Don't open Gmail.",
    profile: withCurrent(
      "Community Radio",
      checkpoint("radio", "radio-durable-gmail", "verified", "gmail"),
    ),
    expected: outcome("gmail-ready", "connected", {
      actions: [narrow, desktop],
      launch: true,
    }),
  }),
  goal({
    id: "google-setup-permission-audit-owner-for-field-team",
    goal: "I need to check where saved access rules live for the Field Team. Identify the right workspace to review permissions, distinguish it from account management, and leave that navigation as an owner handoff. Don't reopen consent or change a panel choice.",
    profile: withCurrent(
      "Field Team",
      checkpoint("field", "field-grant-all", "verified", "workspace"),
    ),
    expected: outcome("permissions-owner", "connected", {
      launch: true,
      stage: true,
    }),
  }),
  goal({
    id: "google-setup-account-owner-for-library-transfer",
    split: "test",
    goal: "Who manages already connected Google accounts for the library transfer? Check the actual owner route in welcome, even if the setup confirmation is unavailable. Tell me which workspace owns that screen. Leave the setup and its records alone.",
    profile: withCurrent(
      "Mobile Library",
      checkpoint(
        "library-transfer",
        "transfer-unavailable",
        "error",
        "none",
        "unavailable",
      ),
      [
        checkpoint(
          "departed-project",
          "departed-stale-alias",
          "verified",
          "gmail",
        ),
      ],
    ),
    expected: outcome("account-owner", "unavailable", { opening: "external" }),
  }),
  goal({
    id: "google-setup-admissions-confirmed-without-verification",
    goal: "Admissions received an account confirmation, but nobody has verified the connection. Check the current launch gate and stage a handoff to get the connection verified. Include the earlier saved-app confirmation so we don't redo the project setup.",
    profile: withCurrent(
      "Admissions",
      checkpoint(
        "admissions",
        "admissions-consent-received",
        "connected",
        "gmail",
      ),
      [checkpoint("admissions", "admissions-app-saved", "ready-to-connect")],
    ),
    expected: outcome("verify-connection", "unverified", {
      history: ["admissions-app-saved"],
      stage: true,
    }),
  }),
  goal({
    id: "google-setup-festival-session-only-grant",
    split: "test",
    goal: "The Festival desk can open Gmail today, but this handoff is for the next shift after a restart. Can I call their access durable? Leave the account owner a warning and the next step if the live confirmation depends on a session-only grant.",
    profile: withCurrent(
      "Festival desk",
      checkpoint(
        "festival",
        "festival-session-grant",
        "verified",
        "gmail",
        "session-only",
      ),
    ),
    expected: outcome("verify-connection", "connected", {
      launch: true,
      stage: true,
    }),
  }),
  goal({
    id: "google-setup-science-team-confirm-broad-coverage",
    goal: "The Science team will use Gmail, Calendar, Drive and Docs. Switch the welcome view to All Workspace apps and confirm whether the current approval actually covers that workflow. No additional sign-in or handoff if the grant is already sufficient.",
    profile: withCurrent(
      "Science team",
      checkpoint("science", "science-broad-grant", "verified", "workspace"),
    ),
    expected: outcome("workspace-ready", "connected", {
      actions: [workspace],
      launch: true,
      scope: "workspace",
      requestedScope: "workspace",
    }),
  }),
];
export const googleSetupRequiresUnits = [
  "skills/open-user-goal",
  "skills/google-drive",
  "skills/google-workspace",
  "panels/welcome",
  "packages/google-workspace",
  "packages/gmail",
];
