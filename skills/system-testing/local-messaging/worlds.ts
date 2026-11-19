export const localMessagingWorlds = [
  {
    "id": "named-recipient-body-decoy",
    "channels": [
      "source",
      "control"
    ],
    "participants": [
      {
        "slot": "mira",
        "channel": "source",
        "handle": "mira",
        "name": "Mira Patel release reviewer",
        "kind": "agent"
      },
      {
        "slot": "alex",
        "channel": "source",
        "handle": "alex",
        "name": "Alex Chen build author",
        "kind": "agent"
      },
      {
        "slot": "control",
        "channel": "control",
        "handle": "control",
        "name": "Control observer",
        "kind": "agent"
      }
    ],
    "request": {
      "recipientPhrase": "Tell Mira the release build is ready.",
      "goal": "Tell Mira the verified release result and next reviewer.",
      "facts": [
        "release-17",
        "148 tests passed",
        "Alex reviews tomorrow"
      ]
    },
    "expected": {
      "status": "delivered",
      "recipientSlots": [
        "mira"
      ]
    }
  },
  {
    "id": "ambiguous-local-recipient-held",
    "channels": [
      "source",
      "control"
    ],
    "participants": [
      {
        "slot": "nora-ops",
        "channel": "source",
        "handle": "nora-ops",
        "name": "Nora Chen operations",
        "kind": "agent"
      },
      {
        "slot": "nora-audit",
        "channel": "source",
        "handle": "nora-audit",
        "name": "Nora Diaz audit",
        "kind": "agent"
      },
      {
        "slot": "alex",
        "channel": "source",
        "handle": "alex",
        "name": "Alex Chen build author",
        "kind": "agent"
      },
      {
        "slot": "control",
        "channel": "control",
        "handle": "control",
        "name": "Control observer",
        "kind": "agent"
      }
    ],
    "request": {
      "recipientPhrase": "Tell Nora the release build is ready.",
      "goal": "Send the verified release result to Nora.",
      "facts": [
        "release-23",
        "91 tests passed"
      ]
    },
    "expected": {
      "status": "held",
      "reason": "several",
      "recipientSlots": []
    }
  },
  {
    id: "exact-handle-among-similar-names",
    channels: ["source", "control"],
    participants: [
      { slot: "lee-review", channel: "source", handle: "lee-review", name: "Lee Morgan reviewer", kind: "agent" },
      { slot: "lee-build", channel: "source", handle: "lee-build", name: "Lee Morgan build owner", kind: "agent" },
      { slot: "control", channel: "control", handle: "lee-review", name: "Lee Morgan reviewer", kind: "agent" },
    ],
    request: {
      recipientPhrase: "Tell @lee-review to inspect the archived run.",
      goal: "Tell the named reviewer to inspect the archived run. Include the build owner's handoff.",
      facts: ["nightly-38", "Lee build owner retained the summary"],
    },
    expected: { status: "delivered", recipientSlots: ["lee-review"] },
  },
  {
    id: "name-only-present-in-control-room",
    channels: ["source", "control"],
    participants: [
      { slot: "sam", channel: "source", handle: "sam", name: "Sam Bell release owner", kind: "agent" },
      { slot: "riley", channel: "control", handle: "riley", name: "Riley Quinn reviewer", kind: "agent" },
    ],
    request: {
      recipientPhrase: "Tell Riley the review window moved.",
      goal: "Tell Riley the updated review window and the release owner's contact.",
      facts: ["Review starts at 14:30 UTC", "Sam Bell has the checklist"],
    },
    expected: { status: "held", reason: "none", recipientSlots: [] },
  },
] as const;
