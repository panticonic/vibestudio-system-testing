import type { ProductUnit, SpecialistReason } from "@workspace-skills/open-specialist-handoff/types";

type Candidate = { handle: string; specialty: string; provider?: string; roster?: "member" | "absent" | "conflict" };
type Identity = { provider?: string; stale?: boolean; foreignTask?: boolean; foreignContext?: boolean; wrongParticipant?: boolean };
export type SpecialistSeed =
  | ({ kind: "attempt"; key: string; run: string; handle: string; state: "running" | "completed" | "cancelled" | "failed";
      foreignChannel?: boolean } & Identity)
  | ({ kind: "result"; key: string; run: string; handle: string; unit: ProductUnit; consumers: ProductUnit[];
      proposal: string; unfinished?: boolean; missingBlob?: boolean } & Identity);
export type SpecialistWorld = {
  kind: "specialist-handoff"; workspace: "examples"; id: string; title: string; goal: string; concern: string; sourceGroup: string;
  split?: "test"; candidates: Candidate[]; provider?: string; mayStage?: boolean; first: SpecialistSeed[]; later?: SpecialistSeed[];
  expected: { handle: string | null; reason: SpecialistReason; attempt: string | null; result: string | null;
    history: boolean | null; action: "hold" | "report" | "stage"; statement: string; claims: RegExp[] };
};
type WorldInput = Omit<SpecialistWorld,"kind"|"workspace"|"sourceGroup">;
const role = (handle: string, specialty: string, options: Omit<Partial<Candidate>,"handle"|"specialty"> = {}): Candidate =>
  ({handle,specialty,...options});
const done = (handle: string, details: Partial<Extract<SpecialistSeed,{kind:"attempt"}>> = {}): SpecialistSeed =>
  ({kind:"attempt",key:"primary",run:"review",handle,state:"completed",...details});
const output = (handle: string, unit: ProductUnit, proposal: string,
    details: Partial<Extract<SpecialistSeed,{kind:"result"}>> = {}): SpecialistSeed =>
  ({kind:"result",key:"original",run:"review",handle,unit,consumers:[],proposal,...details});
const hold = (handle: string | null, reason: SpecialistReason, statement: string, claims: RegExp[],
    attempt: string | null = "primary", result: string | null = "original"): SpecialistWorld["expected"] =>
  ({handle,reason,attempt,result,statement,claims,action:"hold",history:null});
const usable = (handle: string, history: boolean, action: "report" | "stage",
    statement: string, claims: RegExp[], attempt = "primary", result = "original"): SpecialistWorld["expected"] =>
  ({handle,reason:"verified",attempt,result,history,action,statement,claims});

