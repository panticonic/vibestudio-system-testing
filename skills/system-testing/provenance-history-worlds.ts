const retry = "src/retry-policy.ts";
const socket = "src/socket-policy.ts";
const upload = "src/upload-policy.ts";
const cache = "src/cache-policy.ts";
const missing = "src/retired-ingress.ts";
export type ProvenanceHistoryCheck = {
  path: string;
  walk: "cause" | "cohort" | "rejections";
  scope: "work-unit" | "turn";
};
const cause = (path: string): ProvenanceHistoryCheck => ({
  path,
  walk: "cause",
  scope: "work-unit",
});
const cohort = (
  path: string,
  scope: ProvenanceHistoryCheck["scope"] = "work-unit",
): ProvenanceHistoryCheck => ({ path, walk: "cohort", scope });
const undone = (path: string): ProvenanceHistoryCheck => ({
  path,
  walk: "rejections",
  scope: "work-unit",
});
function audit(id: string, goal: string, checks: ProvenanceHistoryCheck[]) {
  return { id, goal, checks };
}

export const managedProvenanceHistoryWorlds: {
  id: string;
  goal: string;
  checks: ProvenanceHistoryCheck[];
  constraint?: ConstraintCase;
}[] = [
  audit(
    "retry-reversal",
    "Check whether anyone tried and reverted a higher retry ceiling. Separate the current cause from the rejection record.",
    [cause(retry), undone(retry)],
  ),
  audit(
    "socket-related-work",
    "Find recorded work related to the socket policy at the work-unit scope. Check separately for reversals on the same file.",
    [cohort(socket), undone(socket)],
  ),
  audit(
    "upload-original-purpose",
    "Read the recorded cause of the upload chunk policy, then inspect the related work from the same authored unit.",
    [cause(upload), cohort(upload)],
  ),
  audit(
    "cache-independent",
    "Check why the upstream cache TTL is present. Verify whether this coordinate has any visible reversal.",
    [cause(cache), undone(cache)],
  ),
  audit(
    "retry-vs-cache-rejections",
    "Compare the visible retry and cache reversals. Keep each receipt with its own file.",
    [undone(retry), undone(cache)],
  ),
  audit(
    "missing-ingress",
    "A handoff mentions a retired ingress module. Check its cause and rejection history at the current repository view.",
    [cause(missing), undone(missing)],
  ),
  audit(
    "missing-vs-empty",
    "Distinguish an absent ingress coordinate from the current socket file with no visible reversal.",
    [undone(missing), undone(socket)],
  ),
  audit(
    "cohort-breadth",
    "Inspect the socket cohort at work-unit and turn breadth. Preserve the requested scope for both observations.",
    [cohort(socket), cohort(socket, "turn")],
  ),
  audit(
    "cache-vs-policy-cohort",
    "Compare cache and upload related work without borrowing attribution from another coordinate.",
    [cohort(cache), cohort(upload)],
  ),
  audit(
    "visible-change-chain",
    "In order, check the active retry cause, initial socket cause, and the reason the attempted retry change was reverted.",
    [cause(retry), cause(socket), undone(retry)],
  ),
  audit(
    "engineering-handoff",
    "Prepare a handoff separating the cache cause, the broader upload cohort, and visible reversals of the retry ceiling.",
    [cause(cache), cohort(upload, "turn"), undone(retry)],
  ),
  audit(
    "rejection-coordinate-contrast",
    "Review the retry reversal, then check whether upload and socket have separately recorded reversals.",
    [undone(retry), undone(upload), undone(socket)],
  ),
  audit(
    "legacy-vs-policy",
    "Check the cause available for the retired file and compare it with the cause and related work of the live socket policy.",
    [cause(missing), cause(socket), cohort(socket)],
  ),
  audit(
    "maintenance-record",
    "Check the cache work before following the retry counteraction. Report the relevant cohort and keep the two files' evidence separate.",
    [cohort(cache, "turn"), undone(retry), cause(retry)],
  ),
];

type ConstraintCase = {
  proposedProperty: string;
  status: "rejected" | "inconclusive";
  evidence: "retry-counteraction" | "policy" | "cache" | "none";
};

function proposal(
  id: string,
  goal: string,
  checks: ProvenanceHistoryCheck[],
  proposedProperty: string,
  status: ConstraintCase["status"],
  evidence: ConstraintCase["evidence"],
) {
  return {
    id,
    goal,
    checks,
    constraint: { proposedProperty, status, evidence },
  };
}

export const managedProvenanceConstraintWorlds = [
  proposal(
    "retry-repeat-300",
    "Review the proposed retry ceiling before changing the reconnect policy. Check the recorded reversal first.",
    [undone(retry), cause(retry)],
    "Raise the staging retry backoff ceiling to 300 seconds.",
    "rejected",
    "retry-counteraction",
  ),
  proposal(
    "retry-equivalent-five-minutes",
    "Compare the proposal in minutes with the actual previously reverted operation.",
    [cause(retry), undone(retry)],
    "Set the retry message's maximum backoff to five minutes in staging.",
    "rejected",
    "retry-counteraction",
  ),
  proposal(
    "keepalive-equivalent-wait",
    "Check whether holding the staging connection through a five-minute retry backoff repeats a recorded failure. Start from related socket work.",
    [cohort(socket), undone(retry)],
    "Keep the staging connection open for the entire five-minute retry wait.",
    "rejected",
    "retry-counteraction",
  ),
  proposal(
    "policy-repeated-one-reason",
    "Would the short-timeout policy be independently corroborated by the related upload and socket views?",
    [cause(upload), cause(socket), cohort(socket)],
    "The short timing limits recorded for the original socket and upload policy are still justified by independent reasons.",
    "inconclusive",
    "policy",
  ),
  proposal(
    "cache-window-one-source",
    "Check whether a single cache entry independently corroborates the same refresh assumption.",
    [cause(cache), cohort(cache)],
    "A 900-second cache TTL is corroborated independently because the source refreshes every quarter hour.",
    "inconclusive",
    "cache",
  ),
  proposal(
    "missing-legacy-policy",
    "Look for the proposal's history at the retired coordinate before treating it as an established rule.",
    [cause(missing), undone(missing)],
    "The absent ingress policy records a 60-second service cutoff.",
    "inconclusive",
    "none",
  ),
  proposal(
    "unrelated-negative-evidence",
    "Check the retry reversal and cache history. Does a staging retry reversal settle the unrelated cache cadence?",
    [undone(retry), cause(cache)],
    "Change the upstream feed cache from a 900-second TTL to a 600-second TTL because the source refreshes every ten minutes.",
    "inconclusive",
    "cache",
  ),
  proposal(
    "empty-rejection-not-approval",
    "The socket reversal walk may be empty. Determine whether that alone establishes approval.",
    [undone(socket), undone(upload)],
    "Approve a new 75-second socket ping interval.",
    "inconclusive",
    "none",
  ),
  proposal(
    "different-subsystem-policy",
    "Does the upload history or local socket reversal walk establish the proposed change?",
    [cause(upload), undone(socket)],
    "Apply an automatic 900-second archive retention rule for outbound assets.",
    "inconclusive",
    "none",
  ),
  proposal(
    "retry-after-cache-before-proposal",
    "Review the unrelated cache work, then the retry history, before recommending the same staging backoff change.",
    [cause(cache), undone(retry), cohort(upload)],
    "Roll out a 300-second retry ceiling in staging to reduce reconnect churn.",
    "rejected",
    "retry-counteraction",
  ),
];

managedProvenanceHistoryWorlds.push(...managedProvenanceConstraintWorlds);
