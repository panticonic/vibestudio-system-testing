---
description: Check acknowledged LIFO release of resources created by the test.
args:
  evidence: TestkitRelease
returns: SessionReview
---
Cite evidence.receipt. Any released entry whose kind and id do not match a created resource gives revise and cleanup-foreign-resource. Any failed acknowledgement gives revise and testkit-release-failed. An owned resource without a release acknowledgement gives waiting and testkit-release-unobserved. Require the released sequence to match the reverse of resources' deferred registration order by kind and id, once each. An incorrect order or duplicate gives revise and testkit-release-order. Otherwise return confirmed and testkit-released.