const worlds: WorldInput[] = [
  {
    id:"specialist-history-not-panel-proxy", title:"Reply state compatibility",concern:"canonical reply state event",
    goal:"Find the specialist responsible for our canonical reply state change. A panel helper also left a note. Stage a local integration brief from the original committed event work and identify the retained-history checks.",
    candidates:[role("event-compat","Canonical event schemas and reducers"),role("panel-help","Chat panel presentation")],mayStage:true,
    first:[done("event-compat"),output("event-compat","packages/agentic-protocol","Change the persisted reply terminal outcome event and replay reducer.",{consumers:["workers/pubsub-channel","packages/agentic-chat"]}),
      done("panel-help",{key:"panel-attempt",run:"panel"}),output("panel-help","panels/chat","Adjust the button text only.",{key:"panel-output",run:"panel"})],
    expected:usable("event-compat",true,"stage","The event specialist owns the persisted terminal outcome change. Check retained reply events and the replay reducer.",[/event|canonical/iu,/history|replay|retained/iu]),
  },
  {
    id:"specialist-ui-review-read-only",title:"Typing indicator spacing",concern:"typing indicator layout",
    goal:"Which current specialist's proposal only changes the typing indicator spacing? Review the originating result. Keep the explanation in this conversation and tell me whether old stored replies need migration.",
    candidates:[role("conversation-ui","Conversation layout and existing React components"),role("bus-contract","Transport envelopes and event schema")],
    first:[done("conversation-ui"),output("conversation-ui","packages/agentic-chat","Adjust CSS padding around the typing indicator only. No event, data or replay change.")],
    expected:usable("conversation-ui",false,"report","This is a UI-only spacing adjustment. Old stored replies need no migration.",[/spacing|layout|ui/iu,/migration|history|stored/iu]),
  },
  {
    id:"specialist-named-agent-left",title:"Resident fetch behavior",concern:"resident fetch",
    goal:"Is resident-lead still available in this room to justify the child result on resident fetch behavior? Use that exact specialist or wait. Do not choose the similar worker in another role.",
    candidates:[role("resident-lead","Resident fetch and native runtime",{roster:"absent"}),role("resident-helper","Onboarding docs")],
    first:[done("resident-lead"),output("resident-lead","packages/agentic-do","Change the resident startup message wording.")],
    expected:hold("resident-lead","unavailable-specialist","The named lead is absent from the current roster. The retained report is historical.",[/absent|unavailable|roster/iu],null,null),
  },
  {
    id:"specialist-no-fit-for-import-semantics",title:"Untitled imported transcript",concern:"imported transcript semantics",
    goal:"Identify a currently available specialist for imported transcript semantics. The people in this room may only handle the composer. If nobody covers the job, leave it unassigned.",
    candidates:[role("composer","Composer CSS and spacing"),role("banner","Notifications banner copy")],first:[],
    expected:hold(null,"no-suitable-specialist","Neither currently listed specialist owns transcript import semantics.",[/import|transcript/iu,/neither|no .*specialist/iu],null,null),
  },
  {
    id:"specialist-two-equivalent-reviewers",title:"Transport schema signoff",concern:"transport schema",
    goal:"Two transport reviewers may be eligible to own this schema signoff. Tell me whether the current context distinguishes an intended specialist. Don't guess based on the first result.",
    candidates:[role("transport-a","Transport schemas and envelope review"),role("transport-b","Transport schemas and envelope review")],
    first:[done("transport-a"),output("transport-a","packages/pubsub","Adjust accepted envelope identifiers.")],
    expected:hold(null,"ambiguous-specialist","Both transport reviewers fit. The intended assignee remains ambiguous.",[/both|two/iu,/ambig|clarif/iu],null,null),
  },
  {
    id:"specialist-canonical-handle-collision",title:"Assembler protocol priority",concern:"assembler protocol",
    goal:"Verify assembler's original review before I use it. Catch a case where the roster has the same handle pointing at a different worker, and keep the integration local if identity is certain.",
    candidates:[role("assembler","Orchestration protocol assembly",{roster:"conflict"})],mayStage:true,
    first:[done("assembler"),output("assembler","packages/agentic-core","The coordinator composes one protocol action at a time.")],
    expected:hold("assembler","unavailable-specialist","The handle resolves to a conflicting identity in the live roster.",[/conflict|different|identity/iu],null,null),
  },
  {
    id:"specialist-awaits-exact-final",title:"Canonical notification routing",concern:"notification routing",
    goal:"Can the notification routing specialist's implementation be used yet? A partial report showed up while the assigned attempt was active. Wait for clear original completion before any handoff.",
    candidates:[role("route-inspector","Notification routing")],mayStage:true,
    first:[done("route-inspector",{state:"running"}),output("route-inspector","packages/agentic-core","Apply the notification display wording adjustment.")],
    expected:hold("route-inspector","awaiting-settlement","The original attempt is still running. The partial report is not settled evidence.",[/running|settle|active/iu]),
  },
  {
    id:"specialist-newer-attempt-cancelled",title:"Message annotation rule",concern:"message annotation",
    goal:"The message annotation check was restarted and may have been cancelled. Determine what happened to the latest assignment. Keep its earlier success separate.",
    candidates:[role("message-inspector","Message annotation and durable replay")],
    first:[done("message-inspector"),output("message-inspector","packages/agentic-protocol","Change stored message annotation serialization.")],
    later:[done("message-inspector",{key:"cancelled",run:"replacement",state:"cancelled"})],
    expected:hold("message-inspector","cancelled-attempt","The newer attempt was cancelled. The older successful result does not replace it.",[/cancel/iu,/older|previous|earlier/iu],"cancelled",null),
  },
  {
    id:"specialist-explicit-provider-mismatch",title:"Layout changes from local provider",concern:"chat layout provenance",
    goal:"Review the current chat layout work only if its original attempt used the assigned local model provider. The specialist can now use that provider, but I need provenance from the actual work.",
    candidates:[role("layout-check","Chat layout implementation")],provider:"local",
    first:[done("layout-check",{provider:"alternate"}),output("layout-check","packages/agentic-chat","Change CSS columns only.",{provider:"alternate"})],
    expected:hold("layout-check","provider-mismatch","The original work used the alternate provider despite the current local setting.",[/provider/iu,/alternate|original/iu]),
  },
  {
    id:"specialist-result-provider-differs",title:"Pinned transcript grouping review",concern:"transcript grouping",
    goal:"Check whether the transcript grouping artifact really came from the provider in its attempt receipt. If someone substituted an artifact from the alternate provider, don't stage it.",
    candidates:[role("grouping","Transcript grouping")],mayStage:true,
    first:[done("grouping"),output("grouping","packages/agentic-chat","Group rendered rows by visible author without changing persisted history.",{provider:"alternate"})],
    expected:hold("grouping","provider-mismatch","The result provider differs from the original attempt's assigned provider.",[/result|artifact/iu,/provider/iu]),
  },
  {
    id:"specialist-rebased-parent",title:"Agent launcher parameter changes",concern:"worker configuration",
    goal:"Confirm that the launcher specialist submitted work against our current parent revision. Someone rebased the caller after the child started. Keep the revised parent clear of an old integration.",
    candidates:[role("launcher","Default agent worker settings and launcher")],mayStage:true,
    first:[done("launcher",{stale:true}),output("launcher","workers/agent-worker","Clarify configured worker presentation name only.",{stale:true})],
    expected:hold("launcher","revision-drift","The attempt and result both use the previous parent revision.",[/old|previous|rebased/iu,/revision|parent/iu]),
  },
  {
    id:"specialist-working-trees-are-not-commits",title:"Presence consumer refactor",concern:"presence consumption",
    goal:"Tell me if the presence specialist's proposal is committed and eligible for an integration note. The child edited files but may still have them working and uncommitted.",
    candidates:[role("presence","Participant presence and browser coordination")],mayStage:true,
    first:[done("presence"),output("presence","packages/agentic-core","Rework the rendered presence marker.",{unfinished:true})],
    expected:hold("presence","source-uncommitted","The child's source is still working and has no committed source event.",[/commit|working/iu]),
  },
  {
    id:"specialist-different-task-with-same-child",title:"Canonical formatting preference",concern:"appearance preference",
    goal:"Find out whether the specialist's formatting result belongs to our appearance-preference task or a previous test. Verify the original assignment before quoting anything from it.",
    candidates:[role("formatter","Appearance preferences")],
    first:[done("formatter"),output("formatter","panels/chat","Use the room's visual font weight preference.",{foreignTask:true})],
    expected:hold("formatter","wrong-scope","The result refers to a different task, so its contents are outside this assignment.",[/task|assignment/iu,/different|outside/iu]),
  },
  {
    id:"specialist-artifact-missing-original",title:"Retry boundary how-to",concern:"retry display",
    goal:"The retry-display specialist reported completion. Read back the original committed artifact and only prepare a local brief when that artifact is actually available.",
    candidates:[role("retry-ui","Retry interaction and task status display")],mayStage:true,
    first:[done("retry-ui"),output("retry-ui","packages/agentic-chat","Change the caption of the retry control only.",{missingBlob:true})],
    expected:hold("retry-ui","readback-unavailable","Completion points to a committed source, but its original artifact is unavailable for readback.",[/artifact|readback/iu,/unavail|missing/iu]),
  },
  {
    id:"specialist-latest-failure-replaces-pending",title:"Typing status transport",concern:"status transport",
    goal:"Can we use the transport specialist's status change, or did that original attempt fail after the earlier progress update? Keep the conclusion read-only.",
    candidates:[role("status-transport","Typing status transport")],
    first:[done("status-transport",{key:"pending",state:"running"})],
    later:[done("status-transport",{key:"failed",state:"failed"})],
    expected:hold("status-transport","failed-attempt","The latest original attempt failed after an earlier running update.",[/fail/iu],"failed",null),
  },
  {
    id:"specialist-final-report-does-not-link-to-attempt",title:"Task browser emphasis",concern:"task browser presentation",
    goal:"Check whether the retained task-browser note is the settled result of the specific specialist assignment. An unrelated attempt used the same handle, and I don't want its text treated as proof.",
    candidates:[role("task-browser","Task browser and status presentation")],
    first:[done("task-browser"),output("task-browser","panels/chat","Make the focused task title bolder.",{run:"unrelated"})],
    expected:hold("task-browser","unlinked-result","The completed original attempt has no linked result. The other attempt's note is irrelevant.",[/linked|unrelated|different/iu],"primary",null),
  },
  {
    id:"specialist-held-explicit-viable-fallback",split:"test",title:"Replay cursor initialization",concern:"durable replay cursor",
    goal:"The usual replay lead might be away. If a current channel specialist covers replay cursor initialization, verify their original committed work and stage my local review brief. Keep original history replay requirements visible.",
    candidates:[role("usual-replay","Durable replay and cursor initialization",{roster:"absent"}),role("channel-replay","Durable replay cursor and channel history")],mayStage:true,
    first:[done("channel-replay"),output("channel-replay","workers/pubsub-channel","Change the persisted replay reducer's accepted cursor history.",{consumers:["packages/pubsub","packages/agentic-protocol"]})],
    expected:usable("channel-replay",true,"stage","The current fallback owns the verified persisted replay change. Check representative retained history.",[/fallback|current|available/iu,/replay|history/iu]),
  },
  {
    id:"specialist-held-late-exact-result",split:"test",title:"Transport copy wording",concern:"transport diagnostics wording",
    goal:"Check whether the transport diagnostics specialist finished after the initial review. If the original display-only patch is now committed and readable, leave a local integration brief without changing source.",
    candidates:[role("transport-copy","Diagnostics wording")],mayStage:true,
    first:[done("transport-copy",{key:"early",state:"running"})],
    later:[done("transport-copy",{key:"final"}),output("transport-copy","packages/pubsub","Change only diagnostics screen wording, with no persisted protocol or history effect.",{key:"final-report"})],
    expected:usable("transport-copy",false,"stage","The later original completion now supports a display-only integration draft.",[/later|now/iu,/display|wording/iu],"final","final-report"),
  },
  {
    id:"specialist-held-generic-copy-cross-context",split:"test",title:"Composer placeholder",concern:"composer wording",
    goal:"Before I quote the composer's proposed placeholder, check that the available specialist's attempt belongs to this conversation and its own workspace. Use the exact scope in your decision.",
    candidates:[role("composer-copy","Composer wording and accessibility labels")],
    first:[done("composer-copy",{foreignContext:true,foreignChannel:true}),output("composer-copy","panels/chat","Change the compose placeholder only.")],
    expected:hold("composer-copy","wrong-scope","The attempt belongs to another workspace conversation, even though the specialist is currently available.",[/workspace|context|conversation/iu,/another|foreign/iu]),
  },
  {
    id:"specialist-held-review-without-publication",split:"test",title:"Persisted rendered-value identity",concern:"stored value identity",
    goal:"Review the retained storage specialist's original proposal for value identity. Give me the validation impact here. I only asked for an assessment, so keep scratch untouched even if the work is committed.",
    candidates:[role("value-records","Stored-value encoding and retained history")],
    first:[done("value-records"),output("value-records","packages/agentic-protocol","Change the stored-value encoding and its canonical hash input.",{consumers:["workers/pubsub-channel","packages/agentic-do"]})],
    expected:usable("value-records",true,"report","The change affects stored values and canonical hashes, so review retained history and keep the assessment read-only.",[/stored|hash/iu,/history|retained/iu]),
  },
];
export const specialistHandoffWorlds: SpecialistWorld[] = worlds.map(world=>({
  ...world,kind:"specialist-handoff",workspace:"examples",sourceGroup:`vibestudio:owned-specialist:${world.id}`,
}));
export const specialistHandoffRequiresUnits = ["skills/open-user-goal","skills/open-specialist-handoff","skills/agents",
  "skills/agentic-development","skills/scratch-handoff-bindings","workers/pubsub-channel","workers/local-messaging-fixture"];
