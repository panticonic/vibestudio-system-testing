# Live Firefox → Trello migration acceptance

`trello-firefox-live-migration` reads real Firefox profile snapshots and uses a live authenticated Trello board. It is `explicitOnly`: category, `--all`, and staged runs exclude it. Name it exactly to opt in. Never schedule it as routine CI or smoke coverage. It imports cookies into the isolated instance vault; cookie plaintext is never test evidence. Trello remains read-only. Retained trajectories can contain private board data and must stay private.

Requirements: Firefox profiles with a tab titled vibestudio on trello.com, valid Trello cookies, network access, and a Personal workspace. The trusted reader aggregates all profiles of each Firefox installation, including Snap. Source absence or expired credentials is a prerequisite failure, not a reason to substitute a fake board or relax acceptance.

```sh
pnpm system-test --instance trello-migration --workspace personal doctor --model openai-codex:gpt-6.1-sol
pnpm system-test --instance trello-migration run trello-firefox-live-migration --model openai-codex:gpt-6.1-sol --detach
# Inspect retained results and repair failures. After Sol passes:
pnpm system-test --instance trello-migration run trello-firefox-live-migration --model openai-codex:gpt-6-luna --detach
pnpm system-test --instance trello-migration stop
```

Explicit model selection disables quota fallback, so a Luna verdict measures Luna. This case has no elapsed-time deadline. Subject completion is the validation boundary: the harness reads the delivered UI immediately and reloads it through native document readiness. A missing expected title is a validation failure, not a readiness condition to await. The generic oracle checks source identity and visible cards after reload; it does not establish complete migration of every card field or feature. The harness retains aggregate cookie completion receipts and independently reads the live Trello source and reloads the created app. Cleanup archives task-owned panels and counteracts fixture publication through ordinary semantic VCS.

The subject receives one short user prompt, with permission to use a subagent. The harness adds no implementation or verification follow-up tasks. Independent checks cover Firefox discovery, cookie completion, imported tab identities, publication, and visible source board/card content after reload. Full Markdown, histories, attachments, and checklists are also inspected in the retained verification trajectory; the generic UI checks alone do not prove lossless migration of every field.
