# Partial authority qualification observations

Inventory: release-review-handoff-managed.ts produces partialAuthorityReadDenied and tests/release-review-handoff-managed.ts is its only consumer (repository-wide search). Managed release worlds select authority-review-worlds.ts: distinct-origins has3 operations, mixed-open-and-protected2, git-bridge-migration-origins4, but open-status-with-empty-ceiling has1. The last world has no partial prefix to test, so a true scalar claimed a denial that was never attempted.

Publish actual per-prefix observations instead: operationId and denied, only after the corresponding preflight and actual authority scratch-read. The validator independently requires the exact number and ordered IDs from the assigned authority world, each denied=true. A single-operation world correctly publishes an empty array. All release/runtime/authority/scratch dependency gates and actual artifact checks remain unchanged. These are ordinary shared fixture functions; no model/serving engine implements this qualification-only mechanism.

Three targeted validator controls passed in vibe-release-qualification-20261125a (1s/139MiB): empty legitimate prefix; actual denial failure/foreign identity; missing probe or fabricated nonexistent prefix. Full native release qualification was not run. No goal, source, authority, raw record or historical verdict changed.
