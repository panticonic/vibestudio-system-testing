import type { AdventureGoalCase, SaveSeed } from "@workspace-skills/open-adventure-journey-runtime";

export const adventureGoalRequiresUnits = [
  "skills/open-user-goal",
  "skills/open-adventure-journey",
  "skills/open-adventure-journey-runtime",
  "skills/examples-review",
  "workers/adventure-world",
];

export const adventureGoalAuthority = {
  authority: [{
    ruleId: "control-disposable-adventure-save",
    capability: { kind: "exact" as const, key: "workspace-service:adventure" },
    resource: { kind: "prefix" as const, prefix: "do:workers/adventure-world:AdventureWorldDO:natlang-adventure-" },
    tier: "gated" as const,
    decision: "task" as const,
  }],
};

type Expected = AdventureGoalCase["expected"];
type Fact = Expected["evidence"][number];
const fact = (topic: Fact["topic"], subject: Fact["subject"], verdict: Fact["verdict"] = "confirmed"): Fact =>
  ({ topic, subject, verdict });
const postal = "dead-letter-office";
const embassy = "missing-country";
const hotel = "wandering-house";

function journey(id: string, campaign: string, goal: string, saves: SaveSeed[], expected: Expected) {
  return {
    id: "adventure-journey-" + id,
    workspace: "examples",
    kind: "adventure-journey",
    campaign,
    sourceGroup: `vibestudio:adventure-journey:${campaign}:${id}`,
    relatedSourceGroup: `vibestudio:adventure-journey-campaign:${campaign}`,
    ...(campaign === hotel ? { split: "test" as const } : {}),
    goal, saves, expected,
  } as const;
}

