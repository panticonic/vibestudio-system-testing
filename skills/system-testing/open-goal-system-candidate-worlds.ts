export type SystemCandidateWorld = ReturnType<typeof review>;
type Mode =
  | "compose"
  | "same"
  | "incoming"
  | "overlap"
  | "delete-edit"
  | "delete"
  | "binary"
  | "oversize";
type Decision =
  | "carry-both"
  | "keep-converged"
  | "review-incoming"
  | "hold-collision"
  | "hold-absence"
  | "hold-preview"
  | "hold-stale";
type Unit =
  | "clients/desktop-browser"
  | "clients/mobile-browser"
  | "clients/chat-terminal"
  | "extensions/mobile-debug"
  | "extensions/react-native"
  | "extensions/typecheck-service";
type Profile = {
  mode: Mode;
  unit: Unit;
  document: string;
  mayRecord: boolean;
  record: boolean;
  decision: Decision;
  moves?: true;
};
function review(
  id: string,
  split: "train" | "test",
  title: string,
  goal: string,
  profile: Profile,
) {
  return {
    id: "system-candidate-" + id,
    kind: "systemCandidateTriage",
    workspace: "system",
    split,
    sourceGroup: "vibestudio:system-candidate:" + id,
    title,
    goal,
    ...profile,
  } as const;
}
export const openSystemCandidateWorlds = [
  review(
    "separate-desktop-edits",
    "train",
    "Desktop Startup Review",
    "We added a local startup hint while upstream adjusted the retry line for Desktop Startup Review. Figure out whether both belong in the same candidate and leave me a private diagnosis.",
    {
      unit: "clients/desktop-browser",
      document: "startup-notes.md",
      mode: "compose",
      mayRecord: true,
      record: true,
      decision: "carry-both",
    },
  ),
  review(
    "shared-mobile-label",
    "train",
    "Mobile Sign-in Cue",
    "Check Mobile Sign-in Cue. The local and incoming drafts might already use the same confirmation wording. Tell me here whether we need to choose between them.",
    {
      unit: "clients/mobile-browser",
      document: "sign-in-cue.md",
      mode: "same",
      mayRecord: false,
      record: false,
      decision: "keep-converged",
    },
  ),
  review(
    "upstream-terminal-keys",
    "train",
    "Terminal Keys",
    "Verify the Terminal Keys upstream change against the local working copy before anyone applies it. Leave an internal review note if there was no competing local edit.",
    {
      unit: "clients/chat-terminal",
      document: "key-aid.md",
      mode: "incoming",
      mayRecord: true,
      record: true,
      decision: "review-incoming",
    },
  ),
  review(
    "overlapping-debug-retry",
    "train",
    "Device Retry Guide",
    "Someone changed the retry instruction in our Device Retry Guide while the incoming candidate changed it too. Find the competing revision and leave a private note for the owner to choose.",
    {
      unit: "extensions/mobile-debug",
      document: "retry-guide.md",
      mode: "overlap",
      mayRecord: true,
      record: true,
      decision: "hold-collision",
    },
  ),
  review(
    "native-removes-local-edit",
    "train",
    "Native Build Hints",
    "The incoming Native Build Hints candidate drops a file. We still maintain it locally. Determine whether the removal conflicts with local work before doing anything.",
    {
      unit: "extensions/react-native",
      document: "build-hints.md",
      mode: "delete-edit",
      mayRecord: false,
      record: false,
      decision: "hold-absence",
    },
  ),
  review(
    "clean-removed-companion",
    "train",
    "Old Typecheck Checklist",
    "Can we consider retiring the Old Typecheck Checklist in the incoming version? Check whether the local copy had any edits and keep a private record of what you observe.",
    {
      unit: "extensions/typecheck-service",
      document: "checklist-old.md",
      mode: "delete",
      mayRecord: true,
      record: true,
      decision: "review-incoming",
    },
  ),
  review(
    "binary-unreadable-reminder",
    "train",
    "Desktop Icon Reminder",
    "Tell me why the staged Desktop Icon Reminder cannot be reconciled from a text preview. Don't guess what an unavailable revision contains.",
    {
      unit: "clients/desktop-browser",
      document: "icon-reminder.dat",
      mode: "binary",
      mayRecord: false,
      record: false,
      decision: "hold-preview",
    },
  ),
  review(
    "retained-long-log",
    "train",
    "Mobile Warm Start Notes",
    "The candidate for Mobile Warm Start Notes is much longer than our ordinary prose. Check whether the file views are complete enough to make a call, and save a private note if blocked.",
    {
      unit: "clients/mobile-browser",
      document: "warm-start-notes.md",
      mode: "oversize",
      mayRecord: true,
      record: true,
      decision: "hold-preview",
    },
  ),
  review(
    "desktop-drift-before-gate",
    "train",
    "Window Retry Card",
    "Please keep a private finding about Window Retry Card only if the observed System review is still current. Another operator may have restaged it while we work.",
    {
      unit: "clients/desktop-browser",
      document: "window-retry.md",
      mode: "compose",
      mayRecord: true,
      record: false,
      moves: true,
      decision: "hold-stale",
    },
  ),
  review(
    "foreign-coordinate-sibling",
    "train",
    "Terminal Clipboard Review",
    "I need an answer about the clipboard guidance specifically. Its neighboring package note may be clean, but check the edited Clipboard Review file itself before recommending any automatic action.",
    {
      unit: "clients/chat-terminal",
      document: "clipboard-guidance.md",
      mode: "overlap",
      mayRecord: false,
      record: false,
      decision: "hold-collision",
    },
  ),
  review(
    "converged-release-rationale",
    "train",
    "Toolchain Rationale",
    "For Toolchain Rationale, keep a local note if the two sides really made the same change. The owner will review that before touching the candidate.",
    {
      unit: "extensions/typecheck-service",
      document: "toolchain-rationale.md",
      mode: "same",
      mayRecord: true,
      record: true,
      decision: "keep-converged",
    },
  ),
  review(
    "read-only-denied-record",
    "train",
    "Quick Connect Review",
    "Check Quick Connect Review and leave a private summary only if this review retained write authority. I still need your assessment even if the owner granted inspection alone.",
    {
      unit: "extensions/mobile-debug",
      document: "connect-instructions.md",
      mode: "incoming",
      mayRecord: false,
      record: false,
      decision: "review-incoming",
    },
  ),
  review(
    "react-native-anchor-restored",
    "train",
    "Native Screenshot Notes",
    "Two independent edits improve Native Screenshot Notes. Tell me whether both can be carried forward without starting a build or applying the candidate.",
    {
      unit: "extensions/react-native",
      document: "capture-notes.md",
      mode: "compose",
      mayRecord: false,
      record: false,
      decision: "carry-both",
    },
  ),
  review(
    "mobile-remove-owner-approval",
    "train",
    "Offline Welcome Draft",
    "Our local change adds the edge case to Offline Welcome Draft, but the staged source removes it. Prepare a private report so the owner can preserve the exact evidence.",
    {
      unit: "clients/mobile-browser",
      document: "offline-welcome.md",
      mode: "delete-edit",
      mayRecord: true,
      record: true,
      decision: "hold-absence",
    },
  ),
  review(
    "normalized-same-terminal",
    "train",
    "Larger Type Help",
    "The incoming Larger Type Help changes a line according to the release note. The terminal owner says that edit is already in the working review. Use the exact file sides to settle it.",
    {
      unit: "clients/chat-terminal",
      document: "larger-type-help.md",
      mode: "same",
      mayRecord: false,
      record: false,
      decision: "keep-converged",
    },
  ),
  review(
    "package-with-no-live-file",
    "train",
    "Device Archive Sheet",
    "The old Device Archive Sheet is absent from the incoming release. Check whether it was left untouched locally. I only need a direct recommendation here.",
    {
      unit: "extensions/mobile-debug",
      document: "device-archive.md",
      mode: "delete",
      mayRecord: false,
      record: false,
      decision: "review-incoming",
    },
  ),
  review(
    "incoming-only-worker-update",
    "train",
    "Typecheck Receipt Text",
    "Keep a proof for the Typecheck Receipt Text owner about whether the incoming wording is isolated. Do not apply it or touch the installed System.",
    {
      unit: "extensions/typecheck-service",
      document: "receipt-text.md",
      mode: "incoming",
      mayRecord: true,
      record: true,
      decision: "review-incoming",
    },
  ),
  review(
    "staged-file-older-copy",
    "train",
    "Metro Start Checklist",
    "Record what the current Metro Start Checklist would do only while the named coordinate still belongs to the staged review. If it moves during the check, stop at the new revision.",
    {
      unit: "extensions/react-native",
      document: "metro-start.md",
      mode: "overlap",
      mayRecord: true,
      record: false,
      moves: true,
      decision: "hold-stale",
    },
  ),
  review(
    "held-asset-pointer",
    "test",
    "Gesture Cue Asset",
    "The published-looking Gesture Cue Asset is a private staged file. Inspect the real sides and leave a local explanation only if display data cannot reliably be treated as text.",
    {
      unit: "clients/mobile-browser",
      document: "gesture-cue.dat",
      mode: "binary",
      mayRecord: true,
      record: true,
      decision: "hold-preview",
    },
  ),
  review(
    "held-side-disagrees-with-review",
    "test",
    "Retry Timing Review",
    "An earlier note calls Retry Timing Review a clean merge. Compare the exact retry timing file to see whether the same line changed for two different reasons. Keep a private finding.",
    {
      unit: "extensions/typecheck-service",
      document: "retry-timing.md",
      mode: "overlap",
      mayRecord: true,
      record: true,
      decision: "hold-collision",
    },
  ),
  review(
    "held-disjoint-owner-fields",
    "test",
    "Desktop Activity Card",
    "Desktop Activity Card gained a local opening label and a separate incoming fallback. Keep a private record if the latest exact base/local/incoming view supports retaining both.",
    {
      unit: "clients/desktop-browser",
      document: "activity-card.md",
      mode: "compose",
      mayRecord: true,
      record: true,
      decision: "carry-both",
    },
  ),
  review(
    "held-removed-local-note",
    "test",
    "Quiet Device Orientation",
    "Quiet Device Orientation is missing from the incoming material. The operator may have rewritten the local copy after the base. Decide whether removal needs a person, and answer without a file.",
    {
      unit: "extensions/mobile-debug",
      document: "quiet-orientation.md",
      mode: "delete-edit",
      mayRecord: false,
      record: false,
      decision: "hold-absence",
    },
  ),
  review(
    "held-overlimit-terminal",
    "test",
    "Terminal Support Transcript",
    "I have three copies of Terminal Support Transcript, but one might exceed the usable comparison window. Before drafting a note, tell me what the available preview actually proves.",
    {
      unit: "clients/chat-terminal",
      document: "support-transcript.md",
      mode: "oversize",
      mayRecord: false,
      record: false,
      decision: "hold-preview",
    },
  ),
  review(
    "held-upstream-window-moved",
    "test",
    "Native Build Stage",
    "Please keep the Native Build Stage handoff only if the original review remains the active one all the way to the last check. Another incoming observation may have moved the frontier.",
    {
      unit: "extensions/react-native",
      document: "build-stage.md",
      mode: "incoming",
      mayRecord: true,
      record: false,
      moves: true,
      decision: "hold-stale",
    },
  ),
] as const;
