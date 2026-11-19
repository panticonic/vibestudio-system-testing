---
description: Separate resources that survived deferred cleanup from resources with no registration.
args:
  evidence: LiveCleanupEvidence
returns: CleanupInventory
---
Return clear if remaining is empty. Otherwise call matchRegistrations with the remaining resources and the deferred registrations. If all remaining resources were registered return registered-residue. If all were unregistered return unregistered-residue. When both sets are represented return mixed-residue.