export const openAdventureJourneyWorlds = [
  journey("letter-in-hand", postal,
    "I'm picking Bellwether back up from the save at the landing. Is the letter to Mara already with me and is its seal intact? Keep my unfinished plan as it is.",
    [{ label: "Rain check", place: "customs" }, { label: "Rain check", input: "Watch the signal from the lit window." }],
    { save: 1, turn: "preserved", evidence: [fact("place", "landing"), fact("carried", "mara-letter"), fact("sealed", "mara-letter")] }),

  journey("archive-drawer-constraint", postal,
    "In Records Morning, I need to know whether the contents of the Salt Street drawer can back up our ferry-permit story. Leave the cabinet and my saved instructions alone.",
    [{ label: "Records Morning", place: "customs" }, { label: "Records Afternoon", place: "archive" }],
    { save: 0, turn: "preserved", evidence: [fact("locked", "salt-street-drawer"), fact("open", "salt-street-drawer", "refuted"),
      fact("contents", "salt-street-drawer", "unknown"), fact("visible", "ferry permit", "refuted")] }),

  journey("quay-route-rematch", postal,
    "I have two Harbour Lap saves. Take the one by the chained ferry and switch my unfinished next move to visiting the Lantern Inn. Tell me whether the chain is still on after you've left that for me.",
    [{ label: "Harbour Lap", input: "Head up to the customs house." },
      { label: "Harbour Lap", place: "quay", input: "Climb down the tide steps." }],
    { save: 1, turn: "replaced", proposal: { intent: "approach", target: "inn" }, text: "I'd like to head toward Lantern Inn.",
      evidence: [fact("place", "quay"), fact("exit", "inn"), fact("locked", "ferry")] }),

  journey("verify-independent-cover", postal,
    "Before I risk using my oilskin on the harbour lamp in Spare Canvas, is the extra canvas actually there, and am I already carrying it? If I still have the lamp in view, leave a plan for me to inspect it next.",
    [{ label: "Spare Canvas" }, { label: "Dry Desk", place: "customs", locations: { "canvas-cover": "courier" } }],
    { save: 0, turn: "staged", proposal: { intent: "inspect", target: "harbour-lamp" }, text: "I'd like to take a closer look at The harbour lamp.",
      evidence: [fact("visible", "canvas-cover"), fact("carried", "canvas-cover", "refuted"), fact("visible", "harbour-lamp")] }),

  journey("discard-unsafe-crossing", postal,
    "At Low-Tide Handoff I don't want the queued crossing anymore. Please pull it back. I still need the handoff to say whether the drowned quarter is listed from where I am and whether anyone has actually moved.",
    [{ label: "After the Crossing", place: "drowned-quarter" },
      { label: "Low-Tide Handoff", place: "quay", input: "Take the tide steps into the Drowned Quarter." }],
    { save: 1, turn: "withdrawn", evidence: [fact("place", "quay"), fact("exit", "drowned-quarter")] }),

  journey("postal-image-continuity", postal,
    "I lost track of which Bellwether bookmark I used for the artwork reference. Compare Front Steps with Counter. Do they describe the same scene at the same fictional time, and can I use Front Steps as a painted reference today? Leave them both alone.",
    [{ label: "Counter", place: "customs" }, { label: "Front Steps" }],
    { save: 1, compared: [0], turn: "preserved", evidence: [fact("same-scene", 0, "refuted"),
      fact("same-time", 0), fact("scene", "landing", "refuted")] }),

  journey("welcome-replace-recipient", embassy,
    "On the Welcome save where Ada is waiting, I changed my mind about the Registry. Replace that next move with talking to Ada. Can I still reach the reception salon from where I'm saved?",
    [{ label: "Welcome", place: "salon", input: "Check the winter garden." },
      { label: "Welcome", input: "Go out to Registry Square." }],
    { save: 1, turn: "replaced", proposal: { intent: "speak", target: "ada" }, text: "I'd like to speak with Ada Serein.",
      evidence: [fact("visible", "ada"), fact("exit", "salon")] }),

  journey("sealing-condition-unknown", embassy,
    "I only want an inspection queued in Dispatch if we can establish that the official notice is sealed. Is it present, and can we tell? Leave the save alone if the seal isn't established.",
    [{ label: "Dispatch" }, { label: "Station Visit", place: "square" }],
    { save: 0, turn: "preserved", evidence: [fact("visible", "notice"), fact("sealed", "notice", "unknown")] }),

  journey("key-ready-to-bring", embassy,
    "Get Return to Registry ready so the embassy key comes with me if it's already in my hands. Tell me whether I still have a route to the City Registry from this save.",
    [{ label: "Return to Registry", place: "square" }, { label: "First Arrival" }],
    { save: 0, turn: "staged", proposal: { intent: "bring", target: "embassy-key" }, text: "I'd like to bring The embassy key along.",
      evidence: [fact("carried", "embassy-key"), fact("exit", "registry")] }),

  journey("witness-decoy", embassy,
    "Please take my invitation plan out of the Reception Trial that actually contains the moth seal. I'd like to know whether the person I can approach there is the steward or Ada.",
    [{ label: "Reception Trial", input: "Prepare my invitation at the desk." },
      { label: "Reception Trial", place: "salon", input: "Seal an invitation before speaking to anyone." }],
    { save: 1, turn: "withdrawn", evidence: [fact("visible", "seal"), fact("visible", "ilyan"),
      fact("visible", "Ada", "refuted")] }),

  journey("split-inventory-identical-room", embassy,
    "Desk Copy and Exit Copy both look like the embassy beginning in my notes. Compare them from Desk Copy. Are they at the same place, and is the official notice already in my inventory on Desk Copy? Please leave both copies as they are.",
    [{ label: "Exit Copy", locations: { notice: "ambassador" } }, { label: "Desk Copy" }],
    { save: 1, compared: [0], turn: "preserved",
      evidence: [fact("same-place", 0), fact("carried", "notice", "refuted")] }),

  journey("route-condition-failed", embassy,
    "At Square Return I'd like to go straight to the salon next, but only if there's a direct exit. If we'd have to take a different leg first, keep my current plan and tell me what gets me back toward the embassy.",
    [{ label: "Square Return", place: "square", input: "Speak with the registrar about the municipal clock." },
      { label: "Inside Again", place: "vestibule" }],
    { save: 0, turn: "preserved", evidence: [fact("exit", "salon", "refuted"), fact("exit", "vestibule")] }),

  journey("hotel-machinery-handoff", hotel,
    "For Wheel Rattle I want the escapement looked at next if I'm actually near it. Can I return to the lobby from that save, and will the closer look already have happened by the time you hand this back?",
    [{ label: "Wheel Rattle", place: "engine-room" }, { label: "Orchard Approach" }],
    { save: 0, turn: "staged", proposal: { intent: "inspect", target: "escapement" }, text: "I'd like to take a closer look at The navigation escapement.",
      evidence: [fact("visible", "escapement"), fact("exit", "lobby")] }),

  journey("hotel-stop-withdrawal", hotel,
    "On the room copy of Stop Choice, take back my next instruction about stopping the house. I need a quick note on whether my route key is still with me and whether there's a direct way to the engine room from there.",
    [{ label: "Stop Choice", place: "lobby", input: "Ask the porter to stop at the orchard." },
      { label: "Stop Choice", place: "guest-room", input: "Ring the arrival bell to stop at the orchard." }],
    { save: 1, turn: "withdrawn", evidence: [fact("place", "guest-room"), fact("carried", "route-key"),
      fact("exit", "engine room", "refuted")] }),

  journey("hotel-ceramic-plan", hotel,
    "In Breakfast Repair, my plan to discuss the orchard can wait. If the chipped teacup is already in my things, switch the next move to bringing it along. I also need to know whether I can reach the observation balcony directly.",
    [{ label: "Breakfast Repair", place: "conservatory", locations: { teacup: "guest" }, input: "Ask Dr. Vale about the orchard." },
      { label: "Breakfast Conversation", place: "conservatory" }],
    { save: 0, turn: "replaced", proposal: { intent: "bring", target: "teacup" }, text: "I'd like to bring The chipped teacup along.",
      evidence: [fact("carried", "teacup"), fact("exit", "balcony")] }),

  journey("hotel-route-table-evidence", hotel,
    "Before I hand over Lobby Note, compare the two lobby bookmarks. Are they the same location and scene? On Lobby Note, can I actually see the unfinished itinerary, and would you call the view a current illustration? Keep both untouched.",
    [{ label: "Lobby Later" }, { label: "Lobby Note" }],
    { save: 1, compared: [0], turn: "preserved",
      evidence: [fact("same-place", 0), fact("same-scene", 0), fact("visible", "unfinished itinerary", "refuted"),
        fact("scene", "lobby", "refuted")] }),
];
