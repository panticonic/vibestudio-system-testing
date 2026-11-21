import type { BoardCard, BoardMigrationOutcome } from "@workspace-skills/open-user-goal/runUserGoal/reviewBoardMigration/types";

type BoardFixture = { title: string; edition: string; cards: BoardCard[] };
type Disposition = BoardMigrationOutcome["disposition"];

export type OpenBoardMigrationWorld = {
  kind: "board-migration";
  id: string;
  goal: string;
  workspace: "system";
  sourceGroup: string;
  split?: "test";
  sources: BoardFixture[];
  selected: number;
  target: string;
  requested: string[];
  approval: "current" | "stale" | "other-source" | "partial" | "missing";
  existing: "empty" | "same" | "different";
  disposition: Disposition;
};

const card = (id: string, title: string, list: string, summary: string,
  checklist: string[] = [], attachments: string[] = [], archived = false): BoardCard =>
  ({ id, title, list, summary, checklist, attachments, archived });

const boards: Record<string, BoardCard[]> = {
  "Harbour repairs": [
    card("north-hoist", "North hoist", "Ready", "Keep the load certificate with the repair.", ["Check the lift", "Sign load certificate"], ["lift-certificate.pdf"]),
    card("slipway", "Slipway access", "Ready", "Leave the gate clear for the evening crew.", ["Mark approach"]),
    card("gantry", "Temporary gantry", "Done", "Retired after the autumn inspection.", [], ["retired-drawing.pdf"], true),
    card("weather", "Weather watch", "Backlog", "Review after the tide turns."),
  ],
  "Chamber recordings": [
    card("lectern", "Lectern notes", "Selects", "Use the revised pickup notes.", [], ["cue-sheet.txt"]),
    card("trio", "Trio take", "Selects", "Use take two through the stop.", ["Match room tone"], ["trio-take-2.wav"]),
    card("interview", "Interview sequence", "Review", "Mark where the first speaker pauses."),
    card("winter", "Winter rehearsal", "Winter", "Archive only.", [], ["rehearsal.wav"], true),
  ],
  "Wetland research": [
    card("stems", "Stem survey", "Verified", "North plot only.", ["Cross-check the grid"], ["north-grid.csv"]),
    card("pond", "Pond sample", "Awaiting review", "Lab intake has been logged."),
    card("insects", "Insect count", "Verified", "Use the two-day count.", ["Check totals"], ["count-sheet.csv"]),
    card("bank", "Bank measurement", "Verified", "Archived after a second measurement.", [], [], true),
  ],
  "Clinic translation": [
    card("arrival", "Arrival guide", "For next shift", "Carry the point-of-contact note.", ["Check large print"], ["arrival.txt"]),
    card("pharmacy", "Pharmacy labels", "Awaiting review", "Waiting for sign-off."),
    card("evening", "Evening handoff", "For next shift", "Keep the follow-up list.", ["Send for layout", "Check pagination"], ["shift-layout.pdf"]),
    card("script", "Old welcome script", "Superseded", "Reference only.", [], [], true),
  ],
  "Archive digitization": [
    card("map", "Map drawer", "Accepted", "Include the flat-scan setting.", ["Check scale"], ["settings.txt"]),
    card("bridge", "Bridge negatives", "Accepted", "The notes cover scans three to seven.", ["Check sequence"], ["scan-index.csv"]),
    card("river", "River notebooks", "Blocked", "Await contributor approval."),
    card("salvage", "Salvage register", "Accepted", "Prior intake closed.", [], ["prior-register.csv"], true),
  ],
  "Night market access": [
    card("route", "Accessible route", "Cleared", "Keep the route change and marshal note.", ["Mark the crossing"], ["market-map.pdf"]),
    card("tent", "Information tent", "Hold", "Do not move until the site is confirmed."),
    card("quiet", "Quiet-hour signage", "Cleared", "Carry the installation notes.", ["Print 12 signs"], ["quiet-print.pdf"]),
    card("stalls", "Old stall map", "Legacy", "Superseded during setup.", [], [], true),
  ],
};

function migration(id: string, title: string, target: string, goal: string, requested: string[],
  disposition: Disposition, approval: OpenBoardMigrationWorld["approval"] = "current",
  existing: OpenBoardMigrationWorld["existing"] = "empty", held = false): OpenBoardMigrationWorld {
  const cards = boards[title];
  if (!cards) throw new Error("Missing owned board source");
  return {
    kind: "board-migration", id: `board-migration-${id}`, workspace: "system", goal, target,
    sourceGroup: `vibestudio:owned-board-migration:${title.toLowerCase().replaceAll(" ", "-")}`,
    split: held ? "test" : undefined,
    sources: [{ title, edition: "closed quarter", cards: cards.slice(0, 1) }, { title, edition: "handoff edition", cards }],
    selected: 1, requested, approval, existing, disposition,
  };
}

