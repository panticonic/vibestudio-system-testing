---
description: Verify that the saved cursor can be used in the selected channel snapshot.
args:
  start: TranscriptStart
returns: '"foreign-channel" | "future-cursor" | "caught-up" | "read"'
---
Check the saved channel first. If different, return foreign-channel. With a page from the same channel, return future-cursor if saved.seq exceeds first.through. If no envelopes remain in that page, return caught-up. Otherwise return read.
