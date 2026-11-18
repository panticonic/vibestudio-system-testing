---
description: Check the exact suite declaration and its verification adapter.
args:
  evidence: Dispatch
returns: SessionReview
---
Cite evidence.receipt. A direct adapter call gives revise and verify-entry-required. A null declaredRuntime gives unobserved and suite-undeclared. A different adapterRuntime gives revise and runtime-route-mismatch. Native requires nativeAdmissionRequested; browser and workerd must leave it false. A mismatch gives revise and runtime-admission-mismatch. Otherwise return confirmed and verify-dispatch-scoped. This checks dispatch evidence in its own scope.
