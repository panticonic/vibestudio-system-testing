# Operational handoff scenarios

Nine authored worlds exercise the existing `operate.nl` workflow. These are scenario inputs and private oracle
expectations, not observed successes. No model run or teacher collection is implied by data-integrity tests.

| Case ID | Distinct operational condition | Expected state |
|---|---|---|
| incident-payment-and-ledger | Customer charges remain unresolved while recovery preparation is complete | Impact blocked / recovery ready |
| incident-restored-search-missing-rollback | Customers recovered but rollback/backup sign-off remains incomplete | Impact ready / recovery blocked |
| incident-tenant-export-data-loss | Affected customer cohort still loses data and recovery snapshot failed verification | Both blocked |
| incident-email-restoration-complete | Customer restoration and independent recovery prerequisites are confirmed | Both ready |
| release-audit-continuation | Pending migration approval becomes approved across a retained checkpoint | Blocked to ready |
| release-security-approval-revoked | New evidence revokes previously granted authority | Ready to blocked |
| release-partial-progress-hard-block | Several prerequisites improve but a rejected recovery drill still prevents release | Blocked to blocked |
| release-approved-checkpoint-retained | Restart retains approval without inventing failure or deployment | Ready to ready |
| release-rejected-restore-recertified | Failed restore certification is replaced by supplied recertification; retain both checkpoints | Blocked to ready |

Incident roles use distinct owned workers, real persisted assessments and rereads before coordination. Release cases
use the same actual worker across `runtime.supervision.restart`, with ordered first and second checkpoints and exact
persisted-history verification. Cleanup and its independent oracle are unchanged. Gate evidence describes supplied
external observations: the workflow does not itself execute deployment, security review or restore drills. Rejected-gate
recovery is covered; runtime-fault recovery and execution of a dependency graph are not implemented by this policy.

`ownedOperationsInventory` exports exact IDs, stable source IDs/groups, split and kind. Source groups follow the
operational condition across retries; run IDs and renamed resources must not create new groups. The receiver derives
its accepted IDs from this inventory's source worlds. Models receive `world.request`, never private `world.expected`.
