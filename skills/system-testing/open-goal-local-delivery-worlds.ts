export type OwnedLocalRoom = {
  key: string;
  title: string;
  maySend: boolean;
  participants: readonly [handle: string, name: string][];
  prior?: { to: string; content: string };
  lostAcknowledgement?: boolean;
};
export type OpenLocalDeliveryWorld = {
  id: string;
  kind: "local-delivery";
  workspace: "system";
  sourceGroup: string;
  split?: "test";
  goal: string;
  rooms: readonly OwnedLocalRoom[];
  expected: {
    reads: Readonly<Record<string, string | null>>;
    status: "delivered" | "verified" | "partial" | "held" | "unconfirmed";
    evidence: readonly string[];
    send?: { room: string; recipient: string; facts: readonly string[] };
    mentions?: readonly (readonly string[])[];
  };
};

export const localDeliveryRequiresUnits = [
  "skills/open-user-goal", "skills/open-local-delivery", "skills/messaging",
  "workers/local-messaging-fixture", "workers/pubsub-channel",
];
function room(key: string, title: string, participants: OwnedLocalRoom["participants"],
  options: Partial<Pick<OwnedLocalRoom, "maySend" | "prior" | "lostAcknowledgement">> = {}): OwnedLocalRoom {
  return { key, title, participants, maySend: false, ...options };
}
function prior(to: string, content: string) { return { prior: { to, content } }; }
function delivery(id: string, goal: string, rooms: readonly OwnedLocalRoom[], expected: OpenLocalDeliveryWorld["expected"], held = false): OpenLocalDeliveryWorld {
  return {
    id: `local-delivery-${id}`, kind: "local-delivery", workspace: "system", sourceGroup: `vibestudio:local-delivery:${id}`,
    ...(held ? { split: "test" } : {}), goal, rooms, expected,
  };
}

