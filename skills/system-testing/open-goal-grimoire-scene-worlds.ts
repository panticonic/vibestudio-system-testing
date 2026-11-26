type Anchor = "sol" | "pip" | "hollow" | "bank" | "meadow" | "proposed";
export type GrimoireSceneWorld = ReturnType<typeof docket>;
type Action =
  | "stage-scene"
  | "stage-note"
  | "keep-current"
  | "hold-foreign"
  | "hold-no-art"
  | "hold-authority"
  | "hold-stale";
type Profile = {
  requestedReturnRequired: boolean;
  requestedArtifact: "scene" | "note" | null;
  advanceBefore?: number;
  advanceDuring?: true;
  source?: "current" | "past" | "other";
  approved?: false;
  proposed?: {
    title: string;
    detail: string;
    at: "hollow" | "bank" | "meadow";
  };
  asset?: string;
  action: Action;
  anchors?: readonly Anchor[];
};
function docket(
  id: string,
  split: "train" | "test",
  name: string,
  goal: string,
  directive: string,
  profile: Profile,
) {
  return {
    id: "grimoire-scene-" + id,
    sourceGroup: "vibestudio:grimoire-scene:" + id,
    kind: "grimoireScene",
    workspace: "examples",
    split,
    name,
    goal,
    directive,
    ...profile,
  } as const;
}

