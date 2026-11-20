import type { BrowserGoalWorld } from "./open-goal-browser-worlds.js";

export const addedBrowserGoalWorlds: readonly BrowserGoalWorld[] = [
  {
    kind: "browser", id: "ceramics-assignment-after-safety-check",
    goal: "The clay studio can send the repaired kiln cart back to service only after you mark its safety inspection complete. Do both steps on that single cart, in that order, and tell me where it ended up. Leave the other cart as it is.",
    heading: "Studio equipment queue", sourceGroup: "vibestudio:browser:ceramic-equipment-safety",
    rows: [
      { label: "Kiln cart", state: "Repair confirmed", detail: "New wheel installed; safety check recorded by floor lead",
        controls: [{ label: "Record safety clearance", nextState: "Safety cleared", availableIn: ["Repair confirmed"] },
          { label: "Return to service", nextState: "In service", availableIn: ["Safety cleared"] }] },
      { label: "Glaze cart", state: "Out of service", detail: "The handle still needs replacing",
        controls: [{ label: "Return to service", nextState: "In service" }] },
    ],
    expected: { labels: ["Kiln cart"], changes: [
      { label: "Kiln cart", control: "Record safety clearance", state: "Safety cleared" },
      { label: "Kiln cart", control: "Return to service", state: "In service" },
    ] },
  },
  {
    kind: "browser", id: "reassign-guided-tour-pair-in-order",
    goal: "Move the wheelchair-accessible group to the ground-floor slot. First free that slot by moving the self-guided group back to the waiting list, then assign the group needing the step-free route. Verify the final assignments and leave the tour already running alone.",
    heading: "Guided tour desk", sourceGroup: "vibestudio:browser:accessible-tour-allocation",
    rows: [
      { label: "Group CL", state: "Ground floor", detail: "Self-guided group, flexible room",
        controls: [{ label: "Return to waiting list", nextState: "Waiting list" }] },
      { label: "Group AR", state: "Waiting list", detail: "Requests step-free access for a wheelchair user",
        controls: [{ label: "Assign ground floor", nextState: "Ground floor" }, { label: "Assign mezzanine", nextState: "Mezzanine" }] },
      { label: "Group WB", state: "In progress", detail: "Guide departed with the group", controls: [] },
    ],
    expected: { labels: ["Group CL", "Group AR"], changes: [
      { label: "Group CL", control: "Return to waiting list", state: "Waiting list" },
      { label: "Group AR", control: "Assign ground floor", state: "Ground floor" },
    ] },
  },
  {
    kind: "browser", id: "report-blockers-before-recording-labels",
    goal: "I need to know which recordings cannot be labelled with a final license yet. List their exact blockers from the intake board. Some already-cleared recordings still have a licensing button, so use the current evidence and make no changes.",
    heading: "Audio licensing intake", sourceGroup: "vibestudio:browser:oral-history-license-evidence",
    rows: [
      { label: "Canal Evening", state: "Clear", detail: "Performer and composer signed the same release",
        controls: [{ label: "Change license", nextState: "Reopened" }] },
      { label: "Under the Bridge", state: "Incomplete", detail: "Composer signed; one performer waiver missing", controls: [] },
      { label: "Bell Practice", state: "Disputed", detail: "The transcript and signed waiver name different tracks",
        controls: [{ label: "Mark cleared", nextState: "Clear" }] },
      { label: "Rooftop Sketch", state: "Withdrawn", detail: "Removed from the release list", controls: [] },
    ],
    expected: { labels: ["Under the Bridge", "Bell Practice"] },
  },
  {
    kind: "browser", id: "confirm-microfilm-quarantine-without-export",
    goal: "The repository lead asked us to separate the unreadable microfilm image from the exportable batch. Quarantine the row with the failed density scan and leave the export button untouched. Keep the already quarantined image, the successful scan, and the retry request untouched, and confirm the new quarantine.",
    heading: "Microfilm scan triage", sourceGroup: "vibestudio:browser:microfilm-ingest-quarantine",
    rows: [
      { label: "Reel 16", state: "Scanned", detail: "Density acceptable; focus retry requested by auditor",
        controls: [{ label: "Quarantine scan", nextState: "Quarantined" }, { label: "Request retry", nextState: "Retry queued" }] },
      { label: "Reel 19", state: "Scanned", detail: "Failed density scan; unreadable reference line",
        controls: [{ label: "Export to catalog", nextState: "Exported" }, { label: "Quarantine scan", nextState: "Quarantined" }] },
      { label: "Reel 21", state: "Quarantined", detail: "Earlier splice defect", controls: [] },
      { label: "Reel 22", state: "Ready", detail: "Density and focus passed",
        controls: [{ label: "Export to catalog", nextState: "Exported" }] },
    ],
    expected: { labels: ["Reel 19"], changes: [{ label: "Reel 19", control: "Quarantine scan", state: "Quarantined" }] },
  },
  {
    kind: "browser", id: "hold-duplicate-late-freight-authorizations", split: "test",
    goal: "A supervisor says there is only one after-hours freight permit, but the board may show two authorizations for the same dock window. Identify the overlapping authorizations and report their details. If they overlap, leave dispatch alone.",
    heading: "After-hours freight permits", sourceGroup: "vibestudio:browser:municipal-freight-overlap",
    rows: [
      { label: "Marlin", state: "Authorized", detail: "Dock 4 from 19:00 to 19:30",
        controls: [{ label: "Release freight", nextState: "Released" }] },
      { label: "Vega", state: "Authorized", detail: "Dock 4 from 19:20 to 19:50",
        controls: [{ label: "Release freight", nextState: "Released" }] },
      { label: "Pearl", state: "Requested", detail: "Dock 4 from 19:15 to 19:45; awaiting sign-off",
        controls: [{ label: "Release freight", nextState: "Released" }] },
      { label: "Sable", state: "Authorized", detail: "Dock 5 from 19:15 to 19:45",
        controls: [{ label: "Release freight", nextState: "Released" }] },
    ],
    expected: { labels: ["Marlin", "Vega"] },
  },
  {
    kind: "browser", id: "record-return-before-clearing-shared-tablet", split: "test",
    goal: "At the volunteer lending board, record the returned evening tablet before clearing its loan. The charging lead acknowledged receipt, but keep the missing tablet and already-cleared loan untouched. Tell me what the board confirms.",
    heading: "Equipment lending", sourceGroup: "vibestudio:browser:volunteer-device-return",
    rows: [
      { label: "Tablet kiosk 3", state: "Out", detail: "Returned to charging lead; manager approved closure",
        controls: [{ label: "Clear loan", nextState: "Cleared", availableIn: ["Returned"] },
          { label: "Record returned", nextState: "Returned", availableIn: ["Out"] }] },
      { label: "Tablet kiosk 6", state: "Out", detail: "Reported missing, still assigned to shift",
        controls: [{ label: "Record returned", nextState: "Returned" }] },
      { label: "Tablet kiosk 8", state: "Cleared", detail: "Closed before evening intake", controls: [] },
    ],
    expected: { labels: ["Tablet kiosk 3"], changes: [
      { label: "Tablet kiosk 3", control: "Record returned", state: "Returned" },
      { label: "Tablet kiosk 3", control: "Clear loan", state: "Cleared" },
    ] },
  },
];
