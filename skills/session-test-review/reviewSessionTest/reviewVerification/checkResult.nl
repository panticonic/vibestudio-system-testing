---
description: Bind a test terminal to the declared suite and exact semantic context.
args:
  evidence: VerifyResult
returns: SessionReview
---
With no receipt return unobserved and verify-terminal-unobserved with no evidence. Otherwise cite receipt.id. Require operation test, exact target, suite, runtime, contextId, ref ctx:<context>, and stateHash equal to the requested revision. A field mismatch gives unobserved and verify-receipt-mismatch. A passed status gives confirmed and suite-passed. Failed, compilation-failed, or no-tests gives revise and suite-check-incomplete. Any other status gives unobserved and verify-infrastructure-unconfirmed.