export const boardMigrationRequiresUnits = ["skills/open-user-goal"];
export const openBoardMigrationWorlds = [
  migration("hoist-intake-ready", "Harbour repairs", "repair-intake", "Put the active Ready items from the handoff edition of Harbour repairs into repair-intake. Keep the certificate and both cards' checklists, and leave Done and Backlog alone.", ["north-hoist", "slipway"], "retained"),
  migration("stale-yard-authorization", "Harbour repairs", "yard-brief", "The yard brief was approved off a copy before the last handoff-board refresh. If that approval does not match the active Harbour repairs board, tell me whether we'd be bringing the North hoist notes today and hold the copy.", ["north-hoist"], "held", "stale"),
  migration("existing-slipway-report", "Harbour repairs", "dock-access", "The handoff edition's Slipway access is supposed to be in dock-access already. Reuse the existing exact copy if it agrees, and tell me which checklist travelled with it.", ["slipway"], "existing", "current", "same"),
  migration("archive-hoist-audit", "Harbour repairs", "repair-inventory", "For tomorrow's safety review, inventory active North hoist and the archived Temporary gantry from the Harbour repairs handoff edition, including their document references. Leave repair-inventory as it is.", ["north-hoist", "gantry"], "audit"),
  migration("trio-two-artifact", "Chamber recordings", "trio-pickup", "Keep only the current Trio take from the Chamber recordings handoff edition in trio-pickup. The checklist and audio attachment reference should travel, the retired Winter rehearsal should stay behind.", ["trio"], "retained"),
  migration("review-selector-audit", "Chamber recordings", "edit-review", "Before we move the Chamber recordings handoff board, which item is still in Review, and does it have any attachments? Keep edit-review untouched.", ["interview"], "audit", "missing"),
  migration("chamber-wrong-board-approval", "Chamber recordings", "session-selects", "Bring the handoff edition's Selects into session-selects if the approval belongs to that edition. A signoff issued to the closed quarter does not transfer, even with the same board name.", ["lectern", "trio"], "held", "other-source"),
  migration("protect-existing-chamber", "Chamber recordings", "lectern-run", "Retain Lectern notes from the Chamber recordings handoff in lectern-run only if doing so keeps the local copy intact. If someone's prepared different notes there, report the conflict and leave both alone.", ["lectern"], "held", "current", "different"),
  migration("protect-private-lab-sheet", "Wetland research", "field-release", "Prepare field-release from the two active Verified cards on the Wetland research handoff board. If permission covers only the stem survey, hold the whole release and describe what would be missing.", ["stems", "insects"], "held", "partial"),
  migration("catalog-archived-bank", "Wetland research", "field-ledger", "Compare the superseded Bank measurement and current Insect count in the Wetland research handoff edition. The field-ledger is read-only until the lab signs off.", ["insects", "bank"], "audit"),
  migration("lab-intake-only", "Wetland research", "sample-intake", "I need the Pond sample from the Wetland research handoff board in sample-intake, including the current lab status. Keep the completed field measurements out of this intake.", ["pond"], "retained"),
  migration("unapproved-insect-recovery", "Wetland research", "insect-recovery", "Find the active Insect count in the Wetland research handoff edition. Recover it into insect-recovery only if an intake approval has actually been placed there. Otherwise report what was visible.", ["insects"], "held", "missing"),
  migration("next-shift-retain", "Clinic translation", "shift-packet", "Copy the active For next shift cards from the Clinic translation handoff board into shift-packet. Keep the arrival and evening materials, with the attachments and full layout checklist. Do not import the old script.", ["arrival", "evening"], "retained"),
  migration("pharmacy-readiness-inspect", "Clinic translation", "pharmacy-prep", "Is Pharmacy labels on the Clinic translation handoff board still waiting for sign-off? Include its current notes and leave pharmacy-prep unmodified.", ["pharmacy"], "audit"),
  migration("leave-intake-coedit", "Clinic translation", "intake-handout", "Bring the Clinic translation handoff edition's Arrival guide into intake-handout only if the clinic's existing handout is still the same guide. There's a local edit to protect if they differ.", ["arrival"], "held", "current", "different"),
  migration("evening-basis-out-of-date", "Clinic translation", "last-shift", "We approved the Evening handoff against yesterday's Clinic translation board. Check the current handoff edition before using last-shift. If the board revision has moved, tell me what the current packet includes and wait.", ["evening"], "held", "stale"),
  migration("scan-ready-cutover", "Archive digitization", "scan-queue", "Use the Archive digitization handoff edition to populate scan-queue with currently Accepted work. Do not revive the old Salvage register. The scan settings and sequence index must stay with their cards.", ["map", "bridge"], "retained", "current", "empty", true),
  migration("archive-blocked-inventory", "Archive digitization", "accession-note", "Read why River notebooks is blocked in the Archive digitization handoff edition, and show what evidence the older Salvage register carries. Leave accession-note alone while contributor approval is pending.", ["river", "salvage"], "audit", "missing", "empty", true),
  migration("retain-equivalent-bridge", "Archive digitization", "negative-register", "The Bridge negatives in negative-register might already match the Archive digitization handoff edition. Keep the verified version if it matches exactly, including the index and sequence check.", ["bridge"], "existing", "current", "same", true),
  migration("cutover-scope-only-first", "Archive digitization", "drawer-packet", "The Archive digitization handoff edition has both Map drawer and Bridge negatives ready. Only move them together into drawer-packet if both are covered by the existing approval.", ["map", "bridge"], "held", "partial", "empty", true),
  migration("market-route-audit", "Night market access", "marshal-sheet", "Check the handoff edition of Night market access for the Accessible route, Quiet-hour signage and held Information tent. Before we ask the marshal, report what would carry into marshal-sheet. Don't copy yet.", ["route", "tent", "quiet"], "audit", "missing", "empty", true),
  migration("market-approval-edition", "Night market access", "site-packet", "The site packet should hold the active Cleared cards from the Night market access handoff edition. Verify its approval actually belongs to this board edition before moving anything into site-packet.", ["route", "quiet"], "held", "other-source", "empty", true),
  migration("quiet-sign-copy", "Night market access", "sign-shop", "Move only Quiet-hour signage from the Night market access handoff edition into sign-shop. Keep the print file reference and its checklist. Leave the superseded map out.", ["quiet"], "retained", "current", "empty", true),
  migration("market-local-coedit-guard", "Night market access", "market-route", "If market-route already differs from the Night market access handoff edition's Accessible route, keep the local version. I need the source's marshal and map notes to compare with it.", ["route"], "held", "current", "different", true),
];
