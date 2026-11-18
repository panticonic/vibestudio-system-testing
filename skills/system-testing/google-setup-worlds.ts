export const googleSetupPanel = "panels/welcome";
export const googleSetupSkill = "skills/google-drive/driveWorkflow";

const owners = { kind: "owners" } as const;
const gate = (afterReload: boolean) => ({
  kind: "launch-gate" as const,
  afterReload,
});
const viewport = (width: number) => ({ kind: "viewport" as const, width });
type Check =
  | typeof owners
  | ReturnType<typeof gate>
  | ReturnType<typeof viewport>;
type Code = "owner-routes" | "gmail-closed" | "viewport-fits";

function journey(id: string, goal: string, evidence: [Check, Code][]) {
  return {
    id,
    goal,
    checks: evidence.map(([check]) => check),
    codes: evidence.map(([, code]) => code),
  };
}

export const managedGoogleSetupWorlds = [
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
];
