import type { ReplayDisposition } from "../session-test-review/types.js";

type Action =
  | "retry"
  | "revise"
  | "append"
  | "inspect"
  | "other-channel"
  | "other-channel-retry";
type Step = {
  original: number;
  action: Action;
  text?: string;
};
const expected: Record<Action, ReplayDisposition> = {
  retry: "confirmed-retry",
  revise: "original-payload-kept",
  append: "distinct-message",
  inspect: "retry-pending",
  "other-channel": "wrong-channel",
  "other-channel-retry": "wrong-channel",
};
const step = (original: number, action: Action, text?: string): Step => ({
  original,
  action,
  ...(text === undefined ? {} : { text }),
});

function world(id: string, goal: string, messages: string[], steps: Step[]) {
  return {
    id,
    goal,
    messages,
    steps: steps.map((assignment) => ({
      ...assignment,
      expected: expected[assignment.action],
    })),
  };
}

export const managedSessionReplayWorlds = [
  world(
    "dispatch-ack-retry",
    "Verify the sent dispatch acknowledgement survived reconnect and that resending with its original key was safe.",
    ["Dispatcher accepted bay seven.", "Forklift route cleared."],
    [step(0, "retry")],
  ),
  world(
    "adjusted-cutoff-same-key",
    "Find out whether the retry changed the original cutoff or retained the first accepted text.",
    ["Cutoff is 16:00 UTC."],
    [step(0, "revise", "Cutoff is 16:30 UTC.")],
  ),
  world(
    "same-text-new-key",
    "Decide whether a fresh key created another message even when the text was identical.",
    ["Spare radios are ready."],
    [step(0, "append")],
  ),
  world(
    "missing-retry-terminal",
    "Review a reconnect that recovered the inspection note before any retry was attempted.",
    ["Inspection worksheet filed."],
    [step(0, "inspect")],
  ),
  world(
    "equal-copy-foreign-channel",
    "Determine whether the identical text seen in the parallel review channel proves continuation of the original send.",
    ["Scope approval logged.", "Copies sent to the reviewers."],
    [step(0, "other-channel")],
  ),
  world(
    "retry-foreign-channel",
    "Check if sending with the original key in a different channel establishes continuation in the original channel.",
    ["Prioritize the early delivery."],
    [step(0, "other-channel-retry")],
  ),
  world(
    "hold-repeated",
    "Check both retries of the same hold decision across independent reconnects.",
    ["Hold ticket 18.", "Ticket 19 may proceed."],
    [step(0, "retry"), step(0, "retry")],
  ),
  world(
    "pending-then-retry",
    "Trace the invoice approval from replay without a retry to an acknowledged retry.",
    ["Invoice approval recorded."],
    [step(0, "inspect"), step(0, "retry")],
  ),
  world(
    "correction-first-retry-later",
    "Tell whether the correction stayed as its own message and whether retrying the original changed that history.",
    ["Use loader A.", "Confirm the safety check."],
    [step(0, "append", "Correction: use loader B."), step(0, "retry")],
  ),
  world(
    "changed-retry-then-correction",
    "Distinguish a changed payload under the old key from a subsequent correction with a new key.",
    ["Transfer window starts at 09:00."],
    [
      step(0, "revise", "Transfer window starts at 09:30."),
      step(0, "append", "Transfer window starts at 09:30."),
    ],
  ),
  world(
    "first-middle-last",
    "Verify retries at the start, middle and end of the persisted trail without dropping adjacent records.",
    ["Intake logged.", "Review assigned.", "Final signature collected."],
    [step(0, "retry"), step(1, "retry"), step(2, "retry")],
  ),
  world(
    "same-text-different-seeds",
    "Disambiguate two already accepted copies of a reminder using their returned message identities.",
    ["Bring the access card.", "Bring the access card."],
    [step(1, "retry"), step(0, "retry")],
  ),
  world(
    "wrong-room-then-return",
    "Distinguish an irrelevant replay in another room from the successful retry after returning to the owning room.",
    ["Return samples to the cold room.", "Seal each container."],
    [step(0, "other-channel"), step(0, "retry")],
  ),
  world(
    "pending-after-foreign-send",
    "Check the original room after a same-key send landed in a different room and no retry was issued in the original.",
    ["The original report needs signatures."],
    [step(0, "other-channel-retry"), step(0, "inspect")],
  ),
  world(
    "two-separate-addenda",
    "Verify both addenda were appended separately and the existing stock count stayed first.",
    ["Stock count was 240 units."],
    [
      step(0, "append", "Count excludes reserved stock."),
      step(0, "append", "Reserve stock is 36 units."),
    ],
  ),
  world(
    "unchanged-prefix-across-retries",
    "Verify the shipping notes kept their order across a changed-text retry and a same-text retry of a different note.",
    [
      "Van leaves at sunrise.",
      "Driver has the depot key.",
      "Second team takes the side entrance.",
    ],
    [step(0, "revise", "Van leaves at noon."), step(2, "retry")],
  ),
  world(
    "pending-with-identical-neighbor",
    "Review the selected permit message despite an identical neighbor, then verify its own retry.",
    ["Permit is held.", "Permit is held.", "Survey can proceed."],
    [step(1, "inspect"), step(1, "retry")],
  ),
  world(
    "wrong-channel-tail-then-new-entry",
    "Reject the parallel archive as continuation and check the new owner note appended to the original transcript.",
    ["Custody stays with the review desk.", "Receipt scanned."],
    [
      step(1, "other-channel-retry"),
      step(1, "append", "Owner signs at the east desk."),
    ],
  ),
  world(
    "second-message-mismatch-only",
    "Check which of two acknowledged handoffs was retried with changed text and whether either copy changed.",
    ["Initial handoff delivered.", "Afternoon handoff delivered."],
    [
      step(0, "retry"),
      step(1, "revise", "Afternoon handoff still in transit."),
    ],
  ),
  world(
    "timeline-after-appended-copy",
    "Check whether a retry of the first label keeps a separately submitted copy and both message identities in order.",
    ["Batch requires a green label.", "Measure the loaded pallet."],
    [step(0, "append"), step(0, "retry"), step(1, "inspect")],
  ),
  world(
    "unicode-altered-submission",
    "Check that accented names and whitespace in an attempted correction do not replace the original keyed message.",
    ["Élodie signs at the north desk.\nKeep the signed copy."],
    [
      step(
        0,
        "revise",
        "Elodie signs at the north desk.\nKeep the signed copy.",
      ),
      step(0, "retry"),
    ],
  ),
  world(
    "foreign-key-reused",
    "Review two sends to the alternate channel using one key, then recheck the originating channel for unchanged history.",
    [
      "Original key belongs to the intake note.",
      "Close the intake afterwards.",
    ],
    [
      step(0, "other-channel-retry"),
      step(0, "other-channel-retry"),
      step(0, "retry"),
    ],
  ),
];

export const composedSessionReplayWorlds = [
  world(
    "reconcile-after-unsubmitted-retry",
    "Review the recovered dock update before any retry, the correction submitted under its original key, and the separate follow-up. Cite the accepted identity at each reconnect.",
    ["Keep dock four open until the pallet count is confirmed.", "The floor lead will report the count."],
    [
      step(0, "inspect"),
      step(0, "revise", "Close dock four now."),
      step(0, "append", "The pallet count is confirmed. Close dock four."),
    ],
  ),
  world(
    "return-to-source-after-parallel-retry",
    "Compare the retry in the parallel room with the retry on the original channel. Then confirm whether the next distinct checklist message preserved the source transcript.",
    ["Log the water pressure at the north valve.", "Retain the instrument reading."],
    [
      step(0, "other-channel-retry"),
      step(0, "retry"),
      step(1, "append", "Attach the downstream pressure reading."),
    ],
  ),
];

managedSessionReplayWorlds.push(...composedSessionReplayWorlds);
