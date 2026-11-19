---
description: Publish the transcript handoff and the exact safe native checkpoint.
args:
  start: TranscriptStart
  review: TranscriptReview
returns: TranscriptReport
---
If the review is unusable or contains no pages, return hold, no messages and null next. Otherwise concatenate all verified page messages in order. Use the last page's nextAfter as the next sequence for start.channelId. If the last page still hasMore, return continue. Otherwise return complete. Return start and the exact inspected pages unchanged.
