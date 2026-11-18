import type { ContentProjectRequest } from "@workspace/natlang-services";
/** Original source siblings must remain in one split; see CONTENT_PROJECT_WORLDS.md. */
export const contentProjectWorlds: {id:string;sourceGroup:string;request:ContentProjectRequest}[] = [
  {
    "id": "release-runbook",
    "request": {
      "goal": "Create a release and rollback runbook from the supplied operations facts. Prepare and locally commit the reviewed project; do not publish or claim the release ran.",
      "audience": "The release operator and an independent rollback operator",
      "documentRoles": [
        "release procedure with ordered verification gates",
        "rollback procedure and handoff",
        "navigation and source provenance"
      ],
      "facts": [
        {
          "id": "release-order",
          "text": "Publish the static bundle only after staging smoke checks pass; then switch the preview alias; record the resulting alias target before inviting reviewers."
        },
        {
          "id": "release-owner",
          "text": "Mina owns staging verification. The release operator owns bundle publication and alias switch."
        },
        {
          "id": "rollback-basis",
          "text": "Before switching the alias record its existing target. On a failing preview smoke check restore that exact recorded target and run the preview smoke check again."
        },
        {
          "id": "release-handoff",
          "text": "The handoff includes the previous target, the new target, and both staging and preview smoke evidence. None of these actions has occurred yet."
        }
      ]
    },
    "sourceGroup": "content-project/release-operations-v1"
  },
  {
    "id": "role-onboarding",
    "request": {
      "goal": "Create a role-aware onboarding handbook and reusable handoff checklist from the supplied facts. Prepare and locally commit it without publishing or marking onboarding complete.",
      "audience": "New workspace contributors and the teammate helping them join",
      "documentRoles": [
        "role-dependent access guide",
        "parallel preparation and prerequisite checklist",
        "handoff checklist and navigation"
      ],
      "facts": [
        {
          "id": "viewer-role",
          "text": "Viewers need the shared reading workspace and need no deployment credentials."
        },
        {
          "id": "editor-role",
          "text": "Editors additionally need the private draft workspace. The teammate grants draft access only after confirming the person's editor role."
        },
        {
          "id": "parallel-work",
          "text": "Reading the architecture guide and choosing a first issue can happen independently. Submitting a draft change requires private draft access first."
        },
        {
          "id": "onboarding-handoff",
          "text": "The handoff records the confirmed role, access actually granted, chosen first issue and unanswered questions. Leave uncompleted steps unchecked; no access has been granted yet."
        }
      ]
    },
    "sourceGroup": "content-project/workspace-access-v1"
  },
  {
    "id": "release-incident-handback",
    "sourceGroup": "content-project/release-operations-v1",
    "request": {
      "goal": "Prepare a release interruption handback pack that separates the supplied observations, unknowns, conditional recovery and the next shift’s ownership. Prepare and locally commit the reviewed content project without publication. Describe plans and supplied observations faithfully; do not claim new actions occurred.",
      "audience": "The outgoing release operator and incoming incident lead",
      "documentRoles": [
        "evidence timeline with unresolved questions",
        "conditional recovery decision table",
        "shift handback checklist"
      ],
      "facts": [
        {
          "id": "release-basis",
          "text": "The release protocol verifies staging before publishing a bundle, then switches the preview alias and records its target."
        },
        {
          "id": "handoff-observation",
          "text": "At the handback, the operator has supplied staging smoke evidence but no recorded preview-alias target or preview smoke result. An omitted result is unknown, not a failure."
        },
        {
          "id": "handoff-owner",
          "text": "Mina owns staging verification. The release operator owns the alias history. The incoming incident lead coordinates decisions, but does not inherit deployment credentials automatically."
        },
        {
          "id": "conditional-recovery",
          "text": "If preview smoke fails after a verified alias switch, the release operator restores the previously recorded target and runs preview smoke again. Without that prior target, stop and ask the operator to recover the record rather than guessing."
        },
        {
          "id": "handoff-record",
          "text": "The next shift needs the staging evidence reference, the last verified alias state, open questions and one named owner per follow-up. No rollback has been reported."
        }
      ]
    }
  },
  {
    "id": "workspace-offboarding",
    "sourceGroup": "content-project/workspace-access-v1",
    "request": {
      "goal": "Prepare a workspace departure and continuity dossier distinguishing access removal, ownership transfer and retained project history. Prepare and locally commit the reviewed content project without publication. Describe plans and supplied observations faithfully; do not claim new actions occurred.",
      "audience": "The departing editor, their teammate and the workspace owner",
      "documentRoles": [
        "role and access disposition matrix",
        "ownership handover procedure",
        "evidence and unresolved-items register"
      ],
      "facts": [
        {
          "id": "access-model",
          "text": "Viewers use the shared reading workspace. Editors additionally use the private draft workspace; deployment credentials are separate from either role."
        },
        {
          "id": "departure-scope",
          "text": "The departing contributor is an editor with a private draft. They have not reported holding deployment credentials. Do not equate missing credential information with confirmation that none exist."
        },
        {
          "id": "transfer-order",
          "text": "The workspace owner must name a successor and the successor must acknowledge draft ownership before the teammate removes private-draft access."
        },
        {
          "id": "retained-history",
          "text": "Project history and authored attribution remain available under the workspace retention policy; removing access is not permission to delete repositories or rewrite attribution."
        },
        {
          "id": "departure-evidence",
          "text": "Record the acknowledged successor, access changes actually confirmed, unknown credential status and unresolved items. None of the transfers or removals has been confirmed."
        }
      ]
    }
  },
  {
    "id": "migration-cutover",
    "sourceGroup": "content-project/inventory-migration-v1",
    "request": {
      "goal": "Create an inventory migration cutover runbook with parallel preparations, a hard freeze prerequisite and a recoverable switch. Prepare and locally commit the reviewed content project without publication. Describe plans and supplied observations faithfully; do not claim new actions occurred.",
      "audience": "The inventory owner and migration operator",
      "documentRoles": [
        "dependency-aware cutover sequence",
        "rollback and escalation guide",
        "recorded-basis checklist"
      ],
      "facts": [
        {
          "id": "migration-source",
          "text": "The source is inventory.csv revision INV-42; target staging is warehouse-preview. No cutover has occurred."
        },
        {
          "id": "migration-parallel",
          "text": "The inventory owner can review SKU mappings while the operator rehearses the import. Both must finish before the freeze request."
        },
        {
          "id": "migration-freeze",
          "text": "Only the inventory owner may confirm the source write freeze. Export and record the source checksum after that confirmation; a rehearsal checksum is not the frozen-source checksum."
        },
        {
          "id": "migration-gate",
          "text": "Switch readers only after row counts and total stock quantities match the frozen export. Matching row counts alone is insufficient."
        },
        {
          "id": "migration-recovery",
          "text": "Before switching, record the existing reader endpoint. On a failed post-switch check restore that recorded endpoint; preserve the failed staging data and evidence for diagnosis."
        }
      ]
    }
  },
  {
    "id": "migration-discrepancy",
    "sourceGroup": "content-project/inventory-migration-v1",
    "request": {
      "goal": "Prepare a migration reconciliation dossier from conflicting validation evidence, keeping observations separate from release permission. Prepare and locally commit the reviewed content project without publication. Describe plans and supplied observations faithfully; do not claim new actions occurred.",
      "audience": "The inventory reviewer deciding whether to authorize cutover",
      "documentRoles": [
        "observed discrepancy ledger",
        "investigation and decision prerequisites",
        "reviewer handoff"
      ],
      "facts": [
        {
          "id": "migration-source",
          "text": "The source under review is inventory.csv revision INV-42 and staging is warehouse-preview."
        },
        {
          "id": "migration-observed",
          "text": "The supplied rehearsal report says row counts match but total stock differs. It does not identify which SKUs differ or provide a frozen-export checksum."
        },
        {
          "id": "migration-rule",
          "text": "Cutover needs both matching row counts and matching stock totals against an export taken after the owner confirms a write freeze."
        },
        {
          "id": "migration-unknown",
          "text": "No freeze confirmation is included. The rehearsal must not be presented as the final frozen-source validation."
        },
        {
          "id": "migration-followup",
          "text": "The operator investigates per-SKU differences; the inventory owner confirms mapping intent. Preserve both the original rehearsal report and later corrections with their provenance. No corrected totals have been supplied."
        }
      ]
    }
  },
  {
    "id": "research-session-consent",
    "sourceGroup": "content-project/research-consent-v1",
    "request": {
      "goal": "Prepare a participant-session plan that makes separate permissions and withdrawal conditions usable for a facilitator. Prepare and locally commit the reviewed content project without publication. Describe plans and supplied observations faithfully; do not claim new actions occurred.",
      "audience": "A research facilitator and the note taker",
      "documentRoles": [
        "consent and permitted-use matrix",
        "session procedure with conditional branches",
        "withdrawal and evidence checklist"
      ],
      "facts": [
        {
          "id": "research-scope",
          "text": "Study R-17 explores how editors find private drafts. Participation, audio recording and attributed quotation require separate choices."
        },
        {
          "id": "research-choice",
          "text": "A participant may join without audio recording. Refusing recording must not prevent participation; the note taker can take de-identified notes."
        },
        {
          "id": "research-order",
          "text": "Explain the study and record each consent choice before starting the corresponding activity. Requesting permission is not proof it was granted."
        },
        {
          "id": "research-withdrawal",
          "text": "Participants may withdraw their identifiable material before synthesis lock. The coordinator records the request and confirms which material was removed; anonymous aggregates already shared cannot be traced to an individual."
        },
        {
          "id": "research-timing",
          "text": "The coordinator sets and communicates the synthesis-lock date. No date or participant consent choices have been supplied."
        }
      ]
    }
  },
  {
    "id": "research-evidence-handoff",
    "sourceGroup": "content-project/research-consent-v1",
    "request": {
      "goal": "Prepare a research synthesis handoff that preserves consent boundaries, contradictory observations and uncertainty. Prepare and locally commit the reviewed content project without publication. Describe plans and supplied observations faithfully; do not claim new actions occurred.",
      "audience": "The study R-17 synthesizer and project author",
      "documentRoles": [
        "evidence provenance and permitted-use register",
        "contradictions and open-questions brief",
        "publication readiness checklist"
      ],
      "facts": [
        {
          "id": "research-scope",
          "text": "Study R-17 concerns editors finding private drafts. Participation, recording and attributed quotation are separate permissions."
        },
        {
          "id": "research-evidence",
          "text": "The supplied session inventory contains de-identified notes and audio whose recording permission is confirmed. Attributed-quotation permission is not recorded."
        },
        {
          "id": "research-boundary",
          "text": "Recording consent does not authorize attributed quotations. Use de-identified synthesis unless the separate quotation permission is established."
        },
        {
          "id": "research-contradiction",
          "text": "One note says draft search was easy and another says the participant could not find a draft. Neither note includes enough context to resolve the disagreement. Preserve both observations rather than reporting a consensus."
        },
        {
          "id": "research-release",
          "text": "Before external sharing, the coordinator checks withdrawals received before synthesis lock and reviews re-identification risk. No withdrawal review, lock date or sharing approval is included."
        }
      ]
    }
  },
  {
    "id": "event-weather-plan",
    "sourceGroup": "content-project/community-event-v1",
    "request": {
      "goal": "Create an outdoor workspace-demo event plan with explicit weather decision ownership and parallel accessibility preparation. Prepare and locally commit the reviewed content project without publication. Describe plans and supplied observations faithfully; do not claim new actions occurred.",
      "audience": "The event coordinator and volunteer leads",
      "documentRoles": [
        "weather decision and notification runbook",
        "accessibility and setup dependency plan",
        "contact and evidence checklist"
      ],
      "facts": [
        {
          "id": "event-options",
          "text": "The planned demo location is Riverside Lawn; the reserved indoor alternative is Cedar Room. No relocation decision has been made."
        },
        {
          "id": "event-decision",
          "text": "Only the coordinator decides relocation after consulting the venue weather advisory. Volunteers may report conditions but do not independently announce a location change."
        },
        {
          "id": "event-parallel",
          "text": "The accessibility lead can verify both routes while the setup lead inventories equipment. Equipment movement waits for the coordinator’s location decision."
        },
        {
          "id": "event-access",
          "text": "If Cedar Room is selected, verify its step-free entrance is open before publishing attendee directions. A reserved room does not establish that the entrance is currently accessible."
        },
        {
          "id": "event-notify",
          "text": "After the location and access route are confirmed, update the event page and notify registered attendees. Record the decision basis, decision owner and notification completion separately."
        }
      ]
    }
  },
  {
    "id": "event-volunteer-handoff",
    "sourceGroup": "content-project/community-event-v1",
    "request": {
      "goal": "Prepare a volunteer shift handoff from incomplete arrival information without silently assigning decision authority. Prepare and locally commit the reviewed content project without publication. Describe plans and supplied observations faithfully; do not claim new actions occurred.",
      "audience": "The incoming volunteer lead and event coordinator",
      "documentRoles": [
        "confirmed-versus-unknown status board",
        "role-specific first actions",
        "escalation and attendee messaging guide"
      ],
      "facts": [
        {
          "id": "event-options",
          "text": "The event can use Riverside Lawn or reserved Cedar Room. Only the coordinator decides relocation using the venue weather advisory."
        },
        {
          "id": "event-status",
          "text": "The supplied log confirms the equipment inventory is complete. It says the coordinator requested an indoor-route check, but contains neither a route-check result nor a final location decision."
        },
        {
          "id": "event-inference",
          "text": "A requested indoor-route check is not evidence of relocation. Keep location and step-free entrance status unresolved until the responsible leads confirm them."
        },
        {
          "id": "event-roles",
          "text": "The accessibility lead reports the route check, the coordinator confirms location and the communications volunteer updates the event page after both location and access are confirmed."
        },
        {
          "id": "event-handoff",
          "text": "Incoming volunteers should preserve the original log, record who supplied each new confirmation and escalate unanswered location questions to the coordinator. Do not tell attendees that relocation or notification has already occurred."
        }
      ]
    }
  },
  {
    "id": "dataset-release-review",
    "sourceGroup": "content-project/dataset-stewardship-v1",
    "request": {
      "goal": "Prepare a dataset release review pack with separate consent, data-quality and publication decisions. Prepare and locally commit the reviewed content project without publication. Describe plans and supplied observations faithfully; do not claim new actions occurred.",
      "audience": "The dataset steward and independent release reviewer",
      "documentRoles": [
        "release criteria and ownership matrix",
        "evidence provenance register",
        "conditional publication checklist"
      ],
      "facts": [
        {
          "id": "dataset-identity",
          "text": "The candidate is support-intents version D-8, derived from internal ticket annotations. The candidate has not been published."
        },
        {
          "id": "dataset-access",
          "text": "The steward confirms the permitted-use basis for source tickets. A data-quality pass cannot substitute for that confirmation."
        },
        {
          "id": "dataset-quality",
          "text": "The independent reviewer checks duplicate conversations across splits and validates the label sample. Both checks are required; a sampled-label pass alone does not establish split separation."
        },
        {
          "id": "dataset-provenance",
          "text": "Retain the source revision, transformation version and exclusion log with the candidate manifest. A changed transformation produces a new candidate rather than overwriting D-8’s evidence."
        },
        {
          "id": "dataset-publication",
          "text": "Publish only after permitted-use and both quality checks are recorded. The supplied material specifies the criteria but contains no completed check results or release approval."
        }
      ]
    }
  },
  {
    "id": "dataset-correction-recall",
    "sourceGroup": "content-project/dataset-stewardship-v1",
    "request": {
      "goal": "Prepare a published-dataset correction and consumer-notification plan that preserves the old release evidence and distinguishes a proposed replacement from an approved one. Prepare and locally commit the reviewed content project without publication. Describe plans and supplied observations faithfully; do not claim new actions occurred.",
      "audience": "The dataset steward, reviewer and downstream consumers",
      "documentRoles": [
        "affected-release and uncertainty brief",
        "correction validation and release sequence",
        "consumer notification and provenance register"
      ],
      "facts": [
        {
          "id": "dataset-report",
          "text": "A supplied issue report identifies a possible conversation overlap in support-intents D-8. The report has not been independently reproduced and does not list affected consumers."
        },
        {
          "id": "dataset-triage",
          "text": "The reviewer reproduces the overlap check against the original D-8 manifest. The steward inventories known distribution locations in parallel; neither activity requires claiming that the defect is already confirmed."
        },
        {
          "id": "dataset-correction",
          "text": "If the overlap is confirmed, prepare a new candidate with a new version and exclusion log. Repeat both split-separation and label-sample checks; do not overwrite the original release or its evidence."
        },
        {
          "id": "dataset-permission",
          "text": "The steward rechecks permitted-use coverage for any newly added source records. A prior release approval does not automatically cover additions."
        },
        {
          "id": "dataset-notice",
          "text": "The steward approves the consumer notice after affected scope and replacement status are known. The notice distinguishes reported issue, confirmed findings and replacement availability; an unapproved candidate is not a released fix."
        }
      ]
    }
  }
];
