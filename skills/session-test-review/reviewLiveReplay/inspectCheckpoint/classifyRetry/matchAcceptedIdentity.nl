---
description: Verify the accepted retry identity and the retained or newly appended content.
args:
  evidence: ReplayCheckpoint
returns: ReplayDisposition
---
The retry exists in this stage. For the same key, require its returned id to equal the original and the final transcript length to equal the earlier length. Return confirmed-retry when it sent the same text, or original-payload-kept when a different text was attempted and the original stayed. For a different key require a different id and one appended row matching both the retry id and text. Return distinct-message on that evidence. Return inconsistent-replay if any required match fails.
