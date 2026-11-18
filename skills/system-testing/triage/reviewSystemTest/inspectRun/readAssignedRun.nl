---
description: Read the authorized bounded packet for exactly the assigned runner, run and case.
args:
  target: string
  runId: string
  testName: string
returns: {kind:"read-run";runId:string;retained:boolean}
---
Call systemTests.inspect(target, runId, testName) once. Return the same run ID and true only if an actual record was returned. Do not read another run when access is denied. Propagate absence or refusal without claiming success.
