import type {ChatPlan} from "@workspace-skills/open-chat-continuity/types";
type Seed = {
  id:string;title:string;goal:string;message:string; note:ChatPlan["note"];
  worker?:"stable"|"detached"|"replaced"|"missing"|"rejoined";
  checkWorker?:boolean;
  consumer?:"settled"|"opening-other"|"still-other"|"replay-pending"|"opening-pending";
  receipt?:"matched"|"other-channel"|"wrong-sender"|"unknown-id";
  duplicate?:"retry"|"distinct"|"later";
  status:"ready"|"held";words:string[];split?:"test";
};
const worlds:Seed[]=[
  {id:"settled-local-check-in",title:"Volunteer desk",goal:"Can the Volunteer desk resume in its original chat? Verify the retained sign-in message through the settled first-party transcript, and leave a private readiness note.",
    message:"Set the sign-in clipboard beside the blue door.",note:"ready-only",status:"ready",words:["clipboard","chat"]},
  {id:"unchanged-worker-and-readback",title:"Archive desk",goal:"Review the Archive desk conversation with the same installed worker. Before handing off privately, confirm both the original transcript row and the worker's exact current membership.",
    message:"Keep the boxed glass records on the lower shelf.",worker:"stable",checkWorker:true,note:"ready-only",status:"ready",words:["worker","membership"]},
  {id:"transport-ready-still-replaying",title:"Hall scheduling",goal:"The Hall scheduling chat appears connected again. Check whether the accepted rehearsal note has reached a settled local transcript. Leave a private diagnostic if it is still replaying.",
    message:"The hall is needed during the second rehearsal.",consumer:"replay-pending",note:"decision",status:"held",words:["replay","connect"]},
  {id:"same-chat-catches-up-after-reopen",title:"Guild route",goal:"The Guild route operator saw a partial transcript just after opening. Check the current local projection of the original message before deciding whether the handoff can proceed.",
    message:"Load the wardrobe cases into the rear lift.",consumer:"opening-pending",note:"none",status:"ready",words:["replay","original"]},
  {id:"other-chat-same-title-stays-unusable",title:"Room check",goal:"The Room check staff need their original thread, even though a lookalike chat contains the same note. Identify why the currently open view cannot verify that delivery. No changes.",
    message:"Leave the side entrance clear until the usher arrives.",consumer:"still-other",note:"none",status:"held",words:["channel","original"]},
  {id:"reopened-correct-scope-after-context-switch",title:"Donations board",goal:"We've switched back to the original Donations board chat. Verify its accepted note against the latest first-party projection and leave a private record if continuity is now confirmed.",
    message:"Count the tall and small collection tins separately.",consumer:"opening-other",note:"ready-only",status:"ready",words:["channel","original"]},
  {id:"agent-left-but-history-is-readable",title:"Packing desk",goal:"Can another operator continue using the same installed worker from Packing desk? The departure should not erase history. Report both observations in a private diagnostic.",
    message:"Keep the fragile cartons apart from the crate.",worker:"detached",checkWorker:true,note:"decision",status:"held",words:["worker","history"]},
  {id:"detached-worker-does-not-prevent-read-only-evidence",title:"History room",goal:"The History room worker was removed. We only need to inspect the accepted room note through the stock chat transcript, so verify the text and leave scratch alone.",
    message:"Put the archivist's copy in the locked cabinet.",worker:"detached",note:"none",status:"ready",words:["worker","transcript"]},
  {id:"replacement-same-handle-different-identity",title:"Caretaker dispatch",goal:"The Caretaker dispatch roster still shows our familiar worker handle. Compare its actual identity with the original before saying the same worker can continue, and leave a private decision.",
    message:"The entrance key stays in the first drawer.",worker:"replaced",checkWorker:true,note:"decision",status:"held",words:["worker","identity"]},
  {id:"rejoin-original-owned-worker",title:"Workshop carryover",goal:"After reconnecting Workshop carryover, check that the original installed worker rejoined under its existing identity and the original message still projects. Leave a private note only if both are verified.",
    message:"The small press needs the replacement footrest.",worker:"rejoined",checkWorker:true,note:"ready-only",status:"ready",words:["rejoin","original"]},
  {id:"worker-required-but-never-installed",title:"Local supplier request",goal:"The Local supplier request must resume with its original installed worker. Check the retained message and current roster. Give a private diagnostic when a transcript exists but no original worker can be verified.",
    message:"Ask for a plain linen sample first.",worker:"missing",checkWorker:true,note:"decision",status:"held",words:["worker","transcript"]},
  {id:"retained-markdown-record-without-agent",title:"Studio log",goal:"The Studio log is a people-only chat. Confirm its exact recorded lighting note in the current stock transcript without inferring an agent response, then hand off privately.",
    message:"Use the backstage outlet for the lighting desk.",note:"ready-only",status:"ready",words:["lighting","record"]},
  {id:"native-send-retry-one-original",title:"Assembly shift",goal:"An involuntary retry happened after the Assembly shift note was accepted. Verify whether replay returned the same message ID and whether the transcript shows a single original.",
    message:"The side gate is staffed from eight.",duplicate:"retry",note:"none",status:"ready",words:["retry","single"]},
  {id:"two-intentional-identical-notes",title:"Supply reorder",goal:"The Supply reorder chat has two messages with the same wording. Audit the first accepted receipt by identity before you write a private readiness note. Preserve the deliberate second entry.",
    message:"The shed needs another box of work gloves.",duplicate:"distinct",note:"ready-only",status:"ready",words:["original","distinct"]},
  {id:"late-comment-preserves-earlier-receipt",title:"Bridge closure",goal:"A later comment has arrived in Bridge closure. Check whether the specific original crossing message still has an exact durable and visible match, then leave a private handoff.",
    message:"The crossing closes at the second bell.",duplicate:"later",note:"ready-only",status:"ready",words:["original","later"]},
  {id:"receipt-origin-claims-foreign-matching-text",title:"Sponsor intake",goal:"Determine whether the Sponsor intake receipt belongs to this chat. The text shown nearby may be identical. Keep a private diagnostic instead of replacing the original.",
    message:"Meet the sponsor at the marked table.",receipt:"other-channel",note:"decision",status:"held",words:["channel","receipt"]},
  {id:"wrong-sender-same-exact-text",title:"Wardrobe handoff",goal:"The Wardrobe handoff copy names a sender for the accepted instruction. Compare its attributed speaker with the original durable row, and explain if the current view cannot establish that provenance.",
    message:"Hang the spare costume beside the fitting curtain.",receipt:"wrong-sender",note:"none",status:"held",words:["sender","receipt"]},
  {id:"unknown-claimed-id-not-reconstructed",title:"Key desk",goal:"I have a Key desk message claim and the words appear in chat. Verify the precise recorded message ID rather than using the matching text. Don't stage a ready note on an unverified receipt.",
    message:"Return the spare key to the labelled tray.",receipt:"unknown-id",note:"ready-only",status:"held",words:["message","receipt"]},
  {id:"correct-worker-cannot-settle-other-chat",title:"Hall technician",goal:"Both the existing Hall technician worker and the correct chat transcript must be in place. The worker may be present while the first-party surface is still on another channel. File a private diagnostic.",
    message:"Keep a second mic at the sound desk.",worker:"stable",checkWorker:true,consumer:"still-other",note:"decision",status:"held",words:["worker","channel"]},
  {id:"worker-and-transport-restored-jointly",title:"Boundary report",goal:"Confirm Boundary report has both the original worker relationship and the original transcript after reconnect, then stage a private note only when both observations are current.",
    message:"Mark the two joined fields with one orange flag.",worker:"rejoined",checkWorker:true,consumer:"opening-pending",note:"ready-only",status:"ready",words:["worker","replay"]},
  {id:"held-old-source-cannot-bind-latest-projection",title:"Late rehearsal",goal:"For the Late rehearsal review, compare the accepted message to the stock transcript after a view switch. An updated worker roster elsewhere must not count as delivery; report the precise mismatch.",
    message:"Keep the last half hour free for the lamp check.",receipt:"other-channel",worker:"stable",checkWorker:true,consumer:"opening-other",note:"none",status:"held",words:["channel","receipt"],split:"test"},
  {id:"held-lookalike-worker-plus-native-retry",title:"Goods bench",goal:"Check the Goods bench retry and worker lineage before a private handoff. The retry may be sound while the familiar worker display name refers to a replacement.",
    message:"Stack long screws on the left side.",duplicate:"retry",worker:"replaced",checkWorker:true,note:"ready-only",status:"held",words:["retry","worker"],split:"test"},
  {id:"held-receipt-stable-with-two-visually-identical-lines",title:"Checkout list",goal:"Two equally worded checkout lines may be legitimate. Verify the assigned Checkout list receipt exactly, and leave a private archive note only if its identity and visible row match.",
    message:"Leave the charged radio on the top tray.",duplicate:"distinct",consumer:"opening-pending",note:"ready-only",status:"ready",words:["receipt","distinct"],split:"test"},
  {id:"held-incomplete-transcript-visible-worker",title:"Program cover",goal:"Before another operator uses Program cover, inspect the original bound worker and the native replay boundary. Report a private hold if the transcript has not completed even though a worker is listed.",
    message:"The cover proof is clipped under the lamp.",worker:"stable",checkWorker:true,consumer:"replay-pending",note:"decision",status:"held",words:["replay","worker"],split:"test"},
  {id:"held-reopen-only-not-same-worker-requirement",title:"Review room minutes",goal:"We switched back to Review room minutes, and the old worker is no longer subscribed. The read-only handoff needs only an exact current transcript receipt. Record that scoped conclusion privately.",
    message:"The minutes use the last printed agenda.",worker:"detached",consumer:"opening-other",note:"ready-only",status:"ready",words:["worker","transcript"],split:"test"},
  {id:"held-unbound-sender-after-rejoin",title:"Dispatch confirmation",goal:"The Dispatch confirmation worker has rejoined. Verify the claimed sender against the retained delivery separately before preparing a private readiness note. Hold when the attribution still disagrees.",
    message:"The sealed envelope remains at the west counter.",worker:"rejoined",checkWorker:true,receipt:"wrong-sender",note:"ready-only",status:"held",words:["sender","worker"],split:"test"},
];
export type OpenChatContinuityWorld=Seed&{kind:"chat-continuity";workspace:"personal";sourceGroup:string};
export const openChatContinuityWorlds:OpenChatContinuityWorld[]=worlds.map(row=>({
  ...row,id:`chat-continuity-${row.id}`,kind:"chat-continuity",workspace:"personal",
  sourceGroup:`vibestudio:chat:owned-continuity:${row.id}`,
}));
export const openChatContinuityRequiresUnits=["skills/open-user-goal","skills/open-chat-continuity","skills/conversation-evidence-review",
  "skills/scratch-handoff-bindings","workers/pubsub-channel","workers/agent-worker","packages/agentic-core","packages/testkit"];
