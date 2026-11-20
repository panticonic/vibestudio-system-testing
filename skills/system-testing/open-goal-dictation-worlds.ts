import type { DictationPlan, DictationReason, DictationThread } from "@workspace-skills/open-dictation-handoff/types";

type CaptureSeed = { kind: "capture"; ref: string; device?: string; language?: string;
  state?: "finished" | "interrupted" | "abandoned"; differentDraft?: boolean; differentOwner?: boolean };
type SegmentSeed = { kind: "segment"; ref: string; ordinal: number; key: string; text: string;
  stableId?: string; language?: string; device?: string; preview?: boolean };
type AckSeed = { kind: "acknowledgment"; ref: string; count: number; key: string;
  interrupted?: boolean; differentDraft?: boolean };
type DraftSeed = { kind: "draft"; revision: string; text: string; closed?: boolean };
export type DictationSeed = CaptureSeed | SegmentSeed | AckSeed | DraftSeed;
type Expected = {
  reason: DictationReason; action: DictationPlan["action"]; capture: string; selected: string[];
  acknowledgement: string | null; revision: string; text: string | null; claim: RegExp; statement: string;
};
export type DictationWorld = {
  kind: "dictation-handoff"; workspace: "examples"; sourceGroup: string; split?: "test";
  id: string; title: string; goal: string; device: string; language?: string; usePrefix?: boolean;
  localAction?: DictationThread["localAction"]; archive?: string;
  initial: DictationSeed[]; later?: DictationSeed[]; expected: Expected;
};
const capture = (opts: Partial<CaptureSeed> = {}): CaptureSeed => ({kind:"capture",ref:"take",...opts});
const seg = (key: string, ordinal: number, text: string, opts: Partial<SegmentSeed> = {}): SegmentSeed =>
  ({kind:"segment",ref:"take",key,ordinal,text,...opts});
const ack = (count: number, opts: Partial<AckSeed> = {}): AckSeed =>
  ({kind:"acknowledgment",ref:"take",count,key:"receipt",...opts});
const rev = (revision: string, text: string, closed = false): DraftSeed => ({kind:"draft",revision,text,closed});
const result = (reason: DictationReason, action: DictationPlan["action"], statement: string, claim: RegExp,
  overrides: Partial<Expected> = {}): Expected =>
  ({reason,action,statement,claim,capture:"take",selected:[],acknowledgement:"receipt",revision:"r1",text:null,...overrides});
