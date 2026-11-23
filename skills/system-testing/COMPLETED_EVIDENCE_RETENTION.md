# Completed evidence memory ownership

Inventory before changing retention (2026-11-23):

- `test-runner.ts:runSuite` retained every full completed entry in its result array.
- `cli.ts:runSystemTests` retained the same full entries in `completedEntries`, plus periodic/final records.
- `workers/system-test-runner/index.ts:systemTestEvalCode` already wrote immutable entry blobs/native SQL pages, but retained full checkpoints in `lastRunRecord` and did not release runner results after those writes.
- The worker's `inspectSystemTestRun` hydrated every full entry even though its output selects bounded failure diagnostics.
- `readSystemTestTrajectoryPage(full=true)` hydrated, parsed and pretty-serialized an entire entry for every small output page.
- `getSystemTestRunSnapshot` and `getSystemTestRunResult` already read header/status only; their existing paths remain bounded.
- Base `RecordsStore.record` drops acknowledged full per-call exchanges; `evalNatlang` deletes completed task program roots. The model gateway's helper transcript is task-scoped and its result document is retired after delivery. These are separate active-call mechanisms, not the completed suite arrays changed here.
- Natlang engines, capture schemas, IR readers and training targets do not store this system-test aggregate. Full per-case records served to the existing capture/export path remain the original immutable entries. The live aggregate explicitly identifies retained evidence instead of pretending to contain a full transcript.

Managed runs acknowledge the full original blob and native entry checkpoint before replacing completed packets with verdict/identity/reference projections in both runner arrays and observer state. A failed acknowledgement stops further admission and joins owned workers; it does not silently release evidence. Direct callers without a durable sink keep their requested full results. Whole-run inspection hydrates only its bounded selected failures; full trajectory queries read the original native pages without rebuilding the whole JSON object per page.

Actual wave0037 log records a Workerd V8 heap exhaustion around 1.4GiB and process RSS around 5.2GiB. Its cgroup OOM counters were zero. The completed-entry retention is an independently wrong unbounded mechanism; the crash attribution is not established solely by finding it. Original instance logs and all raw evidence are preserved for continued diagnosis.
