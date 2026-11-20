import { addedSpectroliteGoalWorlds } from "./open-goal-spectrolite-expansion-worlds.js";

export const openSpectrolitePanel = "panels/spectrolite";
export const openSpectroliteVault = "projects/default";

type VaultCheck = "document" | "preview" | "navigation" | "revision";
type VaultFinding = [VaultCheck, string];

export type OpenSpectroliteWorld = {
  kind: "spectrolite";
  workspace: "spectrolite";
  id: string;
  goal: string;
  sourceGroup: string;
  split?: "test";
  openPath: string;
  files: Record<string, string>;
  draft?: Record<string, string>;
  writablePath?: string;
  expected: {
    route: { from: string; target: string; to: string }[];
    path: string;
    findings: VaultFinding[];
    visible?: string;
    editedSource?: string;
  };
};

const note = (title: string, body: string) => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`;
const callout = (text: string) => `<Callout color="blue"><Callout.Text>${text}</Callout.Text></Callout>`;

export const spectroliteGoalWorlds: readonly OpenSpectroliteWorld[] = [
  {
    kind: "spectrolite", workspace: "spectrolite", id: "trace-coastal-shift-notice",
    goal: "I'm at the coastal shift index. Follow the duty chain to the scheduled handover and check whether its radio instruction actually renders as a callout. Report the path you used. This is a review only.",
    sourceGroup: "vibestudio:spectrolite:coastal-duty-route",
    openPath: "Coastal Shift.mdx",
    files: {
      "Coastal Shift.mdx": note("Coastal shift", "Check the weather in [[Forecast Log]] or start the handover route at [[Duty Roster]]."),
      "ops/Duty Roster.mdx": note("Duty roster", "Today's scheduled handover lives in [[Scheduled Handover]]."),
      "ops/Scheduled Handover.mdx": note("Scheduled handover", callout("Switch to channel seven after roll call.")),
      "Forecast Log.mdx": note("Forecast log", "Offline reference only."),
    },
    expected: {
      route: [
        { from: "Coastal Shift.mdx", target: "Duty Roster", to: "ops/Duty Roster.mdx" },
        { from: "ops/Duty Roster.mdx", target: "Scheduled Handover", to: "ops/Scheduled Handover.mdx" },
      ],
      path: "ops/Scheduled Handover.mdx", findings: [["document", "document-ready"], ["navigation", "navigation-ready"], ["preview", "preview-ready"]],
      visible: "Switch to channel seven after roll call.",
    },
  },
  {
    kind: "spectrolite", workspace: "spectrolite", id: "check-catalog-link-before-print",
    goal: "Before we print the catalog, check whether the withdrawal notice really points to an existing collections record. Flag the link if it has no destination, and leave the vault alone.",
    sourceGroup: "vibestudio:spectrolite:collections-withdrawal-links",
    openPath: "Catalog Withdrawal.mdx",
    files: {
      "Catalog Withdrawal.mdx": note("Catalog withdrawal", "The supporting file is [[Withdrawn Collections Ruling]]. The donor contact is [[Donor Desk]]."),
      "Donor Desk.mdx": note("Donor desk", "For contact changes only."),
    },
    expected: { route: [], path: "Catalog Withdrawal.mdx", findings: [["document", "broken-link"]] },
  },
  {
    kind: "spectrolite", workspace: "spectrolite", id: "compare-maintenance-draft-to-committed-plan",
    goal: "The maintenance schedule might have moved in the local draft. Find it through the control room's index and confirm whether the working document differs from the committed copy. Keep both copies as they are.",
    sourceGroup: "vibestudio:spectrolite:maintenance-draft-provenance",
    openPath: "Control Room.mdx",
    files: {
      "Control Room.mdx": note("Control room", "Review [[Maintenance Window]] before changing the alarm list in [[Alarm List]]."),
      "service/Maintenance Window.mdx": note("Maintenance window", "Window: Saturday morning."),
      "service/Alarm List.mdx": note("Alarm list", "Routine check only."),
    },
    draft: { "service/Maintenance Window.mdx": note("Maintenance window", "Window: Sunday evening.") },
    expected: {
      route: [{ from: "Control Room.mdx", target: "Maintenance Window", to: "service/Maintenance Window.mdx" }],
      path: "service/Maintenance Window.mdx",
      findings: [["document", "document-ready"], ["navigation", "navigation-ready"], ["revision", "draft-changed"]],
      visible: "Window: Sunday evening.",
    },
  },
  {
    kind: "spectrolite", workspace: "spectrolite", id: "update-gate-draft-from-signed-order",
    goal: "The signed order is open. Follow its link to the public gate draft and correct the closing line from the approved wording. Keep the badge and other copy and leave the change as a working draft. Show that the editor now sees it.",
    sourceGroup: "vibestudio:spectrolite:gate-notice-revision",
    openPath: "Signed Gate Order.mdx",
    files: {
      "Signed Gate Order.mdx": note("Signed gate order", "Approved closing line: Gate closes at 18:45. \n\nApply it to [[Public Gate Draft]]."),
      "notices/Public Gate Draft.mdx": note("Public gate draft", "Gate closes at 18:00.\n\n" + callout("Carry your staff badge.") + "\n\nLeave the emergency lane clear."),
    },
    writablePath: "notices/Public Gate Draft.mdx",
    expected: {
      route: [{ from: "Signed Gate Order.mdx", target: "Public Gate Draft", to: "notices/Public Gate Draft.mdx" }],
      path: "notices/Public Gate Draft.mdx",
      findings: [["document", "document-ready"], ["navigation", "navigation-ready"], ["revision", "draft-changed"]],
      visible: "Gate closes at 18:45.",
      editedSource: note("Public gate draft", "Gate closes at 18:45.\n\n" + callout("Carry your staff badge.") + "\n\nLeave the emergency lane clear."),
    },
  },
  {
    kind: "spectrolite", workspace: "spectrolite", id: "inspect-archive-intake-preview", split: "test",
    goal: "At the archive index, find the accession note that applies to new material. Tell me whether it presents an inline preview or just plain instructions, and leave both the index and record alone.",
    sourceGroup: "vibestudio:spectrolite:archive-accession-preview",
    openPath: "Archive Index.mdx",
    files: {
      "Archive Index.mdx": note("Archive index", "New material follows [[Accession Intake]]. Closed cartons follow [[Closed Storage]]."),
      "records/Accession Intake.mdx": note("Accession intake", "Number the envelope before registering the accession."),
      "records/Closed Storage.mdx": note("Closed storage", callout("For closed cartons only.")),
    },
    expected: {
      route: [{ from: "Archive Index.mdx", target: "Accession Intake", to: "records/Accession Intake.mdx" }],
      path: "records/Accession Intake.mdx",
      findings: [["document", "document-ready"], ["navigation", "navigation-ready"], ["preview", "preview-missing"]],
    },
  },
  ...addedSpectroliteGoalWorlds,
];
