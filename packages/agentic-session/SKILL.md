---
name: headless-sessions
description: Drive agentic channels without a React UI from eval harnesses, workers, pipelines, or tests through HeadlessSession or ConnectionManager.
---

# Headless Agentic Sessions

Headless sessions connect to a channel, send messages, and read the transcript
without a chat panel.

A session is only a channel client. It connects to a PubSub channel, subscribes
an agent DO, sends user messages, and reads the persisted transcript. The
agent's own capabilities (eval, file tools, web tools) live in the agent
worker, not in the session. In particular, the agent's `eval` runs
**server-side in the agent's per-channel EvalDO**, so it works with no panel or
session UI connected. The session does not need to register an eval method or
keep a sandbox alive for the agent to run code.

## Files

| Document                                                 | Content                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| [references/ARCHITECTURE.md](references/ARCHITECTURE.md) | Package layout, ConnectionManager vs HeadlessSession, what lives where |
| [references/QUICK_START.md](references/QUICK_START.md)   | Getting started: create a session, send messages, drive an agent       |
| [references/API.md](references/API.md)                   | Full API reference for HeadlessSession                                 |

## Packages

| Package                      | Purpose                                                                                               | React? |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| `@workspace/agentic-core`    | ConnectionManager, types, pure functions, channel-view reducer/selectors, panel import-loader factory | No     |
| `@workspace/agentic-session` | HeadlessSession and channel helpers                                                                   | No     |
| `@workspace/agentic-chat`    | React adapter (useChatCore, useAgenticChat)                                                           | Yes    |

## Which package to use

- **Panel with a chat UI:** `@workspace/agentic-chat`, React hooks over the
  same channel-view reducer.
- **Driving an agent from a worker/DO, test, or pipeline:**
  `@workspace/agentic-session`, via `HeadlessSession.createWithAgent()`.
- **Connecting to a channel without the headless helpers:** `ConnectionManager`
  from `@workspace/agentic-core`.
- **Only types or pure functions:** `@workspace/agentic-core`.

## Environment compatibility

Headless sessions use the same agent worker, system prompt, and tools as
panel-hosted sessions. The only difference is the runtime: with no chat panel
connected, UI-only tools are not advertised on the channel, so they drop out of
the agent's tool list.

When you create a headless session from server-side eval, a worker, or a
Durable Object, set `config.clientId` to `rpc.selfId`. That is the authorized
PubSub participant ID for runtime callers without a connection; the channel
rejects arbitrary labels when the session subscribes.

| Capability                      | Panel | Headless                                                              |
| ------------------------------- | ----- | --------------------------------------------------------------------- |
| eval                            | Yes   | Yes — runs server-side in the agent's EvalDO; no panel/sandbox needed |
| scope / db persistence          | Yes   | Yes — held in the agent's EvalDO, not the session                     |
| set_title                       | Yes   | Yes                                                                   |
| inline_ui                       | Yes   | No — no panel to render the component                                 |
| load_action_bar                 | Yes   | No — no panel-local top bar to render                                 |
| feedback_form / feedback_custom | Yes   | No — no panel to render the form                                      |
| Tool approval UI                | Yes   | No — headless uses full-auto approval                                 |

Because `eval` and its persistent `scope`/`db` belong to the agent worker, they
behave the same whether or not a panel or headless session is connected. The
agent's prompt marks the UI-only tools (inline_ui, load_action_bar, feedback)
as runtime-dependent, so when running headless the agent replies with plain
messages instead.

Headless agents are still responsible for the runtime resources they create. If
a headless session opens panels, browser panels, or CDP page clients through
eval, its prompt or harness should require cleanup: reuse handles, close
temporary panels in `finally`, and close or dispose page clients when the API
has a close method. Channel unsubscribe does not clean up panels the agent
opened. Leave panels open only when the user or harness explicitly asked for
that.
