---
description: Check every native page under the first snapshot watermark.
args:
  operationId: string
  start: TranscriptStart
returns: TranscriptReview
budget: { maxTurns: 22 }
---
1. Start with first. Use the saved sequence as its expected after and first.through as the fixed watermark.
2. Call checkReplayPage with each exact page, expected after and watermark. On a mismatch return the collected pages with usable false.
3. Append a verified page unchanged. Stop successfully when hasMore is false or the caller's maxPages is reached. Otherwise call transcriptCursor.next with operationId, the verified nextAfter and fixed watermark. Apply step 2 using that nextAfter as the new expected after.