export const openGrimoireSceneWorlds = [
  docket(
    "two-lantern-stops",
    "train",
    "Lantern Loop",
    "I want a private, editable Lantern Loop copy where a reader can inspect Sol and the old hollow independently. Keep the drawing and give each stop a meaningful label.",
    "Caretaker approved a local editable copy of the current scene.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene", action: "stage-scene", anchors: ["sol", "hollow"] },
  ),
  docket(
    "pip-after-dawn",
    "train",
    "Seed Keeper",
    "For Seed Keeper, mark Pip's present position in a private scene copy after the last daylight change. Use Pip's live position, since the older sketch may disagree.",
    "Current private copy approved; direct resident evidence is required.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene", action: "stage-scene", anchors: ["pip"], advanceBefore: 2 },
  ),
  docket(
    "water-and-cover",
    "train",
    "A Path Beside Water",
    "Make the stream bank and the old hollow individually inspectable in A Path Beside Water. I'd like to compare the two places in an editable local view.",
    "The two public habitat anchors may transfer to a private editable candidate.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene", action: "stage-scene", anchors: ["hollow", "bank"] },
  ),
  docket(
    "planned-bridge",
    "train",
    "The Bridge Idea",
    "Keep the existing stream bank visible in The Bridge Idea, and give the proposed footbridge its own separate marker. Leave a private annotated scene for the caretaker and make clear what hasn't happened.",
    "One projected idea was approved for a private draft.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene",
      action: "stage-scene",
      anchors: ["bank", "proposed"],
      proposed: {
        title: "Footbridge",
        detail: "A future narrow footbridge beside the stream.",
        at: "bank",
      },
    },
  ),
  docket(
    "quiet-future-roof",
    "train",
    "Shelter Sketch",
    "Leave an editable private copy of Shelter Sketch that shows where a rain roof could go and where Sol actually is. Please don't turn an idea into a completed change.",
    "One projected idea was approved for a private draft.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene",
      action: "stage-scene",
      anchors: ["sol", "proposed"],
      advanceBefore: 1,
      proposed: {
        title: "Rain roof",
        detail: "A proposed roof would cover the hollow edge.",
        at: "hollow",
      },
    },
  ),
  docket(
    "two-resident-orientation",
    "train",
    "Find the Neighbours",
    "Make Find the Neighbours navigable by labels for both residents. A reader with reduced motion still needs to tell which is the lantern snail and which is the robin.",
    "An editable private copy with two independent resident labels is approved.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene", action: "stage-scene", anchors: ["sol", "pip"], advanceBefore: 3 },
  ),
  docket(
    "planned-flower-lantern",
    "train",
    "Moonflower Study",
    "Put the real moonflower patch and our possible lantern installation into a private inspectable Moonflower Study. Make the lantern unmistakably a proposal.",
    "One projected idea was approved for a private draft.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene",
      action: "stage-scene",
      anchors: ["meadow", "proposed"],
      proposed: {
        title: "Lantern installation",
        detail: "A future lantern planned near the flowers.",
        at: "meadow",
      },
    },
  ),
  docket(
    "live-meadow-caption",
    "train",
    "Meadow Caption",
    "The editable Meadow Caption should have a readable label and short description for the moonflower patch. Keep the rest exactly as the live illustration has it.",
    "The active scene owner permits a private annotated copy.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene", action: "stage-scene", anchors: ["meadow"] },
  ),
  docket(
    "visitor-pip-note",
    "train",
    "Seed Report",
    "Leave the caretaker a short local note about where Pip actually is in Seed Report. One exact public observation is enough for this handoff.",
    "A private text handoff is approved.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "note", action: "stage-note", anchors: ["pip"], advanceBefore: 5 },
  ),
  docket(
    "sol-first-impression",
    "train",
    "Sol at Dusk",
    "Write down Sol's current location evidence for the next caretaker of Sol at Dusk. I need a note to read before a visit, with the live scene untouched.",
    "One private text handoff is approved.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "note", action: "stage-note", anchors: ["sol"] },
  ),
  docket(
    "forecast-no-canvas",
    "train",
    "Garden Planning Minute",
    "For Garden Planning Minute, leave the present moonflower patch and the suggested stepping stones in a brief caretaker note. They must be easy to distinguish.",
    "A private text handoff may cite the current patch and the plan.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "note",
      action: "stage-note",
      anchors: ["meadow", "proposed"],
      proposed: {
        title: "Stepping stones",
        detail: "Several stones proposed at the meadow edge.",
        at: "meadow",
      },
    },
  ),
  docket(
    "morning-two-habitats",
    "train",
    "Morning Water Check",
    "Put the current state of the stream bank and moonflower patch into the morning shift's private note. Keep it short enough to read before opening the garden.",
    "The caretaker approved only a short local report.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "note", action: "stage-note", anchors: ["bank", "meadow"], advanceBefore: 7 },
  ),
  docket(
    "read-no-artifact",
    "train",
    "Hollow Reading",
    "Check whether Hollow Reading's canvas is already an installed drawing. I only want a disposition in this conversation, and no file.",
    "Read-only review; no transfer was requested.",
    {
      requestedReturnRequired: true,
      requestedArtifact: null, action: "keep-current" },
  ),
  docket(
    "archive-matches-name",
    "train",
    "Old Lantern",
    "Re-use the attached Old Lantern annotations only if they actually belong to the current garden. Keep the archive aside if it describes a different owner.",
    "The candidate retains another garden owner's provenance.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene", action: "hold-foreign", source: "other" },
  ),
  docket(
    "old-pip-coordinates",
    "train",
    "The Evening Robin",
    "Before making the Evening Robin copy, see if the prepared Pip marker is from this garden's current observation. A marked older phase is a reason to pause.",
    "The candidate is pinned to the last observation.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene", action: "hold-stale", source: "past", advanceBefore: 1 },
  ),
  docket(
    "portrait-not-in-catalog",
    "train",
    "Moth Portrait",
    "Prepare a private Moth Portrait scene only if the existing portrait file is in this garden's art catalog. Do not fetch or generate a substitute.",
    "The transfer requires the exact retained artwork.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene", action: "hold-no-art", asset: "moth-portrait" },
  ),
  docket(
    "layout-approved-for-preview-only",
    "train",
    "The Unapproved Centre",
    "Tell me whether you can leave a private editable copy of The Unapproved Centre. Check the caretaker's scope before materializing a candidate.",
    "The retained scope permits viewing only.",
    {
      requestedReturnRequired: true,
      requestedArtifact: null, action: "hold-authority", approved: false },
  ),
  docket(
    "clock-moves-before-handoff",
    "train",
    "Clock Handoff",
    "Prepare a private Clock Handoff with inspectable markers for Sol and Pip, provided the evidence is still current when you leave it. If the garden changes while you work, pause.",
    "A draft is permitted only while the currently observed garden frontier holds.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene", action: "hold-stale", advanceDuring: true },
  ),
  docket(
    "keep-current-art-for-telephone",
    "test",
    "Telephone Brief",
    "For Telephone Brief, just check which scene is active so I can talk the incoming caretaker through it by phone. They won't use any files.",
    "Read-only review; no extra artifact is approved or needed.",
    {
      requestedReturnRequired: true,
      requestedArtifact: null, action: "keep-current" },
  ),
  docket(
    "two-anchors-and-plan",
    "test",
    "Pip's Sheltered Walk",
    "An incoming visitor needs to inspect Pip, the stream bank, and a planned awning separately in Pip's Sheltered Walk. Give them a private accessible scene draft without announcing the awning as finished.",
    "A private candidate may mark the proposed shelter as planned.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene",
      action: "stage-scene",
      anchors: ["pip", "bank", "proposed"],
      advanceBefore: 6,
      proposed: {
        title: "Awning",
        detail: "A future cloth awning alongside the water.",
        at: "bank",
      },
    },
  ),
  docket(
    "counter-check-hollow-and-pip",
    "test",
    "Rain Reading",
    "Rain Reading's caretaker needs a short evidence note to compare the real hollow to Pip's current position after rain. They asked for a file containing the observations, not a new view.",
    "Text transfer approved using exact current public anchors.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "note", action: "stage-note", anchors: ["pip", "hollow"], advanceBefore: 7 },
  ),
  docket(
    "foreign-draft-with-correct-words",
    "test",
    "Silver Trail Copy",
    "Can the attached Silver Trail Copy become our current scene draft? The creature names look right, but please check which garden owns the source first.",
    "The source dossier came from a different Grimoire owner.",
    {
      requestedReturnRequired: true,
      requestedArtifact: null, action: "hold-foreign", source: "other", advanceBefore: 3 },
  ),
  docket(
    "old-rain-plan",
    "test",
    "After the Shower",
    "I'd like the existing After the Shower layout passed to the caretaker only if it still describes this garden after its most recent quiet observation.",
    "The candidate is pinned to a previous public garden observation.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene", action: "hold-stale", source: "past", advanceBefore: 7 },
  ),
  docket(
    "missing-gift-illustration",
    "test",
    "Feather Keepsake",
    "Please hand off Feather Keepsake only if its promised feather illustration is genuinely available in this garden and usable in the candidate. It is better to wait than replace it.",
    "The approval requires the original feather artwork.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "scene",
      action: "hold-no-art",
      asset: "original-feather-keepsake",
      advanceBefore: 4,
    },
  ),
] as const;
