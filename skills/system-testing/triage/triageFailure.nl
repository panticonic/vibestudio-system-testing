---
description: Say which layer a failed system test points at (infrastructure, documentation, harness or validator) with the evidence from its record.
args:
  failure: Failure
returns: Triage
---
Call triage with failure and return its result unchanged, from eval, so the quoted evidence stays exact.
triage reads the signals of the record, decides the layer and quotes the signals that show it. To triage every
failed test of a run, call run with the runner target id and the run id.
