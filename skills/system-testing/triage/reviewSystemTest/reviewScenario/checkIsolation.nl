---
description: Require an isolated owned fixture and explicit selection of live-data scenarios.
args:
  request: TestAuthorInput
returns: string[]
---
Append fixture when the work does not have an isolated fixture. Append ownership when resources are not owned by this test. Append explicit-only when live data is involved and explicitOnly is false. Return the list in this order.
