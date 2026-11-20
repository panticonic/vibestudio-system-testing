import { addedBrowserGoalWorlds } from "./open-goal-browser-expansion-worlds.js";

type Control = { label: string; nextState: string; availableIn?: string[] };
export type BrowserSeedRow = {
  label: string;
  state: string;
  detail: string;
  controls: Control[];
};
export type BrowserGoalWorld = {
  kind: "browser";
  id: string;
  goal: string;
  heading: string;
  sourceGroup: string;
  split?: "test";
  rows: BrowserSeedRow[];
  expected: { labels: string[]; changes?: { label: string; state: string; control?: string }[] };
};

export const browserGoalWorlds: readonly BrowserGoalWorld[] = [
  {
    kind: "browser", id: "route-temperature-flagged-shipment",
    goal: "In the live receiving panel, move the shipment with an unresolved temperature exception to inspection. Leave the other shipments alone and tell me what the panel confirms.",
    heading: "Receiving queue",
    sourceGroup: "vibestudio:browser:warehouse-temperature-review",
    rows: [
      { label: "North pallet", state: "Awaiting intake", detail: "Seal intact; temperature review passed",
        controls: [{ label: "Send to inspection", nextState: "In inspection" }] },
      { label: "Canal pallet", state: "Awaiting intake", detail: "Temperature excursion remains unresolved",
        controls: [{ label: "Release to inventory", nextState: "Released" }, { label: "Send to inspection", nextState: "In inspection" }] },
      { label: "River pallet", state: "In inspection", detail: "Unresolved paperwork", controls: [] },
    ],
    expected: { labels: ["Canal pallet"], changes: [{ label: "Canal pallet", state: "In inspection" }] },
  },
  {
    kind: "browser", id: "find-pending-captions",
    goal: "Look at the live exhibit checklist and tell me which exhibits still need captions, and what detail the checklist gives for each. Leave the checklist as it is.",
    heading: "Exhibit checklist",
    sourceGroup: "vibestudio:browser:museum-accessibility-intake",
    rows: [
      { label: "Glasshouse", state: "Ready", detail: "Captions signed off", controls: [] },
      { label: "Wind room", state: "Caption needed", detail: "The ambient recording needs a caption",
        controls: [{ label: "Mark ready", nextState: "Ready" }] },
      { label: "Harbor footage", state: "Caption needed", detail: "The interview segment needs a caption",
        controls: [{ label: "Mark ready", nextState: "Ready" }] },
      { label: "Model railway", state: "Caption waived", detail: "No recorded audio", controls: [] },
    ],
    expected: { labels: ["Wind room", "Harbor footage"] },
  },
  {
    kind: "browser", id: "release-reviewed-handout",
    goal: "The review board approved exactly one handout for internal circulation. Use the live tracker to release that handout once and verify the tracker reflects the change.",
    heading: "Handout release tracker",
    sourceGroup: "vibestudio:browser:internal-handout-circulation",
    rows: [
      { label: "Visitor map", state: "Awaiting decision", detail: "Earlier draft cleared; current copy still in review",
        controls: [{ label: "Release internally", nextState: "Released internally" }] },
      { label: "Accessibility notes", state: "Approved", detail: "Approved for internal circulation",
        controls: [{ label: "Send back for review", nextState: "Awaiting decision" },
          { label: "Release internally", nextState: "Released internally" }] },
      { label: "Daily schedule", state: "Released internally", detail: "Released earlier today", controls: [] },
    ],
    expected: { labels: ["Accessibility notes"], changes: [{ label: "Accessibility notes", state: "Released internally" }] },
  },
  {
    kind: "browser", id: "sequence-studio-dispatch",
    goal: "Use the live dispatch board to first return the batch missing its compliance check to review, then queue the fully signed batch for delivery. Leave the completed batch as it is and verify both changes.",
    heading: "Studio dispatch board",
    sourceGroup: "vibestudio:browser:studio-dispatch-sequence",
    rows: [
      { label: "Blue folder", state: "Awaiting dispatch", detail: "Dispatch and compliance signed",
        controls: [{ label: "Queue for delivery", nextState: "Queued" }, { label: "Return to review", nextState: "In review" }] },
      { label: "Gold folder", state: "Awaiting dispatch", detail: "Dispatch signed, compliance check outstanding",
        controls: [{ label: "Queue for delivery", nextState: "Queued" }, { label: "Return to review", nextState: "In review" }] },
      { label: "Green folder", state: "Delivered", detail: "Receipt confirmed", controls: [] },
    ],
    expected: { labels: ["Gold folder", "Blue folder"],
      changes: [{ label: "Gold folder", state: "In review" }, { label: "Blue folder", state: "Queued" }] },
  },
  {
    kind: "browser", id: "hold-unconfirmed-shuttle-stop", split: "test",
    goal: "Hold the shuttle stop whose council approval is still pending. Keep the confirmed and already held stops unchanged, and confirm the new status from the dashboard.",
    heading: "Shuttle service dashboard",
    sourceGroup: "vibestudio:browser:municipal-transit-release",
    rows: [
      { label: "Gallery loop", state: "Confirmed", detail: "Final council approval received",
        controls: [{ label: "Put on hold", nextState: "Held" }] },
      { label: "Old station", state: "Scheduled", detail: "Council approval remains pending",
        controls: [{ label: "Put on hold", nextState: "Held" }, { label: "Confirm for service", nextState: "Confirmed" }] },
      { label: "Museum terrace", state: "Held", detail: "Roadworks", controls: [] },
    ],
    expected: { labels: ["Old station"], changes: [{ label: "Old station", state: "Held" }] },
  },
  ...addedBrowserGoalWorlds,
];
