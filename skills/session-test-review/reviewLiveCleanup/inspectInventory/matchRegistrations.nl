---
description: Match remaining live resources to the exact deferred registrations by id and kind.
args:
  remaining: TestkitOwnedResource[]
  registered: TestkitOwnedResource[]
returns: boolean[]
---
In the order of remaining, return one boolean for each resource. Use true when a registration has both the same id and the same kind.
