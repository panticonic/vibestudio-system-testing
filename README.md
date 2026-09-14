# Vibestudio system testing

The agentic acceptance harness as an independent workspace template.

It carries the catalog (`skills/system-testing`), the runner Durable Object
(`workers/system-test-runner`), the agent the cases drive (`workers/test-agent`),
and the headless session plumbing they share (`packages/agentic-session`).

It is a dependency, not a workspace: a template that wants to run the suite
declares this one alongside Personal or System, and the composed workspace gets
the harness next to whatever units that workspace already installs. That is what
makes a case like `browser-import-panel-lifecycle` runnable — the Browser Import
inspector ships in Personal, so the suite has to be able to run there.

Cases name the units they need with `requiresUnits`. The runner reads what the
workspace actually installs and reports a case whose units are absent as
not-installed rather than failing it, so one catalog serves every workspace.
