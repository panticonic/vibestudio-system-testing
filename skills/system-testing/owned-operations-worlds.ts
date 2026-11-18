export const ownedOperationsWorlds = [
  {
    "id": "incident-payment-and-ledger",
    "request": {
      "kind": "incident-handoff",
      "goal": "Coordinate customer-impact and recovery handoff for payment incident without claiming resolution.",
      "signals": [
        {
          "id": "impact-double-charge",
          "text": "Customers still see duplicate pending charges; no reversal confirmation exists."
        },
        {
          "id": "recovery-ledger",
          "text": "Ledger reconciliation is complete and the rollback artifact passed verification."
        }
      ]
    },
    "expected": {
      "roles": {
        "impact": {
          "decision": "blocked",
          "evidenceIds": [
            "impact-double-charge"
          ]
        },
        "recovery": {
          "decision": "ready",
          "evidenceIds": [
            "recovery-ledger"
          ]
        }
      },
      "decision": "blocked",
      "kind": "incident-handoff"
    }
  },
  {
    "id": "release-audit-continuation",
    "request": {
      "kind": "release-continuation",
      "goal": "Continue an owned release-readiness checkpoint after a real worker restart.",
      "before": [
        {
          "id": "security-review",
          "state": "approved"
        },
        {
          "id": "migration-check",
          "state": "pending"
        }
      ],
      "after": [
        {
          "id": "security-review",
          "state": "approved"
        },
        {
          "id": "migration-check",
          "state": "approved"
        }
      ]
    },
    "expected": {
      "roles": {
        "release": {
          "decisions": [
            "blocked",
            "ready"
          ],
          "evidenceIds": [
            "security-review",
            "migration-check"
          ]
        }
      },
      "decision": "ready",
      "kind": "release-continuation"
    }
  }
] as const;