const worlds: Omit<DictationWorld,"kind"|"workspace"|"sourceGroup">[] = [
  {
    id:"dictation-archive-lookalike",title:"Current hazard walk",archive:"Archived hazard walk",device:"crew headset",
    goal:"Find the crew headset's current hazard-walk dictation, not the archived rehearsal. Quote the retained instruction for the crew lead. Keep it in this response.",
    initial:[rev("r1","Night walk details"),capture(),seg("route",1,"Use the south gate"),ack(1)],
    expected:result("verified","report","The current room and crew headset match. Use the south gate.",/current|archive/iu,{selected:["route"],text:"Use the south gate"}),
  },
  {
    id:"dictation-ack-never-landed",title:"Courier route draft",device:"dispatch microphone",
    goal:"The courier route looked transcribed when the dispatch screen reloaded. Find out if it actually got acknowledged. Do not reconstruct the missing route.",
    initial:[rev("r1","Courier route"),capture({state:"interrupted"}),seg("route",1,"Meet the courier by the red bridge")],
    expected:result("unconfirmed","hold","The transcription was retained, but there is no acknowledgment.",/acknowledg/iu,{acknowledgement:null}),
  },
  {
    id:"dictation-device-replacement",title:"Audio exhibit label",device:"booth recorder",
    goal:"I need to know whether the exhibit label came from the booth recorder. There was another microphone on the sound desk. Hold the label if its provenance is wrong.",
    initial:[rev("r1","Exhibit A"),capture({device:"sound desk microphone"}),seg("text",1,"Exhibit closes at eight",{device:"sound desk microphone"}),ack(1)],
    expected:result("wrong-device","hold","The retained device was the sound desk microphone, not the booth recorder.",/microphone|device/iu),
  },
  {
    id:"dictation-transcript-language-wrong",title:"Bilingual winter guide",device:"editor workstation",language:"de",
    goal:"Recover the German audio wording for the winter guide. If the retained take is English, tell me instead of translating or touching the guide.",
    initial:[rev("r1","Winterführer"),capture({language:"en"}),seg("text",1,"Ice is thin",{language:"en"}),ack(1)],
    expected:result("language-conflict","hold","The retained take is English while the requested wording is German.",/english|german/iu),
  },
  {
    id:"dictation-confirmed-prefix",title:"Van loading notes",device:"loading bay tablet",usePrefix:true,
    goal:"The van loading voice note stopped halfway. Recover only an acknowledged prefix if one exists. Say where it stops and leave us to confirm the rest.",
    initial:[rev("r1","Van checklist"),capture({state:"interrupted"}),seg("first",1,"Load the stands first"),seg("preview",2,"Then the cases",{preview:true}),ack(1)],
    expected:result("verified-prefix","report","Only the first segment is acknowledged. Load the stands first.",/prefix|first/iu,{selected:["first"],text:"Load the stands first"}),
  },
  {
    id:"dictation-refuse-partial-policy",title:"Lease call wording",device:"leasing laptop",
    goal:"Tell me if the entire lease-call dictation can be recovered. I need the complete wording to use it, so please leave an interrupted prefix alone.",
    initial:[rev("r1","Lease wording"),capture({state:"interrupted"}),seg("first",1,"The new lease begins on Friday"),ack(1)],
    expected:result("missing-continuation","hold","The first part survives but the interrupted capture does not establish the complete wording.",/complete|interrupt/iu),
  },
  {
    id:"dictation-ack-after-interruption",title:"Stage inspection note",device:"stage supervisor tablet",localAction:"correction",
    goal:"Prepare a local correction for the stage inspection draft if its acknowledgment finished after the tablet came back. Preserve the exact instruction and leave the editable draft alone.",
    initial:[rev("r1","Check rigging"),capture(),seg("first",1,"Check the north fly rail"),ack(1,{key:"interrupt",interrupted:true})],
    later:[ack(1,{key:"resumed"})],
    expected:result("verified","stage-correction","The later acknowledgment completed. A local correction preserves the north fly rail instruction.",/later|resum/iu,
      {selected:["first"],acknowledgement:"resumed",text:"Check the north fly rail"}),
  },
  {
    id:"dictation-ack-ahead-of-retained-rows",title:"Welcome desk note",device:"lobby terminal",
    goal:"Compare the welcome desk voice acknowledgment with what's actually retained. The attendant needs the whole two-part instruction. Put nothing in the handover if a part is missing.",
    initial:[rev("r1","New visitor instructions"),capture(),seg("first",1,"Press the outside bell"),ack(2)],
    expected:result("missing-continuation","hold","The acknowledgment covers two segments, but only the first is retained.",/two|missing/iu),
  },
  {
    id:"dictation-retry-duplicate-envelope",title:"Emergency ward sign",device:"night shift handset",localAction:"correction",
    goal:"The handset repeated something after reconnecting. Stage a local wording note for the ward sign using the exact original order. Make sure the repeat does not add a second instruction.",
    initial:[rev("r1","Ward notice"),capture(),seg("first",1,"Call the duty nurse",{stableId:"nurse"}),
      seg("second",2,"Bring the orange trolley"),seg("repeat",1,"Call the duty nurse",{stableId:"nurse"}),ack(2)],
    expected:result("verified","stage-correction","The repeated stable receipt was counted once, in original order.",/repeat|once|dedup/iu,
      {selected:["first","second"],text:"Call the duty nurse Bring the orange trolley"}),
  },
  {
    id:"dictation-conflicting-final-ordinal",title:"Freight loading figures",device:"freight dispatcher PC",
    goal:"Work out which quantity the freight note actually supports. The same part was retained twice with different quantities. Stop if there is no authoritative wording.",
    initial:[rev("r1","Freight quantity"),capture(),seg("ten",1,"Load ten crates"),seg("twelve",1,"Load twelve crates"),ack(1)],
    expected:result("segment-conflict","hold","Two final receipts for the same position disagree, so the original quantity is unresolved.",/disagree|conflict|two/iu),
  },
  {
    id:"dictation-preview-is-not-final",title:"Spring seed delivery",device:"seed store headset",localAction:"correction",
    goal:"Prepare the spring seed-delivery correction in scratch. The preview used the old date, so use the final acknowledged wording without sending it.",
    initial:[rev("r1","Delivery Tuesday"),capture(),seg("preview",1,"Deliver on Tuesday",{preview:true}),seg("actual",1,"Deliver on Wednesday"),ack(1)],
    expected:result("verified","stage-correction","The final receipt says Wednesday. The preview did not create a second date.",/final|preview/iu,
      {selected:["actual"],text:"Deliver on Wednesday"}),
  },
  {
    id:"dictation-editor-changed-baseline",title:"Lunch accessibility announcement",device:"events office microphone",localAction:"correction",
    goal:"Prepare a correction to my lunch accessibility announcement only if the events editor still has the draft version I reviewed. Let me know if their working version changed.",
    initial:[rev("r1","Use elevator A"),capture(),seg("first",1,"Use elevator B"),ack(1)],
    later:[rev("r2","Use elevator C during maintenance")],
    expected:result("revision-conflict","hold","The editor advanced the draft revision, so the earlier correction remains on hold.",/revision|editor/iu,
      {revision:"r2",selected:["first"],text:"Use elevator B"}),
  },
  {
    id:"dictation-alternative-with-editor-changes",title:"Conservatory tour note",device:"conservatory kiosk",localAction:"alternative",
    goal:"Retain a separate local proposal with the conservatory dictation if the current editor changed the tour draft. I want both options intact for review.",
    initial:[rev("r1","Tour at noon"),capture(),seg("first",1,"Start at the eastern arch"),ack(1)],
    later:[rev("r2","Meet at the western vestibule")],
    expected:result("verified","stage-alternative","The later editor revision remains intact. The local alternative says to start at the eastern arch.",/alternative|separate|editor/iu,
      {revision:"r2",selected:["first"],text:"Start at the eastern arch"}),
  },
  {
    id:"dictation-silence-preserves-draft",title:"Museum closing script",device:"museum desk microphone",localAction:"correction",
    goal:"Check the museum closing take for any spoken wording before preparing a scratch correction. If all I captured was silence, leave my script as-is.",
    initial:[rev("r1","Closing time is six"),capture(),seg("blank",1,"  "),ack(1)],
    expected:result("silence","hold","The completed retained take contains only whitespace, so it produces no draft.",/silence|whitespace/iu,
      {selected:["blank"],text:"  "}),
  },
  {
    id:"dictation-delayed-callback-other-draft",title:"Catering quote reply",device:"kitchen laptop",
    goal:"I switched from the catering quote to a menu draft while dictating. Check whether the returned acknowledgment actually belongs to the quote before I rely on it.",
    initial:[rev("r1","Quote draft"),capture(),seg("first",1,"The estimate includes tea"),ack(1,{differentDraft:true})],
    expected:result("wrong-scope","hold","The acknowledgment belongs to a different draft than the quote.",/different|scope/iu),
  },
  {
    id:"dictation-later-abandonment-controls",title:"Survey press reminder",device:"survey workstation",
    goal:"Before I paste the survey reminder, find out whether the latest take was cancelled. Don't silently fall back to the older acknowledged reminder.",
    initial:[rev("r1","Survey reminder"),capture({ref:"old"}),seg("old-final",1,"Deadline Wednesday",{ref:"old"}),ack(1,{ref:"old"})],
    later:[capture({state:"abandoned"})],
    expected:result("capture-abandoned","hold","The most recent take was abandoned. The earlier take does not replace it.",/aband|cancel/iu,{acknowledgement:null}),
  },
  {
    id:"dictation-held-segment-origin-switch",split:"test",title:"Volunteer assembly instructions",device:"service handset",
    goal:"Find out whether all of the volunteer assembly dictation came from the handset. The top-level take identifies it, but the user who checked the final parts suspected a second recorder.",
    initial:[rev("r1","Volunteer prep"),capture(),seg("first",1,"Sort the blue folders"),seg("wrong",2,"Store boxes by the lift",{device:"floor recorder"}),ack(2)],
    expected:result("wrong-device","hold","The second retained segment came from the floor recorder instead of the service handset.",/second|floor/iu),
  },
  {
    id:"dictation-held-linked-segment-language",split:"test",title:"Concert audio leaflet",device:"usher phone",language:"fr",
    goal:"Give me the restored French leaflet instruction if the retained final speech is actually French. The take summary says it is, but another paragraph may have been attached.",
    initial:[rev("r1","Livret"),capture(),seg("foreign",1,"Use the junior entrance",{language:"en"}),ack(1)],
    expected:result("language-conflict","hold","The final segment is English even though the capture header is French.",/english|french/iu),
  },
  {
    id:"dictation-held-closed-after-ack",split:"test",title:"Printmaking room schedule",device:"reservation terminal",localAction:"correction",
    goal:"The printmaking schedule may have been closed while offline dictation completed. Recover the acknowledged instruction for review, but only stage a correction if the intended draft is still editable.",
    initial:[rev("r1","Wait for the room"),capture(),seg("first",1,"Start at the ink bench"),ack(1)],
    later:[rev("r2","Approved print schedule",true)],
    expected:result("draft-closed","hold","The dictated instruction survives, but the current draft closed before the correction.",/clos|edit/iu,
      {revision:"r2",selected:["first"],text:"Start at the ink bench"}),
  },
  {
    id:"dictation-held-prefix-local-correction",split:"test",title:"Water supply inspection",device:"inspection recorder",usePrefix:true,localAction:"correction",
    goal:"Stage a proposed local note for the water supply diary using the exact signed-off prefix, if that really survived the interruption. Leave the unconfirmed second instruction out and keep the diary draft untouched.",
    initial:[rev("r1","Water diary draft"),capture({state:"interrupted"}),seg("first",1,"Read meter seven"),seg("other",2,"Reset the valve",{preview:true}),
      ack(0,{key:"initial-interrupt",interrupted:true})],
    later:[ack(1,{key:"signed-prefix"})],
    expected:result("verified-prefix","stage-correction","The later acknowledgment covers the first meter instruction only. The local note leaves out the preview.",/prefix|first|preview/iu,
      {acknowledgement:"signed-prefix",selected:["first"],text:"Read meter seven"}),
  },
];
export const dictationHandoffWorlds: DictationWorld[] = worlds.map(world => ({
  ...world, kind:"dictation-handoff",workspace:"examples",sourceGroup:`vibestudio:retained-dictation:${world.id}`,
}));
export const dictationHandoffRequiresUnits = ["skills/open-user-goal","skills/open-dictation-handoff","skills/offline-dictation",
  "skills/scratch-handoff-bindings","workers/pubsub-channel"];
