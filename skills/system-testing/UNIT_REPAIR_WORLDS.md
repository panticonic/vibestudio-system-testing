# Worker repair worlds

The workspace-development guide asks the worker to inspect the assigned source, diagnose compiler and runtime evidence, apply an exact revision, and verify the original suite. The shared Natlang repair tree owns those decisions. Fixture code seeds distinct production defects and protected assertions. The complete workerd suite and outcome oracle own exact verification.

New cases exercise different input and output contracts: route precedence, event folding, deadline allocation, durable pagination, receipt reconciliation, status reduction, admission quotas, and reservation availability. Their starting source contains both a compiler failure and an observable behavioral defect. A compiler-only repair must still fail the protected suite. The two original label fixtures share a source group because they use the same target behavior. Each new contract has its own source group.
