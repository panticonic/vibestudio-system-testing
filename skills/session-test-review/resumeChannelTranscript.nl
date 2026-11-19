---
description: Recover a stable, bounded transcript from a saved headless channel cursor.
args:
  request: TranscriptRequest
returns: TranscriptReport
budget: { maxTurns: 16 }
---
1. Open transcriptCursor with request.operationId. Pass the exact start to assessReplayStart.
2. For foreign-channel or future-cursor, return no pages or messages and null next, with that outcome. For caught-up, return no pages or messages and next equal to the saved cursor.
3. For read, call collectReplayPages with the operation ID and exact start. Pass the review and start to finishTranscript. Return its report unchanged.
