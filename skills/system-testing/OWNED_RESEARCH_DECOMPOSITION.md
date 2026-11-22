# Held research and evidence-led document revision

The existing Natlang hierarchy receives the unchanged user goal, selects
discovery terms, chooses candidate pages, and verifies cited statements before
deciding whether and how to revise a workspace document. This wave adds scoped
owned endpoints and leaves the original external-provider research cases intact.

| Mechanism | Reuse and scope |
| --- | --- |
| Goal-level discovery and revision | Base investigatePublicQuestion, reviseFromPublicResearch and reviseWorkspaceDocument. No new semantic policy or assigned key list. The local catalog only matches keywords against page titles and directory descriptions. |
| Real live retrieval | Native shell PTY starts an owned, cookie-free HTTP endpoint in the disposable System Testing context. Base runtime web.fetch uses the existing managed Chromium transport, extractor and blobstore. No public search credentials or external URLs are required. |
| Independent evidence readback | Host web.read independently retrieves and hashes the whole retained extracted page. The verifier checks the requested and final exact URL, HTTP scope, quote, date, and supported conclusion. One case requires a bounded cache continuation. |
| Concurrent edit preservation | Reuse the existing workspace edit adapter and current Natlang conflict retry, with fresh exact target versions and readback. The adapter preserves all non-target files and the concurrent addition. |
| Negative and provider boundary | Only catalog-discovered exact routes on the owned endpoint can reach fetch. Signed browser sessions, unobserved blob digests, writes to HTTP pages and unknown paths are refused. Claims about ranking or availability of public providers are outside this family. |
| Cleanup | The endpoint listens only on loopback, owns no external state, and has bounded scope and lifetime. The managed runner disposes the specific shell session and its owning worker context. |
