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

export const managedProvenanceHistoryWorlds = [
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
