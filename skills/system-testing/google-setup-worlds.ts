export const googleSetupPanel = "panels/welcome";
export const googleSetupSkill = "skills/google-drive/driveWorkflow";

const owners = { kind: "owners" } as const;
const gate = (afterReload: boolean) => ({
  kind: "launch-gate" as const,
  afterReload,
});
const viewport = (width: number) => ({ kind: "viewport" as const, width });
const scope = (scope: "gmail" | "workspace") =>
  [{ kind: "scope-choice", scope }, "setup-scope-confirmed"] as const;
const browser = (opening: "here" | "external") =>
  [{ kind: "browser-choice", opening }, "setup-browser-confirmed"] as const;
const reset = [{ kind: "choice-reload" }, "setup-defaults-restored"] as const;
type Evidence =
  | readonly [typeof owners, "owner-routes"]
  | readonly [ReturnType<typeof gate>, "gmail-closed"]
  | readonly [ReturnType<typeof viewport>, "viewport-fits"]
  | ReturnType<typeof scope>
  | ReturnType<typeof browser>
  | typeof reset;

type Compose = {
  caseId: string;
  action: "preserve-draft" | "reconcile-before-retry";
};
export const gmailContinuationWork = [
  { kind: "domain", domain: "google", operation: "guideGoogleWorkspace" },
  {
    kind: "domain",
    domain: "gmailReview",
    operation: "planComposeContinuation",
  },
] as const;

function journey(
  id: string,
  goal: string,
  evidence: Evidence[],
  compose?: Compose,
) {
  return {
    id,
    goal,
    checks: evidence.map(([check]) => check),
    codes: evidence.map(([, code]) => code),
    compose,
  };
}

export const managedGoogleSetupWorlds = [
  journey(
    "resume-saved-compose-after-reload",
    "After reopening setup, check whether Gmail can launch. Then audit the retained compose history and recommend what to preserve while the account owner finishes setup. Cite the controls and the decisive compose event.",
    [
      [gate(true), "gmail-closed"],
      [owners, "owner-routes"],
    ],
    { caseId: "audit-retained-draft-after-resave", action: "preserve-draft" },
  ),
  journey(
    "hold-interrupted-send-pending-setup",
    "Check Gmail's launch controls before resuming the interrupted compose card. Determine what must happen before retrying delivery and cite the exact setup and compose evidence.",
    [
      [viewport(390), "viewport-fits"],
      [gate(false), "gmail-closed"],
    ],
    {
      caseId: "reconcile-uncertain-delivery",
      action: "reconcile-before-retry",
    },
  ),
  journey(
    "owner-handoff",
    "Prepare a handoff for a new workspace owner. Confirm the next account action, distinguish where accounts and permissions are managed, and verify that Gmail cannot launch yet.",
    [
      [owners, "owner-routes"],
      [gate(false), "gmail-closed"],
    ],
  ),
  journey(
    "reopen-before-consent",
    "A teammate reopened the welcome panel and thinks that reload completed Google setup. Check the Gmail gate before and after reload and identify who can act next.",
    [
      [gate(true), "gmail-closed"],
      [owners, "owner-routes"],
    ],
  ),
  journey(
    "narrow-owner-review",
    "Review the setup instructions at a 320-pixel width before handing the phone to the account owner. Confirm the instructions and the owner links remain usable.",
    [
      [viewport(320), "viewport-fits"],
      [owners, "owner-routes"],
    ],
  ),
  journey(
    "responsive-launch-review",
    "Check that Gmail stays gated when moving the welcome panel from a 390-pixel layout to a 1280-pixel layout. Check overflow at both sizes.",
    [
      [viewport(390), "viewport-fits"],
      [gate(false), "gmail-closed"],
      [viewport(1280), "viewport-fits"],
      [gate(false), "gmail-closed"],
    ],
  ),
  journey(
    "mobile-resume-handoff",
    "Prepare a continuation note after reopening the setup panel at phone width. Verify that the account is still unconfigured, the Gmail gate stays closed, and both owner routes are still visible.",
    [
      [viewport(390), "viewport-fits"],
      [gate(true), "gmail-closed"],
      [owners, "owner-routes"],
    ],
  ),
  journey(
    "mail-only-with-account-handoff",
    "Verify that a mail-only setup starts with Gmail-only API guidance. Identify the account and permissions owners and check the launch gate.",
    [scope("gmail"), [owners, "owner-routes"], [gate(false), "gmail-closed"]],
  ),
  journey(
    "broaden-to-workspace-apps",
    "Inspect the broader app setup needed by a teammate who uses files and calendar as well as mail. Verify that this choice keeps Gmail gated.",
    [scope("workspace"), [gate(false), "gmail-closed"]],
  ),
  journey(
    "narrow-after-scope-review",
    "Compare the broad Google Workspace option with Gmail-only guidance. Leave the selector on Gmail because we only need mail.",
    [scope("workspace"), scope("gmail"), [gate(false), "gmail-closed"]],
  ),
  journey(
    "prefer-in-panel-browser",
    "Preview the local browser preference for someone who wants to keep the setup in VibeStudio. Keep Gmail as the only app.",
    [browser("here"), scope("gmail"), [owners, "owner-routes"]],
  ),
  journey(
    "return-to-normal-browser",
    "Try the in-panel option, then leave the default browser selected for a user who needs passkeys. Check that the choice doesn't change the mail scope.",
    [browser("here"), browser("external"), [gate(false), "gmail-closed"]],
  ),
  journey(
    "inside-browser-with-full-apps",
    "Preview the full suite using the in-panel browser preference. Verify the selected app scope and opening preference don't override each other.",
    [scope("workspace"), browser("here"), [gate(false), "gmail-closed"]],
  ),
  journey(
    "retain-browser-when-narrowing",
    "Review the setup for the full suite in the in-panel browser, then narrow back to Gmail without losing the browser choice.",
    [browser("here"), scope("workspace"), scope("gmail")],
  ),
  journey(
    "reload-after-browser-change",
    "After trying the in-panel browser, reload the panel and report what it defaults to. Confirm that reload leaves account setup unresolved.",
    [browser("here"), reset, [owners, "owner-routes"]],
  ),
  journey(
    "reload-after-broad-scope",
    "A colleague selected all apps and reopened the panel. Verify the scope on each side of reload and confirm that Gmail still requires account setup.",
    [scope("workspace"), reset, [gate(false), "gmail-closed"]],
  ),
  journey(
    "resume-full-app-preview-after-reload",
    "Preview both preferences, reload to see the default pair, then restore the full-suite choice while keeping the restored normal browser.",
    [scope("workspace"), browser("here"), reset, scope("workspace")],
  ),
  journey(
    "mobile-choice-readback",
    "At 390 pixels, switch to the full app suite, verify the layout there, and check the Gmail launch gate for the user doing setup on a phone.",
    [
      [viewport(390), "viewport-fits"],
      scope("workspace"),
      [viewport(390), "viewport-fits"],
      [gate(false), "gmail-closed"],
    ],
  ),
  journey(
    "handoff-across-viewport-and-reload",
    "Verify in-panel setup at phone width, then reload and inspect the account routes at desktop width. Confirm the previous browser choice didn't survive.",
    [
      [viewport(320), "viewport-fits"],
      browser("here"),
      reset,
      [viewport(1280), "viewport-fits"],
      [owners, "owner-routes"],
    ],
  ),
];
