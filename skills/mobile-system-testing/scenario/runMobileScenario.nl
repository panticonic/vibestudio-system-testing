---
description: Exercise one caller-owned Android setup or development scenario to its verified device outcome.
args:
  request: MobileAssignment
returns: MobileReport
budget: { maxTurns: 18 }
---
Call reviewSetup(request). If it reports a blocker, call explainBlocker with its exact blocker and either the assigned device id or null. For an inspect assignment, return target-ready with the selected id.
For execute, call exercisePairing when request.scenario is pair, or exerciseDevelopment when it is development. Pass the selected id. Return the complete checked report. If the chosen scenario reports a blocker, use explainBlocker for next while keeping the exact blocker and device id. Each call can issue one assigned operation; do not install again while waiting for its readback.
