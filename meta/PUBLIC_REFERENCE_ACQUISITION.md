# Public reference acquisition: source evidence and infrastructure failures

Inventory before editing (SST baseline6cb1e0f5):

- `open-goal-managed.ts` prepares both research and research-and-edit. Both
  qualification routes share `preparePublicResearch.qualify`. Its original
  single `site:host "gold phrase"` query ignored each provider result's `error`,
  then considered only five candidate URLs and threw the same "no evidence"
  error for provider failure and successful empty results. Actual teacher
  verification independently checks observed public receipts/cache digests,
  grounded citations, and bound semantic review; keep that verifier unchanged.
- `prepareWorkspaceGoal` qualifies local edits with no web acquisition. Combined
  research-and-edit first acquires public evidence through the shared helper,
  then verifies its local concurrent edit/readback; keep both actual effects.
- `open-goal-assigned-public-brief-managed.ts` delegates acquisition to
  `web-brief-managed.ts.prepareManagedWebBriefWorld.qualify`. Every explicitly
  assigned URL must be read; these are not replaceable search hints. Shared
  web-brief/intake uses verified managed cache bytes and exact assigned-source
  authority. Wrap acquisition failures with the actual assigned URL and
  completed native receipts, preserving the original cause.
- `open-public-search-evidence.ts` already records actual provider/query/URL
  and credential-presence provenance. `verified-web-cache.ts` checks exact
  native cached bytes/digest. Base web-core `searchStandard` returns per-query
  errors and applies its existing authorized-provider policy. Do not replace
  these mechanisms or call a paid provider for this diagnosis.
- Base web-core pages acquire through managed Chromium and retain actual text
  in blobstore. Raw transport/TLS/connection policy is Root's disjoint work;
  no Node-fetch fallback, source substitution, relaxed certificate checks,
  fabricated pages or new retry/deadline policy belongs in this change.
- Host RPC `serializeRpcFailure` already carries application-owned errorData
  and nested causes. Use that existing failure channel to retain bounded
  source-acquisition receipts, not another reporting/qualification route.
- Model-serving engines do not select these reference sources or implement
  these fixture qualification helpers. No engine/model/inference change applies.

Native evidence: r6 examples-0022 has five generic search acquisition errors;
original full packets contain execution error/build provenance but no search
response or fetched-page receipts. Thus ranking vs provider failure is NOT
attributed from those packets. r6 examples-0027 has four managed Chromium
ERR_CONNECTION_CLOSED failures against exact assigned public sources. First
URLs from authored source order: example.com, IANA help, IANA registry,
w3c.github.io decorative guidance. Transport diagnosis remains separate.

Reference-only discovery can search the user question under the expected
public authority and, after successful but unhelpful search, the unquoted
reference fact. Every returned candidate is considered once. Individual
unavailable candidate URLs do not erase alternatives; final source selection
must stay on the expected authority and match independently verified actual
cache bytes. Provider failures and integrity failures remain terminal, carrying
real receipts/cause. Teacher prompts, goals, allowed routes, gold-independent
semantic review, and source/cache validation remain unchanged.

First focused Host-owned check was stopped before tests: cold dependency
projection spent1245476ms resolving packages and failed with npm registry
ETIMEDOUT, then entered its existing retry backoff. Its process tree was joined
at the supervisor's request to release obsolete V22 artifact/disk use. This is
not a passing check. Source and conventional regressions are retained; actual
verification must use the ready V24 Host after release/capacity permits.
