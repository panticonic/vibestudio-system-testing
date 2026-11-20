type Revision = {
  label: string;
  note: string;
  indexed?: false;
  files: { path: string; text: string }[];
};
type ExpectedFinding = {
  label: string;
  status: "verified" | "conflicting" | "missing" | "withdrawn";
  reads: string[];
  citations: { path: string; line: number; quote: string }[];
};
export type PersonalHistoryWorld = {
  id: string;
  kind: "personal-history";
  workspace: "personal";
  sourceGroup: string;
  split?: "test";
  goal: string;
  revisions: Revision[];
  expected: {
    findings: ExpectedFinding[];
    relation: "single" | "same" | "changed" | "unresolved";
    action: "clear" | "hold";
  };
};

export const personalHistoryRequiresUnits = [
  "skills/open-user-goal",
  "skills/memory",
  "skills/open-personal-history",
  "skills/open-personal-history-runtime",
];
export const openPersonalHistoryChecks = [
  "protectedHistory",
  "observedArchiveDiscovery",
  "readExactMilestones",
  "joinedSourceEvidence",
  "matchedDecision",
] as const;

const doc = (
  path: string,
  authority: "approved" | "draft" | "appendix" | "withdrawal",
  ...lines: string[]
) => ({ path, text: [`Record: ${authority}`, ...lines, ""].join("\n") });
const revision = (
  label: string,
  note: string,
  ...files: Revision["files"]
): Revision => ({ label, note, files });
const unindexed = (rev: Revision): Revision => ({ ...rev, indexed: false });
const cite = (path: string, quote: string, line = 2) => ({ path, line, quote });
const verified = (
  label: string,
  path: string,
  quote: string,
  reads: string[] = [path],
  line = 2,
): ExpectedFinding => ({
  label,
  status: "verified",
  reads,
  citations: [cite(path, quote, line)],
});
const missing = (label: string, ...reads: string[]): ExpectedFinding => ({
  label,
  status: "missing",
  reads,
  citations: [],
});
const withdrawn = (
  label: string,
  path: string,
  quote: string,
  ...reads: string[]
): ExpectedFinding => ({
  label,
  status: "withdrawn",
  reads: [...reads, path],
  citations: [cite(path, quote)],
});
const conflict = (
  label: string,
  left: ReturnType<typeof cite>,
  right: ReturnType<typeof cite>,
): ExpectedFinding => ({
  label,
  status: "conflicting",
  reads: [left.path, right.path],
  citations: [left, right],
});
function world(
  id: string,
  goal: string,
  revisions: Revision[],
  discoveries: ExpectedFinding[],
  relation: PersonalHistoryWorld["expected"]["relation"],
  action: PersonalHistoryWorld["expected"]["action"],
  split?: "test",
): PersonalHistoryWorld {
  return {
    id,
    kind: "personal-history",
    workspace: "personal",
    sourceGroup: `vibestudio:personal-history:${id}`,
    ...(split ? { split } : {}),
    goal,
    revisions,
    expected: { findings: discoveries, relation, action },
  };
}

