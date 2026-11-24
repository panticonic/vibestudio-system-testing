# Require current evidence, not a second identical read

The requested audit covers every actual exported world in Image (24), News (20),
API Readiness (24), Editorial (26), and Personal Welcome (21): 115 worlds total.
`FRONTIER_REQUIREMENT_AUDIT.json` records each unchanged goal with source coordinates,
its actual owner/concurrency transition, required outcome and explicit lookup
prerequisites, and the code and reasoning behind its observation requirement.
There are no unchecked worlds within those five families.

Four families imposed `snapshots.length === 2` and selected `snapshots[1]` before
using native originals, scope, owner state or handoffs. Across their 89 worlds,
74 have no later native change. Their initial and current snapshots are identical;
a second read contains no additional evidence. Examples include the named earlier
Greenhouse plate original, JPEG verification, quiet Git-vs-HTTP readiness and a
connected-but-unverified Personal owner. Rejecting a complete one-read workflow is
a trajectory constraint not selected by those user goals.

Those validators now require observed coverage of the actual initial and live
current frontiers, using the existing exact `includesEvidence` mechanism. One
observation can cover both when unchanged. Gates use the latest observed snapshot,
while retaining live native frontier comparisons and all existing authority,
identity, ownership, current binding, original bytes, permissions, lookup
prerequisites, protected state, artifact and outcome requirements. Missing evidence
still fails. Additional reads neither grant authority nor invalidate valid work.
No production fixture acquires a new dependency on the System Testing harness.

The other 15 worlds in those four families have actual native later records. News,
API and Welcome publish them after capturing the first observation. Image formerly
published them only on entry to the *second* read, so the ordinal call itself hid
authorship changes. Image now uses the same capture-then-publish transition as the
others. Reading originals or staging against the old observed frontier therefore
fails its native current check until the changed frontier is actually observed.
Welcome resource resolution and owner inspection now explicitly compare the live
frontier too; requiring an index-1 observation previously encoded that freshness
implicitly. Foreign senders, selection context and revoked permissions remain denied
with the refreshed current evidence.

Editorial needs no source change. Its 16 stable worlds cache one candidate/mission
snapshot, and its 10 race worlds inject an actual concurrent semantic edit at the
CAS apply boundary. Their goals explicitly address co-edits, competing same-field
changes, already-completed owner corrections, withdrawn approval or replaced
attachments. An initial proposal's basis and the post-conflict current candidate/
approval are different versions; the one/two cardinality checks describe those
native versions. Repeated workspace reads return the same snapshot. A prior PDF
report can be attested after binding the current snapshot if the source remains
approved and its digest/native citations still match; probe/read call repetition
is not required. Replaced or withdrawn sources still require current authority.

Focused tests exercise all four actual managed services with in-memory native ports:
no observation fails, one stable read permits the dependent service, redundant reads
remain valid, an injected change without refresh fails, and refresh admits the actual
current frontier. Revoked image/News authority, foreign API selection and stale
Welcome owner binding still fail. Existing API tests additionally pass complete
returned/native validation after 1, 2 or 4 journal reads while reordering/repeating
independent destination observations, and reject invented native state. Seventeen
tests passed in a bounded host-owned projection; no model/provider calls occurred.
Fresh installed/native V21 qualification remains integration evidence, not claimed
by these unit tests.
