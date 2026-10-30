# triageFailure: decomposition

`triageFailure(failure): { class, evidence }` says which layer a failed system test points at: `infrastructure`,
`documentation`, `harness` or `validator` (the classification the system-testing skill asks for in step 5 of its repair loop). It
reads the record of one test (the packet `systemTests.inspect(runnerTargetId, runId, testName)` returns). It repairs nothing.

| Part               | Form                                                             | Why                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read the packet    | crisp: `triageFailure/signals.ts`                                | The record has typed fields (failure phase, validation failure, tool failures with `failureKind` and `classification`, cleanup, latency, fixture, orchestration). Reading them is exact. Every signal is bounded to 300 characters and redacted (home paths, tokens, long hex) because a run artifact can hold credentials. At most 10 signals. |
| Decide the layer   | its own function, `classifyFailure` (`readout: decision`, 4-way) | The one judgment: which layer owns the defect, by an ordered rule list (validator, harness, infrastructure, documentation). A finite answer is scored in one pass, and the distribution is available for a floor.                                                                                                                               |
| Quote the evidence | crisp: `evidence.ts`                                             | The evidence is the record's own fields, so extraction is a table: per class, which signal sources decide it, in order; three signals at most. Choosing among fields by judgment would invite paraphrase; quoting keeps it checkable.                                                                                                           |
| Whole run          | crisp: `run.ts`                                                  | Reads the run's packet with the `systemTests` service and triages each failed test from its per-test record.                                                                                                                                                                                                                                    |

The existing `likelyIssue` heuristic in `diagnostics.ts` stays a signal (`heuristic`) among the others; it names a failure shape, not a repair layer.

## Measurement

No recorded run exists on the authoring machine (`~/.config/vibestudio/system-test-runs` is absent), so `cases.jsonl` holds
packets built in the exact `FailureDiagnostic` shape from the defect stories of the repository's own fix history (a peer
cancelling an Iroh stream, a device driver that never settled an approval wait, a validator that rejected "thirty seconds" for
"30s", and the like). Replace or extend them with retained packets when runs exist; a retained packet must have home paths and
credentials removed first. Each class has stories in every split. Gate: class accuracy of at least 0.85 on validation and on the locked test split.
