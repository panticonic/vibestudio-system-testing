---
description: Select the assigned or unambiguous ready Android device.
args:
  devices: MobileDevice[]
  requested: string | null
returns: TargetSelection
---
If requested is present, find its exact device and use only that device. A missing id is no-device. A matching unauthorized or offline device returns its specific blocker. Without an id, consider ready devices. One ready device is an unambiguous target, and more than one is ambiguous-device. With no ready devices, a single listed device gives its specific state and any other listing gives no-device.