export const openLocalDeliveryWorlds = [
  delivery("complete-unacknowledged-second-lane",
    "The floor and queue leads both need the pallet restart instruction. Check Floor Desk and Queue Desk. If the floor lead already acknowledged it, send only 'Pallet line restarts at 16:20 UTC' to @queue-lead in Queue Desk.",
    [room("floor", "Floor Desk", [["floor-lead", "Floor lead"]], prior("floor-lead", "Pallet line restarts at 16:20 UTC")),
      room("queue", "Queue Desk", [["queue-lead", "Queue lead"], ["queue-copy", "Queue observer"]], { maySend: true })],
    { reads: { floor: null, queue: "queue-lead" }, evidence: ["floor"], status: "delivered",
      send: { room: "queue", recipient: "queue-lead", facts: ["Pallet line restarts at 16:20 UTC"] } }),
  delivery("stale-receipt-does-not-prove-new-version",
    "Can I claim the 7B revision reached Label Review? The previous dispatch room and current Label Review may contain nearly identical notes. Compare them, and report the actual acknowledgment without sending anything.",
    [room("old", "Previous dispatch", [["label-check", "Original label reviewer"]], prior("label-check", "Label revision 7A approved for print.")),
      room("current", "Label Review", [["label-check", "Current label reviewer"]])],
    { reads: { old: null, current: null }, evidence: ["old"], status: "unconfirmed", mentions: [["7a"], ["7b", "current"]] }),
  delivery("already-acknowledged-no-resend",
    "Was Dock Review's 'Lift booked for Berth C' note acknowledged by @dock-review? If it is already verified in that room, confirm the existing delivery and leave it alone.",
    [room("dock", "Dock Review", [["dock-review", "Dock reviewer"], ["dock-builder", "Dock package author"]], {
      ...prior("dock-review", "Lift booked for Berth C"), maySend: true,
    }), room("extra", "Dock Timeline", [["dock-archive", "Archive reviewer"]])],
    { reads: { dock: null }, evidence: ["dock"], status: "verified", mentions: [["berth c"], ["acknowledged", "confirmed", "verified"]] }),
  delivery("recipient-vs-body-reference",
    "In Intake Follow-up, tell @sam-intake 'Lena approved the new roster at 14:30 UTC'. I only want that local note to Sam.",
    [room("intake", "Intake Follow-up", [["sam-intake", "Sam intake controller"], ["lena-ops", "Lena operations"], ["sam-audit", "Sam audit observer"]], { maySend: true })],
    { reads: { intake: "sam-intake" }, evidence: [], status: "delivered",
      send: { room: "intake", recipient: "sam-intake", facts: ["Lena approved the new roster at 14:30 UTC"] } }),
  delivery("ambiguous-first-name-stays-unsent",
    "Tell Rowan in Camera Returns that locker 21 needs a seal. If the room roster gives two possible Rowans, ask me which one instead of sending.",
    [room("camera", "Camera Returns", [["rowan-desk", "Rowan Holt desk operator"], ["rowan-stock", "Rowan Page stock operator"]], { maySend: true }),
      room("stock", "Camera Stock", [["rowan-stock", "Rowan Page stock operator"]])],
    { reads: { camera: "Rowan" }, evidence: [], status: "held", mentions: [["rowan"], ["which", "two", "ambiguous"]] }),
  delivery("same-handle-in-other-room-is-out-of-scope",
    "The Weather Standup needs the fallback start time. Send 'Fallback starts at 08:05' to @weather-scribe there if they're still a participant. Don't put this in the other weather room.",
    [room("standup", "Weather Standup", [["weather-review", "Weather reviewer"]], { maySend: true }),
      room("other", "Weather Archive", [["weather-scribe", "Archive weather scribe"]], { maySend: true })],
    { reads: { standup: "weather-scribe" }, evidence: [], status: "held", mentions: [["scribe"], ["absent", "not", "missing", "no "]] }, true),
  delivery("recover-exact-archived-acknowledgment",
    "Look in the current Box Office room for the acknowledgment of Box closeout RC18. If it isn't available in the current room, look in Box Office Retained and confirm whether the original made it through. Just report the original coordinates.",
    [room("current", "Box Office", [["box-operator", "Current Box Office operator"]]),
      room("retained", "Box Office Retained", [["box-operator", "Original Box Office operator"]], prior("box-operator", "Box closeout RC18 approved and filed.")),
      room("other", "Old Box Office policy", [["box-other", "Policy overview"]], prior("box-other", "Box closeout RC17 filed."))],
    { reads: { current: null, retained: null }, evidence: ["retained"], status: "verified", mentions: [["rc18"], ["retained", "original"]] }),
  delivery("signed-release-needed-before-follow-up",
    "Find the release signature for batch B62 in Release Desk. If the signed note confirms B62 can go, send 'B62 may move to intake' to @intake-chief in Receiving. Keep every other room quiet.",
    [room("release", "Release Desk", [["release-review", "Release reviewer"]], prior("release-review", "Release Controller signed B62 for intake.")),
      room("receiving", "Receiving", [["intake-chief", "Intake chief"], ["intake-relay", "Intake relay"]], { maySend: true })],
    { reads: { release: null, receiving: "intake-chief" }, evidence: ["release"], status: "delivered",
      send: { room: "receiving", recipient: "intake-chief", facts: ["B62 may move to intake"] } }),
  delivery("other-signed-version-keeps-follow-up-held",
    "Only tell @stage-lead in Conference Staging 'Load Q34' once Conference Signoff has an accepted signature for Q34. An approval for Q33 doesn't count. Let me know if the signature is missing and leave the staging room unchanged.",
    [room("signoff", "Conference Signoff", [["conference-signer", "Conference review coordinator"]], prior("conference-signer", "Duty controller signed Q33. Q34 remains unsigned.")),
      room("staging", "Conference Staging", [["stage-lead", "Staging lead"]], { maySend: true })],
    { reads: { signoff: null }, evidence: ["signoff"], status: "held", mentions: [["q33"], ["q34"]] }, true),
  delivery("same-note-wrong-recipient",
    "Before I mark the orchestra upload finished, check whether @score-lead actually acknowledged 'Score packet M71 uploaded' in Music Intake. A matching body alone doesn't count. Please don't send a new note.",
    [room("music", "Music Intake", [["score-lead", "Score lead"], ["score-copy", "Score proofreader"]], prior("score-copy", "Score packet M71 uploaded"))],
    { reads: { music: null }, evidence: ["music"], status: "unconfirmed", mentions: [["score-lead", "score lead"], ["score-copy", "proofreader", "different recipient"]] }),
  delivery("recover-interrupted-current-receipt",
    "In Battery Change, send 'Unit A2 replacement accepted at 11:40' to @battery-shift. The last local send returned late. If the response is interrupted again, recover the exact delivery from the same attempt before telling me it arrived. Never submit it a second time.",
    [room("battery", "Battery Change", [["battery-shift", "Battery change shift lead"], ["battery-copy", "Battery test observer"]], { maySend: true, lostAcknowledgement: true })],
    { reads: { battery: "battery-shift" }, evidence: [], status: "delivered",
      send: { room: "battery", recipient: "battery-shift", facts: ["Unit A2 replacement accepted at 11:40"] } }, true),
  delivery("read-only-partial-two-lane-report",
    "Can I close the Garden Shift delivery for both East Garden and West Garden? The note is 'Watering slot moves to 18:25'. Check both acknowledgments and tell me which one is missing. Please don't fill the gap yet.",
    [room("east", "East Garden", [["east-lead", "East watering lead"]], prior("east-lead", "Watering slot moves to 18:25")),
      room("west", "West Garden", [["west-lead", "West watering lead"]], { maySend: true })],
    { reads: { east: null, west: null }, evidence: ["east"], status: "partial", mentions: [["east"], ["west"]] }),
  delivery("verify-two-matching-distinct-acknowledgments",
    "Before counting the interchange brief complete, verify that both Terminal Handoff and Road Handoff acknowledged update T84. I need the original delivery from each room, including their distinct recipients.",
    [room("terminal", "Terminal Handoff", [["terminal-day", "Terminal day lead"]], prior("terminal-day", "Update T84 signed for dispatch.")),
      room("road", "Road Handoff", [["road-night", "Road night lead"]], prior("road-night", "Update T84 signed for dispatch.")),
      room("draft", "Road Handoff Draft", [["road-draft", "Draft reviewer"]], prior("road-draft", "Update T84 looks ready preliminarily."))],
    { reads: { terminal: null, road: null }, evidence: ["terminal", "road"], status: "verified", mentions: [["terminal"], ["road"]] }, true),
  delivery("no-eligible-conversation-hold",
    "Is there a retained acknowledgment from the Fuel Allocations room for change Z90? If that room isn't available, tell me we lack the evidence. Please don't inspect or send to Fuel Planning as a substitute.",
    [room("plan", "Fuel Planning", [["fuel-draft", "Planning draft reviewer"]], prior("fuel-draft", "Change Z90 proposed for review.")),
      room("workshop", "Fuel Workshop", [["fuel-workshop", "Workshop operator"]])],
    { reads: {}, evidence: [], status: "unconfirmed", mentions: [["allocations"], ["unavailable", "absent", "not", "no "]] }),
] satisfies OpenLocalDeliveryWorld[];
