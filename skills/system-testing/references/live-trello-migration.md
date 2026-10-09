# Live Firefox → Trello migration acceptance

`trello-firefox-live-migration` reads real Firefox profile snapshots and uses a
live, authenticated Trello board. It is `explicitOnly`: category, `--all`, and
staged runs skip it, and it runs only when named exactly. Never schedule it as
routine CI or smoke coverage.

The test imports cookies into the isolated instance's vault. Cookie plaintext is
never test evidence. Trello is only read, never modified. Retained trajectories
can contain private board data and must stay private.

Requirements:

- Firefox profiles with a tab titled vibestudio on trello.com;
- valid Trello cookies;
- network access;
- a Personal workspace.

The trusted reader combines all profiles of each Firefox installation, including
Snap installs. A missing source or expired credentials is a prerequisite
failure. Do not substitute a fake board or relax acceptance.

```sh
pnpm system-test --instance trello-migration --workspace personal doctor --model openai-codex:gpt-6.1-sol
pnpm system-test --instance trello-migration run trello-firefox-live-migration --model openai-codex:gpt-6.1-sol --detach
# Inspect retained results and repair failures. After Sol passes:
pnpm system-test --instance trello-migration run trello-firefox-live-migration --model openai-codex:gpt-6-luna --detach
pnpm system-test --instance trello-migration stop
```

Choosing a model explicitly disables quota fallback, so a Luna verdict measures
Luna. This case has no elapsed-time deadline.

Validation starts when the subject completes. The harness reads the delivered UI
immediately, then reloads it and waits for native document readiness. A missing
expected title is a validation failure, not a readiness condition to wait for.
The harness keeps aggregate cookie-completion receipts, and independently reads
the live Trello source and reloads the created app. Cleanup archives the panels
the task created and counteracts fixture publication through normal semantic
VCS.

The subject receives one short user prompt that permits using a subagent. The
harness sends no follow-up implementation or verification tasks. Independent
checks cover Firefox discovery, cookie completion, imported tab identities,
publication, and the visible source board and card content after reload. The
retained verification trajectory is also inspected for full Markdown, histories,
attachments, and checklists. The generic UI checks (source identity and visible
cards after reload) do not on their own prove that every card field and feature
migrated without loss.
