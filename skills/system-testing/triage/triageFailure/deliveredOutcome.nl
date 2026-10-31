---
description: Decide whether the agent did what the test asked, given its final message and the validator's complaint.
readout: decision
args:
  message: string
  complaint: string
returns: boolean
---
message is what the agent told the user at the end of a task. complaint is what the validator said was missing.
Answer true when message reports the requested work as done and complaint only objects to how it was worded or
formatted (a word, a marker, a number written as text). Answer false when message says part of the work was not done,
could not be done, or was done another way than asked, so that complaint names something really missing.
