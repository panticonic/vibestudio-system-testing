---
description: Decide which layer a failed system test points at, from the signals read from its record.
readout: decision
args:
  signals: Signal[]
returns: FailureClass
---
signals are facts read from the record of one failed system test, each with the source it came from. Decide which layer
to repair, by the first rule that applies:
1. validator: a validator-error signal exists (the validation code itself threw), or the final-message signal says the
   requested outcome was delivered, no tool-failure, phase, session-error or cleanup signal exists, and the validation
   signal only complains about wording, a marker or a format.
2. harness: the test's own machinery failed: a fixture signal (repository or workspace setup), an orchestration
   signal showing the scenario never started or never returned, or a phase naming fixture, setup, device driver or
   test policy. The agent was not at fault and the platform behaved.
3. infrastructure: the platform failed while serving the agent: a tool-failure with failureKind infrastructure, a
   session-error or phase about a closed socket, a timeout, an internal error or an unavailable service, a cleanup signal
   about retiring a session, agent or context, a latency signal, or an incomplete-invocation that never finished.
4. documentation: anything else: the platform behaved as designed but the agent used it wrongly, shown by
   an argument-rejection, an invalid-input correction, a wrong name or shape, or a guest-code-failure caused by misuse.
