/** Authored operational scenarios. Expected values remain private to the independent verifier. */
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
    },
    "sourceGroup": "vibestudio:owned-operations:incident:unresolved-impact-prepared-recovery"
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
    },
    "sourceGroup": "vibestudio:owned-operations:release:pending-approval-completes"
  },
  {
    "id": "incident-restored-search-missing-rollback",
    "sourceGroup": "vibestudio:owned-operations:incident:restored-impact-incomplete-recovery",
    "request": {
      "kind": "incident-handoff",
      "goal": "Prepare the handoff after customer-facing search recovered; distinguish current customer impact from unfinished recovery preparation.",
      "signals": [
        {
          "id": "search-probes",
          "text": "All customer-facing search probes pass and affected customers confirm search works again."
        },
        {
          "id": "support-queue",
          "text": "Support has no remaining customer-visible search failures."
        },
        {
          "id": "rollback-unverified",
          "text": "The replacement rollback package has not passed restoration verification."
        },
        {
          "id": "dependency-owner",
          "text": "The recovery owner still awaits the backup integrity sign-off required for handoff."
        }
      ]
    },
    "expected": {
      "kind": "incident-handoff",
      "roles": {
        "impact": {
          "decision": "ready",
          "evidenceIds": [
            "search-probes",
            "support-queue"
          ]
        },
        "recovery": {
          "decision": "blocked",
          "evidenceIds": [
            "rollback-unverified",
            "dependency-owner"
          ]
        }
      },
      "decision": "blocked"
    }
  },
  {
    "id": "incident-tenant-export-data-loss",
    "sourceGroup": "vibestudio:owned-operations:incident:customer-loss-unsafe-recovery",
    "request": {
      "kind": "incident-handoff",
      "goal": "Coordinate an export incident with unresolved customer data loss and an unsafe recovery dependency; do not let an available operator count as recovery readiness.",
      "signals": [
        {
          "id": "export-missing-rows",
          "text": "Customers still receive exports missing invoices; no corrected export has been delivered."
        },
        {
          "id": "affected-cohort",
          "text": "The enterprise cohort remains affected while individual-account exports pass."
        },
        {
          "id": "snapshot-corrupt",
          "text": "The required recovery snapshot failed integrity checking and no verified replacement exists."
        },
        {
          "id": "operator-available",
          "text": "An operator is available, but the required recovery snapshot is still unverified."
        }
      ]
    },
    "expected": {
      "kind": "incident-handoff",
      "roles": {
        "impact": {
          "decision": "blocked",
          "evidenceIds": [
            "export-missing-rows",
            "affected-cohort"
          ]
        },
        "recovery": {
          "decision": "blocked",
          "evidenceIds": [
            "snapshot-corrupt",
            "operator-available"
          ]
        }
      },
      "decision": "blocked"
    }
  },
  {
    "id": "incident-email-restoration-complete",
    "sourceGroup": "vibestudio:owned-operations:incident:confirmed-restoration-complete-recovery",
    "request": {
      "kind": "incident-handoff",
      "goal": "Prepare a final operational handoff from independently confirmed customer restoration and completed recovery prerequisites; do not claim any new deployment.",
      "signals": [
        {
          "id": "delivery-confirmed",
          "text": "Previously affected customers confirm delivery and current mailbox probes show no remaining disruption."
        },
        {
          "id": "backlog-cleared",
          "text": "All customer-visible delayed messages have been delivered."
        },
        {
          "id": "rollback-verified",
          "text": "The rollback artifact and restore procedure passed verification; all recovery handoff prerequisites are complete."
        },
        {
          "id": "dependency-signoff",
          "text": "The recovery owner signed off the queue and storage dependency checks."
        }
      ]
    },
    "expected": {
      "kind": "incident-handoff",
      "roles": {
        "impact": {
          "decision": "ready",
          "evidenceIds": [
            "delivery-confirmed",
            "backlog-cleared"
          ]
        },
        "recovery": {
          "decision": "ready",
          "evidenceIds": [
            "rollback-verified",
            "dependency-signoff"
          ]
        }
      },
      "decision": "ready"
    }
  },
  {
    "id": "release-security-approval-revoked",
    "sourceGroup": "vibestudio:owned-operations:release:approved-state-revoked",
    "request": {
      "kind": "release-continuation",
      "goal": "Persist initial release readiness. After restarting the same worker, use the newly revoked security approval to withdraw readiness; an old approved checkpoint is not current authority.",
      "before": [
        {
          "id": "security-signoff",
          "state": "approved"
        },
        {
          "id": "artifact-reproducibility",
          "state": "approved"
        },
        {
          "id": "rollback-drill",
          "state": "approved"
        }
      ],
      "after": [
        {
          "id": "security-signoff",
          "state": "rejected"
        },
        {
          "id": "artifact-reproducibility",
          "state": "approved"
        },
        {
          "id": "rollback-drill",
          "state": "approved"
        }
      ]
    },
    "expected": {
      "kind": "release-continuation",
      "roles": {
        "release": {
          "decisions": [
            "ready",
            "blocked"
          ],
          "evidenceIds": [
            "security-signoff",
            "artifact-reproducibility",
            "rollback-drill"
          ]
        }
      },
      "decision": "blocked"
    }
  },
  {
    "id": "release-partial-progress-hard-block",
    "sourceGroup": "vibestudio:owned-operations:release:partial-progress-still-rejected",
    "request": {
      "kind": "release-continuation",
      "goal": "Preserve the blocked preflight, restart, and assess updated gates. Completed documentation and migration checks do not override the still-rejected recovery gate.",
      "before": [
        {
          "id": "operator-runbook",
          "state": "pending"
        },
        {
          "id": "migration-dry-run",
          "state": "pending"
        },
        {
          "id": "recovery-drill",
          "state": "rejected"
        },
        {
          "id": "privacy-review",
          "state": "approved"
        }
      ],
      "after": [
        {
          "id": "operator-runbook",
          "state": "approved"
        },
        {
          "id": "migration-dry-run",
          "state": "approved"
        },
        {
          "id": "recovery-drill",
          "state": "rejected"
        },
        {
          "id": "privacy-review",
          "state": "approved"
        }
      ]
    },
    "expected": {
      "kind": "release-continuation",
      "roles": {
        "release": {
          "decisions": [
            "blocked",
            "blocked"
          ],
          "evidenceIds": [
            "operator-runbook",
            "migration-dry-run",
            "recovery-drill",
            "privacy-review"
          ]
        }
      },
      "decision": "blocked"
    }
  },
  {
    "id": "release-approved-checkpoint-retained",
    "sourceGroup": "vibestudio:owned-operations:release:approved-continuity-no-state-change",
    "request": {
      "kind": "release-continuation",
      "goal": "Restart the owned readiness worker and reread its approved checkpoint. Record the second actual assessment without inventing a failure, extra work or deployment when all gates remain approved.",
      "before": [
        {
          "id": "operator-authorization",
          "state": "approved"
        },
        {
          "id": "restore-proof",
          "state": "approved"
        },
        {
          "id": "preview-validation",
          "state": "approved"
        }
      ],
      "after": [
        {
          "id": "operator-authorization",
          "state": "approved"
        },
        {
          "id": "restore-proof",
          "state": "approved"
        },
        {
          "id": "preview-validation",
          "state": "approved"
        }
      ]
    },
    "expected": {
      "kind": "release-continuation",
      "roles": {
        "release": {
          "decisions": [
            "ready",
            "ready"
          ],
          "evidenceIds": [
            "operator-authorization",
            "restore-proof",
            "preview-validation"
          ]
        }
      },
      "decision": "ready"
    }
  },
  {
    "id": "release-rejected-restore-recertified",
    "sourceGroup": "vibestudio:owned-operations:release:rejected-gate-recovery-retains-history",
    "request": {
      "kind": "release-continuation",
      "goal": "Preserve the failed restore-drill checkpoint. After a real worker restart, record the independently supplied recertification evidence and reassess readiness; retain both the old failure and later approval.",
      "before": [
        {
          "id": "restore-drill",
          "state": "rejected"
        },
        {
          "id": "operator-handoff",
          "state": "approved"
        },
        {
          "id": "retention-check",
          "state": "pending"
        }
      ],
      "after": [
        {
          "id": "restore-drill",
          "state": "approved"
        },
        {
          "id": "operator-handoff",
          "state": "approved"
        },
        {
          "id": "retention-check",
          "state": "approved"
        }
      ]
    },
    "expected": {
      "kind": "release-continuation",
      "roles": {
        "release": {
          "decisions": [
            "blocked",
            "ready"
          ],
          "evidenceIds": [
            "restore-drill",
            "operator-handoff",
            "retention-check"
          ]
        }
      },
      "decision": "ready"
    }
  }
] as const;

/** Stable grouping across runs; instance and run IDs never define source siblings. */
export const ownedOperationsInventory = ownedOperationsWorlds.map(world => ({
 id: world.id, sourceGroup: world.sourceGroup, split: "train" as const, kind: world.request.kind,
 sourceId: `vibestudio:owned-operations:${world.id}`,
}));
