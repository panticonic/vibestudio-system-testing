import type { ContentProjectRequest } from "@workspace/natlang-services";
export const contentProjectWorlds: {id:string;request:ContentProjectRequest}[] = [
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
    }
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
    }
  }
];
