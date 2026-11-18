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
      "recipientSlots": []
    }
  }
] as const;
