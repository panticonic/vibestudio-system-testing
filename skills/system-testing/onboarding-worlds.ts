type Intent = "welcome" | "refresh" | "selection" | "workspace-creation";
export type SetupRoute = {
  capabilityId: string;
  action: string;
  via:
    | "owner-skill"
    | "about-page"
    | "model-settings"
    | "panel"
    | "shell-navigation"
    | "conversation";
  destination: string | null;
};
export type SetupWorld = {
  id: string;
  goal: string;
  intent: Intent;
  ids: string[];
  interaction: {
    source: string;
    kind: string;
    targetId: string;
    action: string;
  } | null;
  expected: {
    status:
      | "overview"
      | "refresh-overview"
      | "route-owner"
      | "route-client"
      | "invalid-selection"
      | "separate-workspace";
    route: SetupRoute | null;
    absent?: string[];
  };
};

const connection = "connection.ai-provider";
const github = "connection.github";
const browser = "migration.browser-environment";
const device = "connection.device";
const remote = "connection.remote-server";
const local = "configuration.local-models";
const updates = "configuration.workspace-updates";
const schedules = "capability.automations";

function selection(
  id: string,
  goal: string,
  capabilityId: string,
  action: string,
  via: SetupRoute["via"],
  destination: string | null = null,
): SetupWorld {
  return {
    id,
    goal,
    intent: "selection",
    ids: [capabilityId, connection].filter(
      (value, index, all) => all.indexOf(value) === index,
    ),
    interaction: {
      source: "onboarding-setup-hub",
      kind: "onboarding-capability",
      targetId: capabilityId,
      action,
    },
    expected: {
      status:
        via === "owner-skill" ||
        via === "model-settings" ||
        via === "conversation"
          ? "route-owner"
          : "route-client",
      route: { capabilityId, action, via, destination },
      ...(capabilityId === schedules ? { absent: [schedules] } : {}),
    },
  };
}

export const managedSetupWorlds: SetupWorld[] = [
  {
    id: "welcome-live-state",
    goal: "Open the onboarding overview using current owner readbacks. Device and remote state may be unknown.",
    intent: "welcome",
    ids: [connection, github, device, remote, updates],
    interaction: null,
    expected: { status: "overview", route: null },
  },
  {
    id: "refresh-optional-owners",
    goal: "Refresh the model and optional update assistant rows using their owners' current state.",
    intent: "refresh",
    ids: [connection, local, updates],
    interaction: null,
    expected: { status: "refresh-overview", route: null },
  },
  selection(
    "model-settings",
    "Follow the AI model setup selection to its owner without opening a credential prompt.",
    connection,
    "setup",
    "model-settings",
  ),
  selection(
    "github-reconnect",
    "Keep the assigned GitHub reconnect action with the integration's own skill.",
    github,
    "reconnect",
    "owner-skill",
    "skills/github/SKILL.md",
  ),
  selection(
    "personal-credentials",
    "Resolve the GitHub credential inspection action to its canonical About page.",
    github,
    "inspect",
    "about-page",
    "about/credentials",
  ),
  selection(
    "browser-import-panel",
    "Hand off the user's resume selection to the installed browser import panel.",
    browser,
    "resume",
    "panel",
    "about/browser-import-inspector",
  ),
  selection(
    "local-model-about",
    "Route local inference configuration to its canonical About destination.",
    local,
    "change",
    "about-page",
    "about/local-models",
  ),
  selection(
    "device-settings",
    "Resolve the device setup selection while preserving its observed state.",
    device,
    "setup",
    "shell-navigation",
    "settings/devices",
  ),
  selection(
    "remote-settings",
    "Route a server change to the client's connection settings.",
    remote,
    "change",
    "shell-navigation",
    "settings/connection",
  ),
  selection(
    "recurring-work",
    "Continue scheduling as a conversational action for a ready-on-demand capability.",
    schedules,
    "explore",
    "conversation",
  ),
  {
    id: "separate-workspace",
    goal: "Prepare the shell-owned workspace chooser while keeping the current workspace and conversation.",
    intent: "workspace-creation",
    ids: [updates],
    interaction: null,
    expected: { status: "separate-workspace", route: null },
  },
  {
    id: "retired-selection",
    goal: "Handle a selection from an old setup card whose capability no longer exists.",
    intent: "selection",
    ids: ["legacy.retired-setup", connection],
    interaction: {
      source: "onboarding-setup-hub",
      kind: "onboarding-capability",
      targetId: "legacy.retired-setup",
      action: "setup",
    },
    expected: {
      status: "invalid-selection",
      route: null,
      absent: ["legacy.retired-setup"],
    },
  },
  {
    id: "wrong-action",
    goal: "Hold an unsupported action on the device card instead of guessing a settings destination.",
    intent: "selection",
    ids: [device],
    interaction: {
      source: "onboarding-setup-hub",
      kind: "onboarding-capability",
      targetId: device,
      action: "reconnect",
    },
    expected: { status: "invalid-selection", route: null },
  },
];
