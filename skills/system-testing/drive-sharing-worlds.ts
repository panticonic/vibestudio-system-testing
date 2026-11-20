const target = "release_roster";
const folderId = "delivery_folder";
const driveId = "delivery_shared";
const cutoff = "2026-10-01T00:00:00Z";
const sheet = "application/vnd.google-apps.spreadsheet";
const shortcut = "application/vnd.google-apps.shortcut";
const targetRow = {
  id: target,
  name: "Release roster",
  mimeType: sheet,
  modifiedTime: cutoff,
};
const planningNotes = {
  ...targetRow,
  id: "release_roster_planning",
  name: "Release roster planning notes",
};
const alias = {
  id: "roster_alias",
  name: "Release roster",
  mimeType: shortcut,
  shortcutDetails: { targetId: target, targetMimeType: sheet },
};
const outdated = {
  id: "retired_roster",
  name: "Release roster",
  mimeType: sheet,
  modifiedTime: "2026-09-01T00:00:00Z",
};
const internal = "example.test";
const reader = {
  id: "internal_reader",
  type: "user",
  role: "reader",
  emailAddress: "reader@example.test",
};
const permissionPages = [
  {
    cursor: null,
    response: {
      nextPageToken: "owners-and-links",
      permissions: [
        {
          id: "internal_writer",
          type: "user",
          role: "writer",
          emailAddress: "writer@EXAMPLE.TEST",
        },
        {
          id: "external_group",
          type: "group",
          role: "reader",
          emailAddress: "release@sub.example.test",
        },
        { id: "deleted_link", type: "anyone", role: "reader", deleted: true },
      ],
    },
  },
  {
    cursor: "owners-and-links",
    response: {
      permissions: [
        {
          id: "public_link",
          type: "anyone",
          role: "reader",
          allowFileDiscovery: false,
        },
        {
          id: "internal_organizer",
          type: "user",
          role: "fileOrganizer",
          emailAddress: "ops@example.test",
        },
        reader,
      ],
    },
  },
] as const;

const inventory = {
  kind: "inventory" as const,
  folderId,
  goal: "Find the current Release roster used for the delivery handoff. Leave out release planning notes even when they are current spreadsheets.",
  media: [sheet],
  modifiedSince: cutoff,
};
const sharing = {
  kind: "sharing" as const,
  fileId: target,
  goal: "Find exact direct sharing risks on the confirmed roster. Only the assigned domain is approved, and writers and organizers are outside the read-only policy.",
  allowedDomains: [internal],
  allowWriters: false,
};

export const managedDriveSharingWorlds = [
  {
    id: "confirmed-roster-direct-sharing",
    goal: "Find the exact current Release roster and audit its direct sharing. Cite the public link, disallowed editor roles and the group outside the exact approved domain.",
    driveId,
    inventory,
    sharing,
    folderPages: [
      {
        cursor: null,
        response: {
          files: [alias, outdated, planningNotes],
          nextPageToken: "folder-tail",
        },
      },
      { cursor: "folder-tail", response: { files: [targetRow] } },
    ],
    permissionPages,
    expected: {
      gate: "audited",
      eligibleIds: [planningNotes.id, target],
      inventoryIds: [target],
      ids: [
        "internal_writer",
        "external_group",
        "public_link",
        "internal_organizer",
      ],
    },
  },
  {
    id: "shortcut-does-not-confirm-roster",
    goal: "Check whether the assigned roster is present before reviewing its sharing. The shortcut and the older file have similar names. Keep the sharing audit on hold unless the exact current file is confirmed.",
    driveId,
    inventory,
    sharing,
    folderPages: [
      { cursor: null, response: { files: [alias, outdated, planningNotes] } },
    ],
    permissionPages: [],
    expected: {
      gate: "target-unconfirmed",
      eligibleIds: [planningNotes.id],
      inventoryIds: [],
      ids: [],
    },
  },
  {
    id: "roster-confirmation-with-unavailable-tail",
    goal: "Review the assigned Release roster under the complete-inventory requirement. Preserve the observed roster if the tail is unavailable, and hold the sharing audit until the listing is complete.",
    driveId,
    inventory,
    sharing,
    folderPages: [
      {
        cursor: null,
        response: {
          files: [planningNotes, targetRow],
          nextPageToken: "folder-tail",
        },
      },
      { cursor: "folder-tail", response: null },
    ],
    permissionPages: [],
    expected: {
      gate: "inventory-partial",
      eligibleIds: [planningNotes.id, target],
      inventoryIds: [target],
      ids: [],
    },
  },
  {
    id: "roster-with-incomplete-search-flag",
    goal: "Confirm which spreadsheet is the delivery roster and determine whether its direct access can be reviewed. Drive finished pagination but flagged the search as incomplete. Retain the verified roster ID and report the coverage limit.",
    driveId,
    inventory,
    sharing,
    folderPages: [
      {
        cursor: null,
        response: {
          files: [planningNotes],
          nextPageToken: "folder-tail",
          incompleteSearch: true,
        },
      },
      { cursor: "folder-tail", response: { files: [targetRow] } },
    ],
    permissionPages: [],
    expected: {
      gate: "inventory-partial",
      eligibleIds: [planningNotes.id, target],
      inventoryIds: [target],
      ids: [],
    },
  },
] as const;
