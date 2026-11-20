type Role = "author" | "reviewer" | "reader" | "none";
type State = "joined" | "pending" | "acknowledged" | "revoked" | "rejoined" | "removed-inbox";
type Purpose = "inspect" | "review-note" | "reader-note" | "author-note";
type Change = "current" | "edited-content" | "old-object" | "other-workspace" | "other-recipient" | "old-invite" | "no-workspace-membership" |
  "revoked-account" | "object-reowned" | "declined" | "withdrawn" | "pending";
export type WorkspaceShareWorld = {
  id: string; kind: "workspace-share"; workspace: "system"; sourceGroup: string; split?: "test";
  title: string; goal: string; role: Role; state: State; purpose: Purpose; change: Change;
  accountRole: "root" | "admin" | "member"; workspaceRole: "admin" | "member";
};
type Options = Partial<Pick<WorkspaceShareWorld, "role" | "state" | "purpose" | "change" | "accountRole" | "workspaceRole">> & { held?: true };
function world(id: string, title: string, goal: string, options: Options = {}): WorkspaceShareWorld {
  return { id: "workspace-share-" + id, kind: "workspace-share", workspace: "system", sourceGroup: "vibestudio:workspace-share:" + id,
    ...(options.held ? { split: "test" } : {}), title, goal, role: options.role ?? "reader", state: options.state ?? "joined",
    purpose: options.purpose ?? "inspect", change: options.change ?? "current",
    accountRole: options.accountRole ?? "member", workspaceRole: options.workspaceRole ?? "member" };
}
export const openWorkspaceShareRequiresUnits = [
  "skills/open-user-goal", "skills/messaging", "skills/scratch-handoff-bindings", "workers/workspace-source", "workers/pubsub-channel",
];
export const openWorkspaceShareWorlds = [
  world("author-approved-shift-brief", "Shift allocations", "I own this shift brief and want a current private handoff for its reviewers. Verify that I still own this edition and keep the original brief untouched.",
    { role: "author", purpose: "author-note" }),
  world("invited-reader-ready-with-own-scope", "Farm equipment route", "Check the farm route invitation and current reader access. I need a private reader-side handoff about the same edition if I am allowed to prepare it.",
    { role: "reader", state: "acknowledged", purpose: "reader-note" }),
  world("reviewer-role-bound-to-current-revision", "Laboratory notebook", "The lab notebook has reached me for review. Check that this exact edition is mine to review before leaving an internal note, and preserve the working document.",
    { role: "reviewer", purpose: "review-note" }),
  world("reader-cannot-promote-to-reviewer", "Allotment timetable", "I was invited to read the allotment timetable. Does that cover filing a reviewer handoff for the current object, or do I need another grant?",
    { role: "reader", state: "acknowledged", purpose: "review-note" }),
  world("declined-grant-with-retained-channel-access", "Bike lane review", "I declined the bike lane review earlier, but the sharing channel still shows me. Check what the retained invitation and current object authorize before filing anything.",
    { role: "reviewer", state: "acknowledged", purpose: "review-note", change: "declined" }),
  world("pending-channel-notice-with-object-consent", "Port watch handout", "I still see an unread channel invitation. Can I preserve the approved reader note for the port watch handout if the exact object and role are current?",
    { role: "reader", state: "pending", purpose: "reader-note" }),
  world("pending-object-consent-different-from-inbox", "Band rehearsal", "The band channel invited me, but the object review response may still be pending. Check whether I can prepare a handoff yet.",
    { role: "reviewer", state: "pending", purpose: "review-note", change: "pending" }),
  world("acknowledged-inbox-does-not-erase-membership", "Canal log", "The canal log invite disappeared after I dismissed the banner. Find out whether channel membership and the exact log review still stand. I only need the assessment.",
    { role: "reviewer", state: "removed-inbox", purpose: "inspect" }),
  world("revoked-notice-cannot-restore-the-reader", "Harbor map", "A retained harbor map invite suggests I could still read the latest edition, but access may have been removed. Check the current status before an internal reader handoff.",
    { role: "reader", state: "revoked", purpose: "reader-note", change: "old-invite" }),
  world("current-reinvite-supersedes-old-removal", "Studio materials", "A studio materials removal was followed by a new invite. Verify which admission now covers the same reader handoff, without sending another invitation.",
    { role: "reader", state: "rejoined", purpose: "reader-note" }),
  world("root-account-still-outside-workspace", "Museum key register", "The museum key register has an old reviewer entry for an account with server administration privileges. Check whether it is still a member of this workspace before a reviewer note.",
    { role: "reviewer", state: "joined", purpose: "review-note", accountRole: "root", change: "no-workspace-membership" }),
  world("workspace-admin-not-document-author", "Riverside planting guide", "As the workspace administrator I can see the riverside planting guide. Confirm whether that makes me the author for purposes of its ownership handoff.",
    { role: "reader", state: "joined", purpose: "author-note", workspaceRole: "admin" }),
  world("role-retained-but-user-revoked", "Court reservation docket", "The court reservation board still has an old reviewer role on file. Verify whether a retained role can be used after account revocation and keep the docket unchanged.",
    { role: "reviewer", state: "pending", purpose: "review-note", change: "revoked-account" }),
  world("forwarded-invite-to-same-handle-different-user", "Theatre cue handoff", "The theatre handoff references an invite forwarded from someone with the same displayed name. Check the actual recipient before filing a reader note for this workspace.",
    { role: "reader", state: "pending", purpose: "reader-note", change: "other-recipient" }),
  world("project-recreated-with-same-name", "Weekend inventory", "A new workspace uses the same name as the old inventory. Verify that the retained approval actually refers to this workspace and edition before leaving a reviewer note.",
    { role: "reviewer", purpose: "review-note", change: "other-workspace" }),
  world("version-advanced-after-review", "Storm briefing", "The storm briefing got a replacement edition after review. Check whether the older reviewer grant carries over before creating any new handoff.",
    { role: "reviewer", purpose: "review-note", change: "old-object" }),
  world("reowned-draft-author-claim-held", "School studio guide", "I was the first author of the studio guide, and the local ownership review names someone else now. Check who owns the current edition before leaving an author note.",
    { role: "author", purpose: "author-note", change: "object-reowned" }),
  world("review-withdrawn-after-notice-ack", "Press proof", "The press proof review was withdrawn after I cleared the invitation banner. Tell me what the retained membership proves and protect the withdrawn note scope.",
    { role: "reviewer", state: "acknowledged", purpose: "review-note", change: "withdrawn" }),
  world("reviewer-readable-summary-within-reader-allowance", "Night delivery map", "I have a current review role for the night delivery map. I only want a private reader-side synopsis of the access basis. Preserve the map and reviewer scope.",
    { role: "reviewer", state: "rejoined", purpose: "reader-note" }),
  world("unassigned-workspace-member-cannot-read", "Textile workshop calendar", "I belong to the workspace, but the textile workshop calendar looks like a separate object. Check whether any current recipient grant applies without opening its content.",
    { role: "none", purpose: "inspect" }),
  world("held-archive-channel-delete-wins-old-put", "Archive shipping note", "An older archive notification appeared again after a newer removal. Verify which channel projection is current before leaving a reader briefing for this exact folder.",
    { role: "reader", state: "revoked", purpose: "reader-note", change: "old-invite", held: true }),
  world("held-collector-old-grant-current-fingerprint", "Workshop safety checklist", "The safety checklist digest was replaced while the title stayed the same. Check whether the retained reviewer confirmation can be used to stage a local note for this revision.",
    { role: "reviewer", state: "rejoined", purpose: "review-note", change: "old-object", held: true }),
  world("held-reviewer-invited-to-neighbor-workspace", "Clinic shift summary", "A clinic invitation came from a similarly named workspace. Check which workspace it actually belongs to and preserve both summaries if the scope does not match.",
    { role: "reviewer", state: "pending", purpose: "review-note", change: "other-workspace", held: true }),
  world("held-unaccepted-object-against-current-channel", "Bakery supply register", "The bakery channel access is current, but has the individual object grant been accepted? Confirm before leaving a retained reader handoff.",
    { role: "reader", state: "acknowledged", purpose: "reader-note", change: "pending", held: true }),
  world("held-live-authority-lost-despite-implicit-role", "Garden maintenance rota", "The garden rota identifies me as its author, but my current workspace membership may no longer exist. Evaluate the exact grants before an author handoff.",
    { role: "author", state: "joined", purpose: "author-note", change: "no-workspace-membership", held: true }),
  world("held-different-recipient-under-admin", "Venue checklist", "The venue checklist reviewer notification uses my familiar display label, though the destination may be another user. Even with workspace admin access, confirm whose role is actually recorded before saving a note.",
    { role: "reviewer", state: "pending", purpose: "review-note", change: "other-recipient", workspaceRole: "admin", held: true }),
  world("held-current-membership-with-prior-invite-revision", "Community rink keys", "I was added back to the rink channel, but this reviewer scope still references the original invitation. Decide whether the current role can be carried into an internal note under that older reference.",
    { role: "reviewer", state: "rejoined", purpose: "review-note", change: "old-invite", held: true }),
  world("held-checksum-changed-under-same-edition", "Volunteer locker schedule", "The locker schedule still calls itself the approved edition, but the contents were changed. Check whether the local reader handoff is still backed by the exact version I reviewed.",
    { role: "reader", state: "acknowledged", purpose: "reader-note", change: "edited-content", held: true }),
];
