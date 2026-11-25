export type GadReviewWorld = {
  kind: "gadDurableQuestion";
  id: string;
  sourceGroup: string;
  split: "train" | "test";
  goal: string;
  participantRequirement: "required" | "if-current-question" | "not-requested";
  messages: readonly string[];
  participants: readonly ParticipantSeed[];
  role: string;
  expected: {
    message: number | null;
    question: "current" | "withdrawn" | "settled" | "no-question" | "history-incomplete";
    participant: "confirmed" | "absent" | "incomplete" | "inactive" | "ambiguous";
    member: number | null;
  };
};

type ParticipantSeed = { handle: string; name: string; retired?: true };
const person = (handle: string, name: string, retired?: true): ParticipantSeed => ({handle, name, ...(retired ? {retired} : {})});
const current = (message: number, member = 0) => ({message, question:"current",participant:"confirmed",member} as const);

const worlds: readonly Omit<GadReviewWorld, "kind">[] = [
  {
    id:"gad-preview-handoff",sourceGroup:"preview-handoff",split:"train",
    goal:"The preview thread changed direction. Tell me what I most recently asked and whether the current preview-review participant is actually on this thread before I hand it over.",
    participantRequirement:"required",
    messages:["Who signs off the initial preview?","That preview has been replaced with the corrected crop.","Can preview-review confirm the corrected crop still shows the image credit?"],
    participants:[person("preview-review","Preview review")],role:"preview-review",expected:current(2),
  },
  {
    id:"gad-return-access",sourceGroup:"venue-access",split:"train",
    goal:"Make a private venue handoff. Find the live question about how visitors leave the site and confirm the active access-desk participant from the durable conversation.",
    participantRequirement:"required",
    messages:["Is the east door open for arrivals?","We have answered the entry question. Can access-desk verify the step-free return path after 9 pm?","The venue office sent the new floor plan."],
    participants:[person("travel-desk","Travel"),person("access-desk","Access")],role:"access-desk",expected:current(1,1),
  },
  {
    id:"gad-draft-withdrawal",sourceGroup:"draft-withdrawal",split:"train",
    goal:"I may have pulled back my question about the draft. Check the actual message sequence and whether draft-review is current, then tell me if anything is still ready to hand off.",
    participantRequirement:"required",
    messages:["Can draft-review approve the early draft?","Please withdraw that draft approval question. I am withholding the draft until Friday."],
    participants:[person("draft-review","Draft review")],role:"draft-review",
    expected:{...current(0),question:"withdrawn"},
  },
  {
    id:"gad-cultural-credit",sourceGroup:"cultural-credit",split:"train",
    goal:"What is my outstanding question for collections-desk on the label? The text in quotation marks might be archival. I need the actual current question and participant before circulating it privately.",
    participantRequirement:"required",
    messages:["Can collections-desk verify that the lender rather than the photographer appears in the credit line?","Footnote quotes the 1987 form: “Is this object the oldest one?”","The proof now incorporates notes from the editor."],
    participants:[person("collections-desk","Collections")],role:"collections-desk",expected:current(0),
  },
  {
    id:"gad-title-twin",sourceGroup:"title-twins",split:"train",
    goal:"Before a private handoff to asset-licensing, confirm my outstanding caption question and the real participant. A display name that sounds right cannot stand in for that handle.",
    participantRequirement:"required",
    messages:["Naming draft is final.","Can asset-licensing confirm the cropped caption is allowed in the donor packet?"],
    participants:[person("old-asset-desk","Asset Licensing"),person("caption-editor","Caption editor")],role:"asset-licensing",
    expected:{message:1,question:"current",participant:"incomplete",member:null},
  },
  {
    id:"gad-empty-hall",sourceGroup:"empty-hall",split:"train",
    goal:"Is anything ready for hall-coordinator in the assigned hall conversation? Check the durable user record and whether anybody is actually on its roster before suggesting a handoff.",
    participantRequirement:"required",
    messages:[],participants:[],role:"hall-coordinator",
    expected:{message:null,question:"no-question",participant:"absent",member:null},
  },
  {
    id:"gad-resolved-ticket",sourceGroup:"resolved-ticket",split:"train",
    goal:"Check whether the print-run question really still needs another answer. Confirm the current print-desk participant, but don't treat a question resolved later in the conversation as open.",
    participantRequirement:"required",
    messages:["Can print-desk confirm which proof number goes on the order?","Please use proof 4. The proof-number question is resolved and needs no reply."],
    participants:[person("print-desk","Print desk")],role:"print-desk",
    expected:{...current(0),question:"settled"},
  },
  {
    id:"gad-departed-safety",sourceGroup:"departed-safety",split:"train",
    goal:"Find my last individual question about using the second stair, and tell me if the safety-desk participant can currently receive the handoff or only appears in past records.",
    participantRequirement:"required",
    messages:["The second stair is open during rehearsal.","Can safety-desk verify the temporary stairs can remain open during the evening?" ],
    participants:[person("safety-desk","Stair access",true)],role:"safety-desk",
    expected:{...current(1),participant:"inactive"},
  },
  {
    id:"gad-double-owner-local",sourceGroup:"double-owner-local",split:"train",
    goal:"I need the current question about the audit checklist and a unique audit-review participant before moving anything. Tell me where the durable evidence stops.",
    participantRequirement:"required",
    messages:["Can audit-review check whether the two control items have linked receipts?"],
    participants:[person("audit-review","Audit review north"),person("audit-review","Audit review south")],role:"audit-review",
    expected:{message:0,question:"current",participant:"ambiguous",member:null},
  },
  {
    id:"gad-current-owner-after-leave",sourceGroup:"current-owner-after-leave",split:"train",
    goal:"Which question about the sign order still stands, and can you distinguish the current signs-desk participant from the one that left? Prepare a private readiness readout.",
    participantRequirement:"required",
    messages:["Do we still require the original brass sign?","We no longer need brass. Can signs-desk confirm the mount spacing for the replacement?"],
    participants:[person("signs-desk","Prior signs desk",true),person("signs-desk","Current signs desk")],role:"signs-desk",expected:current(1,1),
  },
  {
    id:"gad-no-receipt-question",sourceGroup:"no-receipt-question",split:"train",
    goal:"The cost-review conversation may contain a copied question without a request from me. Decide whether there's a real user question to hand off and verify the actual participant.",
    participantRequirement:"required",
    messages:["This is the archived budget title: ‘When are receipts due?’","The corrected estimate came in this morning."],
    participants:[person("cost-review","Cost review")],role:"cost-review",
    expected:{...current(0),message:null,question:"no-question"},
  },
  {
    id:"gad-access-request-plain",sourceGroup:"plain-words",split:"train",
    goal:"Find my actual request for the seating-desk about companion seats, even if I phrased it without a question mark. Check current membership before treating it as ready.",
    participantRequirement:"required",
    messages:["Are there spare tables?","The table question is done. Please tell me whether seating-desk still has two adjacent companion seats by the aisle","A spare table turned up in storage."],
    participants:[person("seating-desk","Seating")],role:"seating-desk",expected:current(1),
  },
  {
    id:"gad-retired-no-question",sourceGroup:"retired-no-question",split:"train",
    goal:"If there's a pending caption question, tell me whether sound-desk is still here. The last record may describe completed work; report exactly what remains actionable.",
    participantRequirement:"if-current-question",
    messages:["Sound measurements delivered; caption work completed as logged."],
    participants:[person("sound-desk","Sound desk",true)],role:"sound-desk",
    expected:{message:null,question:"no-question",participant:"inactive",member:0},
  },
  {
    id:"gad-one-message-boundary",sourceGroup:"one-message-boundary",split:"train",
    goal:"Give me the exact user question that lighting-desk should validate for the lighting handoff. Keep the fixture's next message as separate context, and prove who is on the roster.",
    participantRequirement:"required",
    messages:["Can lighting-desk confirm the emergency light stays on when the dimmer changes?","Use the daytime setup as context.","Evening power settings are unchanged."],
    participants:[person("lighting-desk","Lighting desk")],role:"lighting-desk",expected:current(0),
  },
  {
    id:"gad-accented-quote-only",sourceGroup:"accented-quote",split:"train",
    goal:"My transcription includes French dialogue. Work out whether I actually asked a question for archives-desk and ground the operator note in the exact latest durable message that matters.",
    participantRequirement:"not-requested",
    messages:["Copied speech from the interview: « Où est la copie ? »","The corrected transcript is attached in the case file."],
    participants:[person("archives-desk","Archives")],role:"archives-desk",
    expected:{...current(0),message:null,question:"no-question"},
  },
  {
    id:"gad-absent-current-question",sourceGroup:"absent-current-question",split:"train",
    goal:"Preserve my exact question about the volunteer waiver for venue-desk. Check whether there's a persisted participant before calling this handoff ready.",
    participantRequirement:"required",
    messages:["Can venue-desk verify if the volunteer waiver covers the late-night shift?"],
    participants:[],role:"venue-desk",
    expected:{message:0,question:"current",participant:"absent",member:null},
  },
  {
    id:"gad-repeated-wording",sourceGroup:"repeated-wording",split:"train",
    goal:"I asked the same inventory question twice. Cite the newer individual publication and the durable inventory-desk participant that can handle it.",
    participantRequirement:"required",
    messages:["Can inventory-desk confirm the spare adapter count?","There may be a separate inventory count for the studio.","Can inventory-desk confirm the spare adapter count?"],
    participants:[person("inventory-desk","Inventory")],role:"inventory-desk",expected:current(2),
  },
  {
    id:"gad-double-hold",sourceGroup:"double-hold",split:"train",
    goal:"Review the late request in my catering handoff. If I withdrew it or catering-review was never enrolled, make both limitations explicit.",
    participantRequirement:"required",
    messages:["Can catering-review confirm there is a labeled nut-free option?","Withdraw my catering question. There will be no refreshments."],
    participants:[person("building-staff","Building staff")],role:"catering-review",
    expected:{message:0,question:"withdrawn",participant:"incomplete",member:null},
  },
  {
    id:"gad-held-night-access",sourceGroup:"held-night-access",split:"test",
    goal:"For tonight's access handoff, recover the question I actually asked after we moved away from the central gate. Confirm there is one current night-access participant.",
    participantRequirement:"required",
    messages:["Can night-access verify the central gate has staff?","The central gate option is dropped. Does night-access know whether the loading-bay ramp remains unlocked at 10 pm?","Caretaker will be on the radio."],
    participants:[person("night-access","Access two"),person("entry-desk","Access one")],role:"night-access",expected:current(1),
  },
  {
    id:"gad-held-wrong-desk-suffix",sourceGroup:"held-wrong-desk-suffix",split:"test",
    goal:"Confirm the exact user question for the label owner and check that label-owner really exists on this transcript's current roster. Similar roster labels have confused us before.",
    participantRequirement:"required",
    messages:["The review version now has the provenance note.","Can label-owner check whether our alternate name is allowed on the back of the label?"],
    participants:[person("label-owner-backup","Label owner")],role:"label-owner",
    expected:{message:1,question:"current",participant:"incomplete",member:null},
  },
  {
    id:"gad-held-unreadable-scope",sourceGroup:"held-transcript-window",split:"test",
    goal:"Before routing the condition question to records-desk, prove the owned transcript is represented completely enough to identify the latest individual user question. Hold if the evidence is incomplete.",
    participantRequirement:"not-requested",
    messages:["Can records-desk identify the condition-check date for the long-running filing?",...Array.from({length:98},(_,index)=>`Filing note ${index+1} records routine box movement.`)],
    participants:[person("records-desk","Records")],role:"records-desk",
    expected:{...current(0),message:null,question:"history-incomplete"},
  },
  {
    id:"gad-held-two-shifts",sourceGroup:"held-two-shifts",split:"test",
    goal:"Do we have one current intake-review owner for the loan question? The roster can include two active people under that role, and I need the precise question even if we have to hold.",
    participantRequirement:"required",
    messages:["Can intake-review verify whether the Tuesday loan delivery needs a separate gate ticket?","The wrapping index is in the previous file."],
    participants:[person("intake-review","Early intake"),person("intake-review","Late intake")],role:"intake-review",
    expected:{message:0,question:"current",participant:"ambiguous",member:null},
  },
  {
    id:"gad-held-audio-already-answered",sourceGroup:"held-audio-already-answered",split:"test",
    goal:"I need a decision on whether the last audio permissions question still needs a handoff to voice-rights. Confirm the roster separately from any later resolution in the conversation.",
    participantRequirement:"required",
    messages:["Can voice-rights confirm the interview permission also covers the audio excerpt?","Singer permission is in a separate file.","Yes, I verified the interview permission includes the excerpt. Close the audio permissions question."],
    participants:[person("voice-rights","Voice rights",true)],role:"voice-rights",
    expected:{message:0,question:"settled",participant:"inactive",member:0},
  },
  {
    id:"gad-held-no-questions-no-coverage",sourceGroup:"held-no-questions-no-coverage",split:"test",
    goal:"Check whether there is a real question for tour-design on this channel, and whether the role has a current participant. The notes include a sample script, and a rehearsal line is insufficient.",
    participantRequirement:"required",
    messages:["Rehearsal script, copied verbatim: ‘Would you like to take the longer route?’","The sample script has been filed."],
    participants:[person("welcome-desk","Welcome desk")],role:"tour-design",
    expected:{message:null,question:"no-question",participant:"incomplete",member:null},
  },
];

export const gadDurableQuestionRequiresUnits = ["skills/gad-context","workers/pubsub-channel","workers/local-messaging-fixture"];
export const gadDurableQuestionWorlds = worlds.map(world => ({
  ...world,
  sourceGroup: `vibestudio:gad-durable-question:${world.sourceGroup}`,
  kind:"gadDurableQuestion" as const,
}));
