---
description: Return the supported next step after the owned attempt settled and released its resources.
args:
  request: TestPacketInput
returns: "obtain-failure-packet"|"triage-retained"|"verified"
---
If terminal passed return verified. If an independently retained failed diagnostic is available, return triage-retained. Otherwise return obtain-failure-packet. A cancellation or timeout alone does not show failure ownership.
