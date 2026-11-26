# Current reconciliation operation feedback

The admitted `reconciliationNative.observe` result now includes settled apply/merge operations: operation kind, submitted head and exact native accepted/changed/held result. This is actual owned native service history, not submitted edit contents or a model-authored success claim. It excludes observation events, so the history is nonrecursive.

The paired Base planner can distinguish stale attempts from accepted edits/settlements while using its actual current window/head and recovered prior snapshot. No native oracle, literal goal/ID/split, current-head/CAS, protected state, archive custody or artifact guard changed.

Actual source-factory controls: `vibe-reconciliation-native-feedback-20261126b` passed 10/10 tests in 4.489s at 362.9MiB, including an apply-time window withdrawal that records changed without submitting settings, and a following current observation exposing that exact result. Canonical Base service DTO generation and true freshness checks also passed (`vibe-reconciliation-declarations-20261126c`, 23.352s at 389.1MiB). These are source/controlled-port checks, not live native-DO whole-goal qualification or retrospective acceptance of the original failed case.

Evidence: `/home/werg/vibe-reconciliation-planning-ops/`. The paired Base public-loader controls remain a separate pending check at this commit; publish this addition only in a coherent Base/SST successor.
