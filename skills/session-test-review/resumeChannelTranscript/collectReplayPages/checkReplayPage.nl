---
description: Check the native page coordinates, order and visible-message window.
args:
  page: TranscriptPage
  expectedAfter: number
  through: number
returns: '"verified" | "mismatch"'
---
Verify the requested after and fixed through, and require positive envelopeCount and an advancing nextAfter at or below through. A page with more must end below through. Every message sequence must increase and fall after expectedAfter and at or before nextAfter. Return verified if these all hold, or mismatch otherwise.