export const openPersonalHistoryWorlds = [
  world(
    "museum-crate-signoff",
    "Museum transport wants to release the crate list if the signed plan at Loading approval identifies the Receiving bay. Find the recorded Receiving bay and tell us whether the release can proceed.",
    [
      revision(
        "Loading draft",
        "Floor plan circulated",
        doc("cargo/receiving-draft.md", "draft", "Receiving bay: Blue"),
      ),
      revision(
        "Loading approval",
        "Loading plan countersigned",
        doc("cargo/receiving.md", "approved", "Receiving bay: Cedar"),
        doc("cargo/receiving-draft.md", "draft", "Receiving bay: Blue"),
      ),
    ],
    [
      verified(
        "Loading approval",
        "cargo/receiving.md",
        "Receiving bay: Cedar",
        ["cargo/receiving.md", "cargo/receiving-draft.md"],
      ),
    ],
    "single",
    "clear",
  ),
  world(
    "cool-room-weekend-handoff",
    "Determine which Weekend custodian was assigned at Cold room review. The handoff needs to hold if the same review records competing approvals.",
    [
      revision(
        "Cold room review",
        "Two supervisors entered decisions",
        doc(
          "cold-room/custodian.md",
          "approved",
          "Weekend custodian: Warehouse lead",
        ),
        doc(
          "cold-room/custodian-countersign.md",
          "approved",
          "Weekend custodian: Facilities lead",
        ),
      ),
    ],
    [
      conflict(
        "Cold room review",
        cite("cold-room/custodian.md", "Weekend custodian: Warehouse lead"),
        cite(
          "cold-room/custodian-countersign.md",
          "Weekend custodian: Facilities lead",
        ),
      ),
    ],
    "unresolved",
    "hold",
  ),
  world(
    "local-ferry-exception",
    "The ferry desk needs to use the Local exception only if one was formally granted at Winter amendment. Summarize the decision even if workspace search only yields the earlier material.",
    [
      revision(
        "November pilot",
        "Pilot crossed coastal route",
        doc(
          "ferry/exception.md",
          "approved",
          "Local exception: Place a second attendant",
        ),
      ),
      unindexed(
        revision(
          "Winter amendment",
          "Seasonal schedule change",
          doc(
            "ferry/exception.md",
            "approved",
            "Local exception: Two late departures only",
          ),
          doc(
            "ferry/exception-notes.md",
            "appendix",
            "Local exception: All late departures",
          ),
        ),
      ),
    ],
    [
      verified(
        "Winter amendment",
        "ferry/exception.md",
        "Local exception: Two late departures only",
        ["ferry/exception.md", "ferry/exception-notes.md"],
      ),
    ],
    "single",
    "clear",
  ),
  world(
    "library-retirement-release",
    "Can Library operations stage the retired-books shipment using the Receiving contact recorded in June closure? Hold without a signed contact for that milestone. A contingency contact is insufficient.",
    [
      revision(
        "June closure",
        "Retirement routing update",
        doc(
          "retirement/receiving.md",
          "approved",
          "Receiving contact:",
          "Contingency contact: Saturday desk",
        ),
        doc(
          "retirement/receiving-draft.md",
          "draft",
          "Receiving contact: East desk",
        ),
      ),
    ],
    [
      missing(
        "June closure",
        "retirement/receiving.md",
        "retirement/receiving-draft.md",
      ),
    ],
    "unresolved",
    "hold",
  ),
  world(
    "maker-space-badge-threshold",
    "The maker space can use the same badge checklist if the Visitor age threshold stayed the same at Trial approval and Permanent approval. Check both release decisions, including whether the apparent extra spacing changed the value.",
    [
      revision(
        "Trial approval",
        "Temporary badge process recorded",
        doc("badge/visitors.md", "approved", "Visitor age threshold:  16"),
      ),
      revision(
        "Permanent approval",
        "Permanent badge checklist approved",
        doc(
          "badge/visitors.md",
          "approved",
          "Revision: permanent",
          "Visitor age threshold: 16",
        ),
      ),
    ],
    [
      verified(
        "Trial approval",
        "badge/visitors.md",
        "Visitor age threshold:  16",
      ),
      verified(
        "Permanent approval",
        "badge/visitors.md",
        "Visitor age threshold: 16",
        ["badge/visitors.md"],
        3,
      ),
    ],
    "same",
    "clear",
  ),
  world(
    "childcare-locker-routing",
    "Use the sign-off history to decide whether the old locker stickers can still be printed. Compare the Key cabinet between Pilot sign-off and Autumn sign-off. A changed cabinet stops printing.",
    [
      revision(
        "Pilot sign-off",
        "First closure signed",
        doc("keys/cabinet.md", "approved", "Key cabinet: Upper hall"),
      ),
      revision(
        "Autumn sign-off",
        "Secure route signed",
        doc("keys/cabinet.md", "approved", "Key cabinet: Welcome desk"),
        doc("keys/cabinet-old.md", "appendix", "Key cabinet: Upper hall"),
      ),
    ],
    [
      verified("Pilot sign-off", "keys/cabinet.md", "Key cabinet: Upper hall"),
      verified(
        "Autumn sign-off",
        "keys/cabinet.md",
        "Key cabinet: Welcome desk",
        ["keys/cabinet.md", "keys/cabinet-old.md"],
      ),
    ],
    "changed",
    "hold",
  ),
  world(
    "pop-up-venue-rollback",
    "Before we reuse the original pop-up instructions, verify that the Delivery entrance was restored at Return to baseline. Compare Original opening, Temporary transfer and Return to baseline, and allow reuse only if the last signed entrance matches the first.",
    [
      revision(
        "Original opening",
        "Opening route approved",
        doc("venue/entrance.md", "approved", "Delivery entrance: Courtyard"),
      ),
      revision(
        "Temporary transfer",
        "Route changed during repairs",
        doc("venue/entrance.md", "approved", "Delivery entrance: Canal gate"),
      ),
      revision(
        "Return to baseline",
        "Repair finished and routing restored",
        doc("venue/entrance.md", "approved", "Delivery entrance: Courtyard"),
      ),
    ],
    [
      verified(
        "Original opening",
        "venue/entrance.md",
        "Delivery entrance: Courtyard",
      ),
      verified(
        "Temporary transfer",
        "venue/entrance.md",
        "Delivery entrance: Canal gate",
      ),
      verified(
        "Return to baseline",
        "venue/entrance.md",
        "Delivery entrance: Courtyard",
      ),
    ],
    "changed",
    "clear",
  ),
  world(
    "studio-night-closure",
    "At Night closure, can Studio use the Emergency pickup arrangement? Check the signed plan and any cancellation for that specific arrangement. Hold if it was withdrawn even if an older plan survives in the same snapshot.",
    [
      revision(
        "Night closure",
        "Night route cancellation",
        doc("studio/pickup.md", "approved", "Emergency pickup: Back entrance"),
        doc(
          "studio/pickup-withdrawal.md",
          "withdrawal",
          "Emergency pickup: Withdrawn pending repairs",
        ),
      ),
    ],
    [
      withdrawn(
        "Night closure",
        "studio/pickup-withdrawal.md",
        "Emergency pickup: Withdrawn pending repairs",
        "studio/pickup.md",
      ),
    ],
    "unresolved",
    "hold",
  ),
  world(
    "gardening-tool-reopening",
    "Can the tool library reopen for the Lending window at Reopening sign-off? Compare that window with Suspension mark. Reopen if the later record independently authorizes a window despite a withdrawal at the earlier mark.",
    [
      revision(
        "Suspension mark",
        "Loan operations paused",
        doc("lending/hours.md", "approved", "Lending window: Saturdays"),
        doc(
          "lending/hours-withdrawal.md",
          "withdrawal",
          "Lending window: Withdrawn pending inventory",
        ),
      ),
      revision(
        "Reopening sign-off",
        "Inventory approved",
        doc(
          "lending/hours.md",
          "approved",
          "Lending window: Tuesdays and Thursdays",
        ),
      ),
    ],
    [
      withdrawn(
        "Suspension mark",
        "lending/hours-withdrawal.md",
        "Lending window: Withdrawn pending inventory",
        "lending/hours.md",
      ),
      verified(
        "Reopening sign-off",
        "lending/hours.md",
        "Lending window: Tuesdays and Thursdays",
      ),
    ],
    "unresolved",
    "clear",
  ),
  world(
    "archivist-image-permissions",
    "The photo shelf cannot be offered to visitors unless the Visitor permission is approved at Digitization sign-off. Verify whether the Visitor permission is present in that snapshot even if the file was moved to a new directory.",
    [
      revision(
        "Digitization trial",
        "Permission recorded under old folder",
        doc(
          "photo/permission.md",
          "approved",
          "Visitor permission: On-site only",
        ),
      ),
      revision(
        "Digitization sign-off",
        "Adopted revised handling instructions",
        doc(
          "access/visitor-permission.md",
          "approved",
          "Visitor permission: Accredited researchers",
        ),
        doc("photo/shelf-map.md", "appendix", "Shelf: 2E"),
      ),
    ],
    [
      verified(
        "Digitization sign-off",
        "access/visitor-permission.md",
        "Visitor permission: Accredited researchers",
      ),
    ],
    "single",
    "clear",
  ),
  world(
    "auditor-humidity-adjustment",
    "Find what Humidity ceiling was approved at Sensor check and Audit acceptance. The final checklist can proceed only if Audit acceptance has one verified value and it differs from the earlier ceiling.",
    [
      revision(
        "Sensor check",
        "Calibration completed",
        doc(
          "environment/humidity.md",
          "approved",
          "Humidity ceiling: 65 percent",
        ),
      ),
      revision(
        "Audit acceptance",
        "New maintenance treatment confirmed",
        doc(
          "environment/humidity.md",
          "approved",
          "Relative floor: 45 percent",
          "Humidity ceiling: 58 percent",
        ),
        doc(
          "environment/humidity-draft.md",
          "draft",
          "Humidity ceiling: 60 percent",
        ),
      ),
    ],
    [
      verified(
        "Sensor check",
        "environment/humidity.md",
        "Humidity ceiling: 65 percent",
      ),
      verified(
        "Audit acceptance",
        "environment/humidity.md",
        "Humidity ceiling: 58 percent",
        ["environment/humidity.md", "environment/humidity-draft.md"],
        3,
      ),
    ],
    "changed",
    "clear",
  ),
  world(
    "street-market-drain-plan",
    "Determine whether Market extension provides a formally confirmed Rain drain. Set-up must hold if the previous rain-drain file was retired and the extension only has unofficial notes.",
    [
      revision(
        "First market permit",
        "Original drainage instructions",
        doc("market/rain-drain.md", "approved", "Rain drain: West car park"),
      ),
      revision(
        "Market extension",
        "Simplified access map",
        doc("market/rain-drain-ideas.md", "draft", "Rain drain: South stair"),
        doc("market/map.md", "appendix", "Badge table: Path B"),
      ),
    ],
    [missing("Market extension", "market/rain-drain-ideas.md")],
    "unresolved",
    "hold",
  ),
  world(
    "relay-start-time",
    "Decide whether the race leaflets stand. Compare Start time at Relay announcement and Timing correction. Approve the existing leaflets only if the final time remains 08:00.",
    [
      revision(
        "Relay announcement",
        "Printed event instructions recorded",
        doc("race/start-time.md", "approved", "Start time: 08:00"),
      ),
      unindexed(
        revision(
          "Timing correction",
          "Reconcile entry list",
          doc(
            "race/start-time.md",
            "approved",
            "Registration opens: 07:45",
            "Start time: 08:00",
          ),
        ),
      ),
      revision(
        "First briefing",
        "Practice safety notes",
        doc("race/start-time-appendix.md", "appendix", "Start time: 08:30"),
      ),
    ],
    [
      verified("Relay announcement", "race/start-time.md", "Start time: 08:00"),
      verified(
        "Timing correction",
        "race/start-time.md",
        "Start time: 08:00",
        ["race/start-time.md"],
        3,
      ),
    ],
    "same",
    "clear",
  ),
  world(
    "fablab-conflicted-baseline",
    "Can the supervision notice claim the Fume check lead changed between Workshop draft review and Annual inspection? Preserve each piece of signed evidence and hold the change claim if the earlier record conflicts.",
    [
      revision(
        "Workshop draft review",
        "Inspection roles under discussion",
        doc("air/fume-lead.md", "approved", "Fume check lead: Shift mentor"),
        doc(
          "air/fume-lead-countersign.md",
          "approved",
          "Fume check lead: Safety driver",
        ),
      ),
      revision(
        "Annual inspection",
        "Final team scope signed",
        doc(
          "air/fume-lead.md",
          "approved",
          "Fume check lead: Studio coordinator",
        ),
      ),
    ],
    [
      conflict(
        "Workshop draft review",
        cite("air/fume-lead.md", "Fume check lead: Shift mentor"),
        cite("air/fume-lead-countersign.md", "Fume check lead: Safety driver"),
      ),
      verified(
        "Annual inspection",
        "air/fume-lead.md",
        "Fume check lead: Studio coordinator",
      ),
    ],
    "unresolved",
    "hold",
  ),
  world(
    "night-lighting-threshold",
    "Check the Lamp count at Original procession, Spring approval and Revised run. We can reuse the original rig only if all three counts match. A harmless change to headings or notes is fine.",
    [
      revision(
        "Original procession",
        "Original lighting run signed",
        doc("lighting/count.md", "approved", "Lamp count: 12"),
      ),
      revision(
        "Spring approval",
        "Safety note added",
        doc(
          "lighting/count.md",
          "approved",
          "Do not move crates",
          "Lamp count: 12",
        ),
      ),
      revision(
        "Revised run",
        "Venue dimension changed",
        doc("lighting/count.md", "approved", "Lamp count: 9"),
      ),
    ],
    [
      verified("Original procession", "lighting/count.md", "Lamp count: 12"),
      verified(
        "Spring approval",
        "lighting/count.md",
        "Lamp count: 12",
        ["lighting/count.md"],
        3,
      ),
      verified("Revised run", "lighting/count.md", "Lamp count: 9"),
    ],
    "changed",
    "hold",
  ),
  world(
    "mailroom-cart-inventory",
    "Choose whether to stage the cart from the Capacity approval decision. The light cart is acceptable only if Carry limit is 20 kg or less. Check the approved source even if an appendix reports a measurement from older equipment.",
    [
      revision(
        "Capacity approval",
        "Cart model accepted",
        doc("carts/capacity.md", "approved", "Carry limit: 25 kg"),
        doc("carts/capacity-appendix.md", "appendix", "Carry limit: 18 kg"),
      ),
    ],
    [
      verified("Capacity approval", "carts/capacity.md", "Carry limit: 25 kg", [
        "carts/capacity.md",
        "carts/capacity-appendix.md",
      ]),
    ],
    "single",
    "hold",
  ),
  world(
    "scout-campsite-route",
    "Before publishing the printed campsite map, compare Arrival route at Walk-through and Ranger clearance. Publish the existing map only if both have an authorized route and the route stayed the same.",
    [
      unindexed(
        revision(
          "Walk-through",
          "Walk before permits",
          doc("site/arrival-route.md", "approved", "Arrival route: Track C"),
        ),
      ),
      revision(
        "Ranger clearance",
        "Final trail plan adopted",
        doc("site/arrival-route.md", "approved", "Arrival route: Track C"),
        doc("site/arrival-route-draft.md", "draft", "Arrival route: Track D"),
      ),
    ],
    [
      verified(
        "Walk-through",
        "site/arrival-route.md",
        "Arrival route: Track C",
      ),
      verified(
        "Ranger clearance",
        "site/arrival-route.md",
        "Arrival route: Track C",
        ["site/arrival-route.md", "site/arrival-route-draft.md"],
      ),
    ],
    "same",
    "clear",
  ),
  world(
    "textile-dye-storage",
    "Confirm the Storage cabinet at Dye revised approval. The setup may proceed only if that milestone licenses the North cabinet. Check whether the archived former approval changes that instruction.",
    [
      revision(
        "Dye first approval",
        "Workroom opened",
        doc("dye/storage.md", "approved", "Storage cabinet: South"),
      ),
      revision(
        "Dye revised approval",
        "Room assignments updated",
        doc("dye/storage.md", "approved", "Storage cabinet: North"),
        doc("dye/storage-former.md", "appendix", "Storage cabinet: South"),
      ),
    ],
    [
      verified(
        "Dye revised approval",
        "dye/storage.md",
        "Storage cabinet: North",
        ["dye/storage.md", "dye/storage-former.md"],
      ),
    ],
    "single",
    "clear",
  ),
  world(
    "volunteer-check-in-window",
    "Use First desk sign-off and Closed-door amendment to see whether Check-in window changed. If the amendment withdrew it, keep the original citation for shift notes but hold any claim of a new effective window.",
    [
      revision(
        "First desk sign-off",
        "Initial welcome process",
        doc("desk/check-in.md", "approved", "Check-in window: 09:30 to 12:00"),
      ),
      unindexed(
        revision(
          "Closed-door amendment",
          "Entrance resurfaced",
          doc(
            "desk/check-in.md",
            "approved",
            "Check-in window: 10:00 to 13:00",
          ),
          doc(
            "desk/check-in-withdrawal.md",
            "withdrawal",
            "Check-in window: Withdrawn while entrance is closed",
          ),
        ),
      ),
    ],
    [
      verified(
        "First desk sign-off",
        "desk/check-in.md",
        "Check-in window: 09:30 to 12:00",
      ),
      withdrawn(
        "Closed-door amendment",
        "desk/check-in-withdrawal.md",
        "Check-in window: Withdrawn while entrance is closed",
        "desk/check-in.md",
      ),
    ],
    "unresolved",
    "hold",
  ),
  world(
    "theater-quiet-hours",
    "Check Backstage quiet window at Rehearsal protocol and Opening-night protocol. The rehearsal signage can be reused if both values are the same even if the maintenance notes changed.",
    [
      revision(
        "Rehearsal protocol",
        "First rehearsals set",
        doc(
          "stage/quiet-hours.md",
          "approved",
          "Backstage quiet window: After 19:30",
        ),
        doc("stage/maintenance.md", "appendix", "Service door: North"),
      ),
      revision(
        "Opening-night protocol",
        "Crowd barriers installed",
        doc(
          "stage/quiet-hours.md",
          "approved",
          "Crew: four",
          "Backstage quiet window: After 19:30",
        ),
        doc("stage/maintenance.md", "appendix", "Service door: East"),
      ),
    ],
    [
      verified(
        "Rehearsal protocol",
        "stage/quiet-hours.md",
        "Backstage quiet window: After 19:30",
      ),
      verified(
        "Opening-night protocol",
        "stage/quiet-hours.md",
        "Backstage quiet window: After 19:30",
        ["stage/quiet-hours.md"],
        3,
      ),
    ],
    "same",
    "clear",
  ),
  world(
    "held-kiln-shelf-approval",
    "The ceramics workshop needs to know if the cart may be assigned to the Cooling shelf recorded at Firing close. Assign it only if a current authorized shelf remains available. Check for a withdrawal.",
    [
      revision(
        "Firing plan",
        "Initial workshop routing",
        doc("kiln/cooling-shelf.md", "approved", "Cooling shelf: Rack 4"),
      ),
      unindexed(
        revision(
          "Firing close",
          "Workshop register closed",
          doc("kiln/cooling-shelf.md", "approved", "Cooling shelf: Rack 4"),
          doc(
            "kiln/cooling-shelf-withdrawal.md",
            "withdrawal",
            "Cooling shelf: Withdrawn after inspection",
          ),
        ),
      ),
    ],
    [
      withdrawn(
        "Firing close",
        "kiln/cooling-shelf-withdrawal.md",
        "Cooling shelf: Withdrawn after inspection",
        "kiln/cooling-shelf.md",
      ),
    ],
    "unresolved",
    "hold",
    "test",
  ),
  world(
    "held-river-cleanup-zone",
    "Pick whether the spring disposal map can be reused. Look up Disposal zone at River pilot, Estuary diversion and River restoration. Reuse only if the final approved zone returned to the pilot zone, even if the diversion had a different zone.",
    [
      revision(
        "River pilot",
        "First trip itinerary",
        doc("cleanup/disposal.md", "approved", "Disposal zone: Lot H"),
      ),
      revision(
        "Estuary diversion",
        "Old route flooded",
        doc("cleanup/disposal.md", "approved", "Disposal zone: Wharf A"),
      ),
      unindexed(
        revision(
          "River restoration",
          "Repairs signed",
          doc("cleanup/disposal.md", "approved", "Disposal zone: Lot H"),
        ),
      ),
    ],
    [
      verified("River pilot", "cleanup/disposal.md", "Disposal zone: Lot H"),
      verified(
        "Estuary diversion",
        "cleanup/disposal.md",
        "Disposal zone: Wharf A",
      ),
      verified(
        "River restoration",
        "cleanup/disposal.md",
        "Disposal zone: Lot H",
      ),
    ],
    "changed",
    "clear",
    "test",
  ),
  world(
    "held-sewing-room-setup",
    "The sewing room needs one approved Machine bay at Safety review to stage equipment. If the countersignatures disagree, report both and hold. The booking appendix doesn't authorize a bay.",
    [
      revision(
        "Safety review",
        "Two reviews retained",
        doc("sewing/machine-bay.md", "approved", "Machine bay: Bay A"),
        doc(
          "sewing/machine-bay-countersign.md",
          "approved",
          "Machine bay: Bay D",
        ),
        doc("sewing/machine-bay-appendix.md", "appendix", "Machine bay: Bay C"),
      ),
    ],
    [
      conflict(
        "Safety review",
        cite("sewing/machine-bay.md", "Machine bay: Bay A"),
        cite("sewing/machine-bay-countersign.md", "Machine bay: Bay D"),
      ),
    ],
    "unresolved",
    "hold",
    "test",
  ),
  world(
    "held-archive-retrieval-contact",
    "Can the archive retrieval card be forwarded after Roster correction? Compare the Approved contact at Visitor launch and Roster correction. Clear the same card only if both authorize the same contact. Keep the old source if the newer field is blank.",
    [
      revision(
        "Visitor launch",
        "Initial retrieval service opened",
        doc("archive/contact.md", "approved", "Approved contact: Access team"),
      ),
      revision(
        "Roster correction",
        "Billing staff updated",
        doc(
          "archive/contact.md",
          "approved",
          "Approved contact:",
          "Billing contact: Access team",
        ),
        doc(
          "archive/contact-draft.md",
          "draft",
          "Approved contact: Visitor desk",
        ),
      ),
    ],
    [
      verified(
        "Visitor launch",
        "archive/contact.md",
        "Approved contact: Access team",
      ),
      missing(
        "Roster correction",
        "archive/contact.md",
        "archive/contact-draft.md",
      ),
    ],
    "unresolved",
    "hold",
    "test",
  ),
] as const;
