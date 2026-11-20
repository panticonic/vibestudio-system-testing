const workspace = { kind: "gmail", workspace: "google-workspace" } as const;
const mime = (stem: string) => `<${stem}@handoff.example.test>`;
const compose = (key: string, title: string, room: string, threadId: string, identity: string,
  current: { status: "saved" | "saving" | "sent" | "delivery-unknown"; draftId?: string; sentMessageId?: string }) =>
  ({
    key, title, room,
    initial: { status: "review", subject: title, threadId, rfcMessageId: mime(identity), to: "team@example.test" },
    updates: [current],
  });
const draft = (id: string, messageId: string, threadId: string, identity: string, subject: string,
  preview: string, recipient = "team@example.test", sender = "dispatch@example.test") =>
  ({ id, messageId, threadId, mimeId: mime(identity), subject, preview, recipient, sender });
const get = (id: string) => ({ kind: "get" as const, id });
const verify = (id: string) => ({ kind: "verify" as const, id });
const find = (cursor: string | null = null) => ({ kind: "find" as const, cursor });
const sent = { kind: "sent" } as const;
const draftRequest = (id: string, status = 200) => ({ kind: "draft" as const, id, cursor: null, status });
const searchRequest = (identity: string, cursor: string | null = null, status = 200) =>
  ({ kind: "find" as const, id: mime(identity), cursor, status });
const sentRequest = (id: string, status = 200) => ({ kind: "sent" as const, id, cursor: null, status });

