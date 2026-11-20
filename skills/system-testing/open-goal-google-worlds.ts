const document = "application/vnd.google-apps.document";
const sheet = "application/vnd.google-apps.spreadsheet";
const shortcut = "application/vnd.google-apps.shortcut";
const archived = "2026-09-16T12:00:00Z";
const current = "2026-10-19T12:00:00Z";
const folderPage = (cursor: string | null, files: readonly object[], nextPageToken?: string) => ({
  cursor, response: { files, ...(nextPageToken ? { nextPageToken } : {}) },
});
const file = (id: string, name: string, mimeType: string, modifiedTime = current) =>
  ({ id, name, mimeType, modifiedTime });
const folder = (id: string, name: string, description: string, pages: readonly {
  cursor: string | null;
  response: object | null;
}[]) => ({ id, name, description, driveId: id + "_shared", pages });
const shared = (id: string, type: "user" | "group", role: string, emailAddress: string) =>
  ({ id, type, role, emailAddress });
const link = (id: string, deleted = false) => ({ id, type: "anyone", role: "reader", deleted });
const scaffold = { kind: "google", workspace: "google-workspace" } as const;

export const openGoalGoogleWorlds = [
  {
    ...scaffold, id: "audit-onboarding-pack-direct-access",
    goal: "We're handing the onboarding pack to Support. In the Service Launch shared folder, find the current Vendor Onboarding Pack Google Doc updated on or after October 1, 2026, and audit its direct access. Only support.example.test principals and read-only access are approved. Mention any anyone link, outside group, or writer. Leave sharing as you found it.",
    sourceGroup: "vibestudio:google-drive:vendor-launch-access",
    folders: [
      folder("launch_archive", "Launch Archive", "Material from previous launches", [
        folderPage(null, [file("pack_archived_other_folder", "Vendor Onboarding Pack", document, archived)]),
      ]),
      folder("service_launch", "Service Launch", "Current vendor and support rollout documents", [
        folderPage(null, [
          { ...file("pack_shortcut", "Vendor Onboarding Pack", shortcut), shortcutDetails: { targetId: "pack_current" } },
          file("pack_old", "Vendor Onboarding Pack", document, archived),
          file("rollout_draft", "Vendor Onboarding Pack planning notes", document),
        ], "launch_tail"),
        folderPage("launch_tail", [file("pack_current", "Vendor Onboarding Pack", document)]),
      ]),
    ],
    permissionPages: {
      pack_current: [
        { cursor: null, response: { nextPageToken: "launch_permissions_tail", permissions: [
          shared("pack_external_group", "group", "reader", "coordinators@outside.example.test"),
          shared("pack_internal_writer", "user", "writer", "staff@support.example.test"),
          link("pack_deleted_link", true),
        ] } },
        { cursor: "launch_permissions_tail", response: { permissions: [
          link("pack_public_link"),
          shared("pack_internal_reader", "user", "reader", "reader@support.example.test"),
        ] } },
      ],
      rollout_draft: [{ cursor: null, response: { permissions: [] } }],
    },
    expected: {
      mode: "audit", folderId: "service_launch", status: "complete", gate: "audited",
      inventoryIds: ["pack_current"], ids: ["pack_external_group", "pack_internal_writer", "pack_public_link"],
      profile: { allowedDomains: ["support.example.test"], allowWriters: false }, requiredTerms: ["outside.example.test", "writer", "anyone"],
    },
  },
  {
    ...scaffold, id: "hold-volunteer-directory-access-on-truncated-list",
    goal: "Can we clear the current Volunteer Directory in the Festival Office folder for handover? It's a Google Doc updated since October 1, 2026, and direct access should be read-only for festival.example.test. Find the current file, but hold any permission review if the inventory can't be completed. Tell me what was observed and where coverage stops.",
    sourceGroup: "vibestudio:google-drive:festival-directory-coverage",
    folders: [
      folder("festival_office", "Festival Office", "Approved volunteer operations documents", [
        folderPage(null, [
          file("directory_decoy", "Volunteer Directory planning notes", document),
          file("directory_observed", "Volunteer Directory", document),
        ], "festival_tail"),
        { cursor: "festival_tail", response: null },
      ]),
      folder("festival_accounts", "Festival Accounts", "Volunteer expense and invoice documents", [folderPage(null, [])]),
    ],
    permissionPages: { directory_observed: [{ cursor: null, response: { permissions: [] } }] },
    expected: {
      mode: "audit", folderId: "festival_office", status: "partial", gate: "inventory-partial",
      inventoryIds: ["directory_observed"], ids: [], requiredTerms: [],
    },
  },
  {
    ...scaffold, id: "resolve-conflicting-field-briefs-before-auditing",
    goal: "I found duplicate Field Briefs in Trail Response. Identify the authoritative current Google Doc before reviewing read-only access under trail.example.test. If there are two equally current briefing documents, identify the ambiguity and wait for me to settle it. Leave permissions alone.",
    sourceGroup: "vibestudio:google-drive:trail-brief-identity",
    folders: [
      folder("trail_response", "Trail Response", "Incident plans and field briefings", [
        folderPage(null, [file("brief_south", "Field Brief", document)], "trail_tail"),
        folderPage("trail_tail", [file("brief_north", "Field Brief", document)]),
      ]),
      folder("trail_templates", "Trail Templates", "Reusable copies of briefing templates", [folderPage(null, [])]),
    ],
    permissionPages: {
      brief_south: [{ cursor: null, response: { permissions: [] } }],
      brief_north: [{ cursor: null, response: { permissions: [] } }],
    },
    expected: {
      mode: "audit", folderId: "trail_response", status: "partial", gate: "target-unconfirmed",
      inventoryIds: ["brief_south", "brief_north"], ids: [], requiredTerms: [],
    },
  },
  {
    ...scaffold, id: "inventory-current-cold-storage-logs",
    goal: "For the cold-storage reconciliation, find the updated Cooler A Log and Cooler B Log Google Sheets in Receiving Records that were modified on or after October 1, 2026. Exclude forecast sheets and drafts. Report the two current files without opening their sharing settings.",
    sourceGroup: "vibestudio:google-drive:cold-storage-inventory",
    folders: [
      folder("receiving_forecasts", "Receiving Forecasts", "Planned capacity and model sheets", [
        folderPage(null, [file("forecast_cooler", "Cooler A Log Forecast", sheet)]),
      ]),
      folder("receiving_records", "Receiving Records", "Observed daily receiving and cooler records", [
        folderPage(null, [
          file("cooler_a_draft", "Cooler A Log draft", sheet),
          file("cooler_b_old", "Cooler B Log", sheet, archived),
          file("cooler_a", "Cooler A Log", sheet),
        ], "receiving_tail"),
        folderPage("receiving_tail", [file("cooler_b", "Cooler B Log", sheet)]),
      ]),
    ],
    expected: {
      mode: "inventory", folderId: "receiving_records", status: "complete",
      inventoryIds: ["cooler_a", "cooler_b"], ids: ["cooler_a", "cooler_b"], requiredTerms: [],
    },
  },
  {
    ...scaffold, id: "reconcile-exhibit-feed-with-removal",
    goal: "Give me a change summary for the Exhibition feed since the saved handoff point. I need the final disposition for each changed file, especially whether the label draft still exists. Tell me which verified checkpoint the next shift can use without writing it.",
    sourceGroup: "vibestudio:google-drive:exhibit-change-reconciliation",
    folders: [folder("exhibit_current", "Exhibition Current", "Files visible in the current folder", [folderPage(null, [])])],
    changeSource: {
      name: "Exhibition", cursor: "exhibit_start", driveId: "exhibition_shared", pages: [
        { cursor: "exhibit_start", response: { nextPageToken: "exhibit_tail", changes: [
          { fileId: "label_draft", file: { name: "Label draft" }, time: "2026-10-18T09:00:00Z" },
          { fileId: "entry_map", file: { name: "Entry map" }, time: "2026-10-18T09:15:00Z" },
        ] } },
        { cursor: "exhibit_tail", response: { newStartPageToken: "exhibit_verified", changes: [
          { fileId: "label_draft", removed: true, time: "2026-10-18T11:00:00Z" },
        ] } },
      ],
    },
    expected: {
      mode: "changes", status: "complete", ids: ["label_draft", "entry_map"],
      checkpoint: "exhibit_verified", requiredTerms: ["remov", "updat"],
    },
  },
  {
    ...scaffold, id: "check-clearance-packet-access-at-confirmation", split: "test",
    goal: "Please clear the current Gallery Clearance Packet in Transfer Review for an internal handover. It's the Google Doc updated on or after October 1, 2026. Editors in gallery.example.test are fine, but flag direct access outside that exact domain, including anything public. Leave access unchanged.",
    sourceGroup: "vibestudio:google-drive:gallery-clearance-confirmation",
    folders: [
      folder("transfer_review", "Transfer Review", "Gallery transfer records under review", [
        folderPage(null, [
          file("gallery_other_media", "Gallery Clearance Packet", sheet),
          file("gallery_ready", "Gallery Clearance Packet", document),
        ]),
      ]),
      folder("gallery_policy", "Gallery Policy", "Approved business policy reference", [folderPage(null, [])]),
    ],
    permissionPages: {
      gallery_ready: [{ cursor: null, response: { permissions: [
        shared("gallery_writer", "user", "writer", "registrar@gallery.example.test"),
        shared("gallery_guest", "user", "reader", "events@members.gallery.example.test"),
        link("gallery_public"),
      ] } }],
    },
    expected: {
      mode: "audit", folderId: "transfer_review", status: "complete", gate: "audited",
      inventoryIds: ["gallery_ready"], ids: ["gallery_guest", "gallery_public"],
      profile: { allowedDomains: ["gallery.example.test"], allowWriters: true }, requiredTerms: ["members.gallery.example.test", "anyone"],
    },
  },
  {
    ...scaffold, id: "preserve-harbor-checkpoint-on-provider-interruption", split: "test",
    goal: "Hand over the Harbor changes since the saved checkpoint. Preserve whatever you can establish about the returned changes and tell the next operator where to resume if the rest of the feed is unavailable. Don't write a new checkpoint.",
    sourceGroup: "vibestudio:google-drive:harbor-change-interruption",
    folders: [folder("harbor_archive", "Harbor Archive", "Documents outside the current feed", [folderPage(null, [])])],
    changeSource: {
      name: "Harbor", cursor: "harbor_start", driveId: "harbor_shared", pages: [
        { cursor: "harbor_start", response: { nextPageToken: "harbor_tail", changes: [
          { fileId: "berth_map", file: { name: "Berth map" } },
          { fileId: "shift_schedule", file: { name: "Shift schedule" } },
        ] } },
        { cursor: "harbor_tail", response: null },
      ],
    },
    expected: {
      mode: "changes", status: "partial", ids: ["berth_map", "shift_schedule"],
      checkpoint: "harbor_start", requiredTerms: ["updat"],
    },
  },
] as const;