export const openGoalGmailWorlds = [
  {
    ...workspace, id: "verify-retained-venue-pickup-draft",
    goal: "I closed the venue pickup compose in Event Logistics. Verify the saved Gmail draft with that room’s title and read back the current subject, recipient and pickup instruction. Check that it remains the same revision. Leave it unsent.",
    sourceGroup: "vibestudio:gmail:event-logistics-pickup",
    composes: [
      compose("logistics", "Venue pickup", "Event Logistics", "th-venue", "venue", { status: "saved", draftId: "pickup" }),
      compose("collaborator", "Venue pickup", "Volunteer chat", "th-volunteer", "venue-copy", { status: "saved", draftId: "pickup-decoy" }),
    ],
    provider: { drafts: [
      draft("pickup", "pickup-r1", "th-venue", "venue", "Venue pickup", "Meet at the loading door at 15:30 UTC."),
      draft("pickup-decoy", "pickup-decoy-r1", "th-volunteer", "venue-copy", "Venue pickup", "Proposed pickup from the front desk."),
    ] },
    expected: { compose: "logistics", status: "confirmed", operations: [get("pickup"), verify("pickup")],
      requests: [draftRequest("pickup"), draftRequest("pickup")], providerId: "pickup" },
  },
  {
    ...workspace, id: "recover-accepted-fleet-draft-after-lost-acknowledgement",
    goal: "The Fleet Updates compose for the Tire delivery was still saving when the panel died. Reconcile that saved compose with Gmail before anyone tries again. If Gmail retained exactly one matching draft, give the next operator the verified draft and leave it there.",
    sourceGroup: "vibestudio:gmail:fleet-save-acknowledgement",
    composes: [compose("fleet", "Tire delivery", "Fleet Updates", "th-tires", "fleet", { status: "saving" })],
    provider: { drafts: [
      draft("tires", "tires-r1", "th-tires", "fleet", "Tire delivery", "Deliver to bay two."),
      draft("tires-old", "tires-old-r1", "th-tires", "fleet-old", "Tire delivery", "Old instruction: use bay one."),
    ] },
    expected: { compose: "fleet", status: "recovered", operations: [find(), get("tires"), verify("tires")],
      requests: [searchRequest("fleet"), draftRequest("tires"), draftRequest("tires")], providerId: "tires" },
  },
  {
    ...workspace, id: "hold-report-draft-when-provider-identity-moved",
    goal: "Operations had a saved Overnight report draft. Check the retained draft itself and tell me whether the provider still associates it with this compose. If its identity changed, hold continuity. Don't use a matching subject as evidence, and don't look for unrelated mail.",
    sourceGroup: "vibestudio:gmail:overnight-draft-stale-mime",
    composes: [compose("report", "Overnight report", "Operations", "th-night", "night-old", { status: "saved", draftId: "night" })],
    provider: { drafts: [draft("night", "night-r2", "th-night", "night-new", "Overnight report", "Another revision replaced the retained one.")] },
    expected: { compose: "report", status: "stale", operations: [get("night")],
      requests: [draftRequest("night")], providerId: "night" },
  },
  {
    ...workspace, id: "recheck-exhibit-invitation-revision-before-continuing",
    goal: "The Exhibition opening draft in Gallery Operations is being edited elsewhere. Inspect it, then check the exact revision again before reporting continuity. If a different provider revision arrived, report the newer content and keep the earlier approval on hold. Don't save or send anything.",
    sourceGroup: "vibestudio:gmail:gallery-provider-revision-race",
    composes: [compose("invite", "Exhibition opening", "Gallery Operations", "th-invite", "gallery", { status: "saved", draftId: "invite" })],
    provider: {
      drafts: [draft("invite", "invite-r1", "th-invite", "gallery", "Exhibition opening", "Doors at 08:30 UTC.")],
      changeAfterRead: { id: "invite", next: draft("invite", "invite-r2", "th-invite", "gallery", "Exhibition opening", "Doors moved to 09:15 UTC.") },
    },
    expected: { compose: "invite", status: "stale", operations: [get("invite"), verify("invite")],
      requests: [draftRequest("invite"), draftRequest("invite")], providerId: "invite" },
  },
  {
    ...workspace, id: "recover-relinked-booking-draft-from-mime",
    goal: "The old Room booking link in the Conference Desk compose seems broken. Locate a verified draft with the same retained message identity, even if Gmail gave it a new draft ID. Do not create a replacement or deliver anything.",
    sourceGroup: "vibestudio:gmail:conference-draft-relink",
    composes: [compose("booking", "Room booking", "Conference Desk", "th-booking", "conference",
      { status: "saved", draftId: "old-booking-link" })],
    provider: { drafts: [draft("current-booking-link", "booking-r2", "th-booking", "conference", "Room booking", "Keep the upstairs room.")] },
    expected: { compose: "booking", status: "recovered",
      operations: [get("old-booking-link"), find(), get("current-booking-link"), verify("current-booking-link")],
      requests: [draftRequest("old-booking-link", 404), searchRequest("conference"),
        draftRequest("current-booking-link"), draftRequest("current-booking-link")],
      providerId: "current-booking-link" },
  },
  {
    ...workspace, id: "distinguish-duplicate-local-check-in-composes",
    goal: "Please check where I left the Check-in notice draft. I don't remember which room it was for. If the available drafts are indistinguishable from that title, ask me which conversation owns it before reading provider content.",
    sourceGroup: "vibestudio:gmail:check-in-local-ambiguity",
    composes: [
      compose("one", "Check-in notice", "Clinic Front Desk", "th-clinic", "check-clinic", { status: "saved", draftId: "clinic" }),
      compose("two", "Check-in notice", "Guest Services", "th-guest", "check-guest", { status: "saved", draftId: "guest" }),
    ],
    provider: { drafts: [
      draft("clinic", "clinic-r1", "th-clinic", "check-clinic", "Check-in notice", "Bring the appointment letter."),
      draft("guest", "guest-r1", "th-guest", "check-guest", "Check-in notice", "Bring the reservation receipt."),
    ] },
    expected: { compose: null, status: "ambiguous", operations: [], requests: [], providerId: null },
  },
  {
    ...workspace, id: "hold-on-incomplete-claims-provider-search",
    goal: "Check whether Claims Intake has exactly one persisted Response to agency compose after its interrupted save. If you cannot finish looking through the matching results, say that the search is unavailable. Don't treat the first page as proof.",
    sourceGroup: "vibestudio:gmail:claims-provider-search-tail",
    composes: [compose("claims", "Response to agency", "Claims Intake", "th-claims", "claims", { status: "saving" })],
    provider: {
      pageSize: 1,
      drafts: [
        draft("claims-a", "claims-r1", "th-claims", "claims", "Response to agency", "Preserve the inquiry dates."),
        draft("claims-b", "claims-r2", "th-claims", "claims", "Response to agency", "The policy team will confirm."),
      ],
      faults: { [`find:${mime("claims")}:page-1`]: 503 },
    },
    expected: { compose: "claims", status: "unavailable", operations: [find(), find("page-1")],
      requests: [searchRequest("claims"), searchRequest("claims", "page-1", 503)], providerId: null },
  },
  {
    ...workspace, id: "confirm-unaddressed-transit-draft-needs-review",
    goal: "Is the saved Travel advisory from Transit Alerts a complete draft? Read it back in Gmail to check whether a recipient survived the last save. Keep the draft even if the recipient is still missing. Do not send it.",
    sourceGroup: "vibestudio:gmail:transit-cleared-recipient",
    composes: [compose("transit", "Travel advisory", "Transit Alerts", "th-transit", "transit",
      { status: "saved", draftId: "advisory" })],
    provider: { drafts: [draft("advisory", "advisory-r2", "th-transit", "transit", "Travel advisory", "Bus route starts at South Station.", "")] },
    expected: { compose: "transit", status: "incomplete", operations: [get("advisory"), verify("advisory")],
      requests: [draftRequest("advisory"), draftRequest("advisory")], providerId: "advisory" },
  },
  {
    ...workspace, id: "verify-retained-observatory-delivery-receipt",
    goal: "After reconnecting to Observatory Dispatch, check whether the retained Weather notice delivery receipt really points to the matching message in Gmail Sent. Do not compose, send or archive anything.",
    sourceGroup: "vibestudio:gmail:observatory-delivery-readback",
    composes: [compose("weather", "Weather notice", "Observatory Dispatch", "th-weather", "weather",
      { status: "sent", sentMessageId: "sent-weather" })],
    provider: { drafts: [], sent: [draft("receipt", "sent-weather", "th-weather", "weather", "Weather notice", "The exterior deck is closed.")] },
    expected: { compose: "weather", status: "delivery-confirmed", operations: [sent],
      requests: [sentRequest("sent-weather")], providerId: "sent-weather" },
  },
  {
    ...workspace, id: "report-retained-rota-draft-link-missing-without-search",
    goal: "Only check the saved Weekend rota draft link in Staff Cover. If the linked Gmail draft is gone, say so and stop. I don't want a mailbox search for similar drafts or a new one.",
    sourceGroup: "vibestudio:gmail:rota-linked-draft-missing",
    composes: [compose("rota", "Weekend rota", "Staff Cover", "th-rota", "rota", { status: "saved", draftId: "rota-removed" })],
    provider: { drafts: [
      draft("rota-other", "other-rota-r1", "th-other-rota", "rota-other", "Weekend rota", "Copy from another request."),
    ] },
    expected: { compose: "rota", status: "missing", operations: [get("rota-removed")],
      requests: [draftRequest("rota-removed", 404)], providerId: null },
  },
  {
    ...workspace, id: "do-not-recreate-missing-permit-application-save",
    goal: "The Permit application compose from Site Licensing still says saving. Decide whether Gmail actually kept a draft under that compose identity. If the exact search finds nothing, report the missing save and leave the mailbox alone.",
    sourceGroup: "vibestudio:gmail:permit-application-save-absent",
    composes: [compose("permit", "Permit application", "Site Licensing", "th-permit", "permit", { status: "saving" })],
    provider: { drafts: [
      draft("permit-copy", "permit-copy-r1", "th-permit", "permit-copy", "Permit application", "A separate permit draft."),
    ] },
    expected: { compose: "permit", status: "missing", operations: [find()],
      requests: [searchRequest("permit")], providerId: null },
  },
  {
    ...workspace, id: "preserve-receiving-window-gone-between-provider-reads",
    goal: "Warehouse Scheduling's Receiving window draft may be getting cleaned out. Read the retained draft and confirm it is still present before saying anyone should continue it. If it disappears while you are checking, report the stale result without replacing it.",
    sourceGroup: "vibestudio:gmail:warehouse-draft-disappearance",
    composes: [compose("receiving", "Receiving window", "Warehouse Scheduling", "th-receiving", "receiving",
      { status: "saved", draftId: "receiving-draft" })],
    provider: {
      drafts: [draft("receiving-draft", "receiving-r1", "th-receiving", "receiving", "Receiving window", "Hold bay six until 11:00 UTC.")],
      changeAfterRead: { id: "receiving-draft", next: null },
    },
    expected: { compose: "receiving", status: "stale", operations: [get("receiving-draft"), verify("receiving-draft")],
      requests: [draftRequest("receiving-draft"), draftRequest("receiving-draft", 404)], providerId: null },
  },
  {
    ...workspace, id: "withhold-invented-delivery-after-unreadable-theatre-receipt", split: "test",
    goal: "The Theatre Guest notice in Box Office has an uncertain delivery from before reconnecting. We have no provider receipt ID. Tell me whether its draft record alone proves delivery. Leave everything as it is and don't retry.",
    sourceGroup: "vibestudio:gmail:box-office-unreadable-delivery",
    composes: [compose("theatre", "Theatre Guest notice", "Box Office", "th-theatre", "theatre",
      { status: "delivery-unknown" })],
    provider: { drafts: [] },
    expected: { compose: "theatre", status: "delivery-unconfirmed", operations: [], requests: [], providerId: null },
  },
  {
    ...workspace, id: "withhold-ambiguous-reservation-recovery-after-second-page", split: "test",
    goal: "Find the Exact Room reservation work in Facilities as it was left during an interrupted Gmail save. The old compose notes don't identify a current draft. Recover it only if the entire provider search proves a single match. Never pick between exact duplicates by their titles.",
    sourceGroup: "vibestudio:gmail:facilities-reservation-duplicate-provider",
    composes: [compose("reserve", "Exact Room reservation", "Facilities", "th-reserve", "reserve", { status: "saving" })],
    provider: { pageSize: 1, drafts: [
      draft("reserve-west", "reserve-r1", "th-reserve", "reserve", "Exact Room reservation", "Room setup uses the west door."),
      draft("reserve-east", "reserve-r2", "th-reserve", "reserve", "Exact Room reservation", "Room setup uses the east door."),
    ] },
    expected: { compose: "reserve", status: "ambiguous", operations: [find(), find("page-1")],
      requests: [searchRequest("reserve"), searchRequest("reserve", "page-1")], providerId: null },
  },
  {
    ...workspace, id: "withhold-archive-announcement-on-foreign-retained-receipt", split: "test",
    goal: "Check the Archive closure notice linked to the Archives Control conversation. The saved receipt may point to someone else's message with the same subject. Verify delivery only for the right original compose. Don't resend or alter any records.",
    sourceGroup: "vibestudio:gmail:archives-foreign-sent-receipt",
    composes: [compose("closure", "Archive closure notice", "Archives Control", "th-archive", "archive",
      { status: "sent", sentMessageId: "archive-receipt" })],
    provider: { drafts: [], sent: [
      draft("receipt", "archive-receipt", "th-public-archive", "archive-other", "Archive closure notice", "Old notice for the public desk."),
    ] },
    expected: { compose: "closure", status: "delivery-unconfirmed", operations: [sent],
      requests: [sentRequest("archive-receipt")], providerId: "archive-receipt" },
  },
] as const;
