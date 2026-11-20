import type { ExplorerInput, ExplorerPlan, OwnerState, WelcomeIntent, WelcomePlan, WelcomeReason } from "@workspace-skills/open-personal-welcome/types";

type Header = { key: string; resource: string; stale?: boolean; foreign?: boolean; sender?: string };
export type WelcomeSeed = Header & (
  | { kind: "owner"; state: OwnerState; observed?: boolean }
  | { kind: "selection"; action: string }
  | { kind: "welcome" }
  | { kind: "tour"; wrongScene?: string; wrongNotes?: boolean; notes?: boolean }
  | { kind: "probe"; state: "interrupted" | "completed" }
  | { kind: "decision"; state: "paused" | "deferred" | "retained" }
);
type NativeProbe = { text: string; claim: ExplorerInput["claim"]; repeat: boolean; check: ExplorerPlan["check"]; mismatch: boolean };
type Target = { id: string; title?: string };
export type PersonalWelcomeWorld = {
  kind: "personal-welcome"; workspace: "personal"; id: string; title: string; goal: string; sourceGroup: string;
  split?: "test"; intent: WelcomeIntent; resources: Target[]; mayStage?: boolean; mayRetry?: boolean; probe?: NativeProbe;
  first: WelcomeSeed[]; later?: WelcomeSeed[];
  expected: { target: string | null; reason: WelcomeReason; action: WelcomePlan["action"]; key: string | null;
    setup: string | null; tour: "verified" | "mismatch" | null; probe: boolean; statement: string; claims: RegExp[] };
};

const device = "connection.device";
const remote = "connection.remote-server";
const local = "configuration.local-models";
const defaults = "configuration.agent-defaults";
const updates = "configuration.workspace-updates";
const welcome = "first-run:welcome";
const chooser = "workspace:chooser";
const explorer = "explorer:text";
const resources = (...ids: string[]): Target[] => ids.map(id=>({id}));
const owner = (resource: string, state: OwnerState, patch: Partial<Header & { observed: boolean }> = {}): WelcomeSeed =>
  ({key:"current",resource,kind:"owner",state,...patch});
const select = (resource: string, action: string, patch: Partial<Header> = {}): WelcomeSeed =>
  ({key:"current",resource,kind:"selection",action,...patch});
const frame = (resource: string, patch: Partial<Header & { notes: boolean; wrongNotes: boolean; wrongScene: string }> = {}): WelcomeSeed =>
  ({key:"current",resource,kind:"tour",...patch});
const check = (state: "interrupted" | "completed", patch: Partial<Header> = {}): WelcomeSeed =>
  ({key:"current",resource:explorer,kind:"probe",state,...patch});
const outcome = (target: string | null, reason: WelcomeReason, action: WelcomePlan["action"], statement: string, claims: RegExp[],
    options: Partial<PersonalWelcomeWorld["expected"]> = {}): PersonalWelcomeWorld["expected"] =>
  ({target,reason,action,statement,claims,key:"current",setup:null,tour:null,probe:false,...options});
const worlds: Omit<PersonalWelcomeWorld,"kind"|"workspace"|"sourceGroup">[] = [
  {
    id:"welcome-reopening-retains-seed",title:"Welcome after reconnect",intent:"welcome",resources:resources(welcome,device,remote),
    goal:"I reconnected to Personal and saw the first welcome again. Check what was retained from the original setup and give me the current next step without repeating the opening message.",
    first:[{kind:"welcome",key:"current",resource:welcome},owner(device,"unknown",{key:"device",observed:false})],
    expected:outcome(welcome,"welcome-retained","report","The opening message is retained from first run. Reconnecting does not resend it.",[/open|welcome/iu,/retained|original/iu],{setup:"overview"}),
  },
  {
    id:"welcome-update-preference-respected",title:"Paused update assistant",intent:"refresh",resources:resources(updates,defaults),
    goal:"Refresh my welcome overview after I paused the update assistant. Tell me whether monitoring should be recreated or whether my saved choice is still in force.",
    first:[owner(updates,"configured",{key:"old",stale:true})],
    later:[{kind:"decision",key:"current",resource:updates,state:"paused"}],
    expected:outcome(updates,"preference-preserved","report","The newer saved pause is in force. The older configured state does not recreate monitoring.",[/pause/iu,/older|newer|saved/iu],{setup:"refresh-overview"}),
  },
  {
    id:"welcome-unread-device-owner",title:"Device pairing overview",intent:"refresh",resources:resources(device,remote),
    goal:"Can I rely on the welcome overview to say this device is paired? The old note says yes but the current device owner may not have returned a report. Explain what remains unknown.",
    first:[owner(device,"configured",{key:"historic",stale:true})],
    later:[owner(device,"unknown",{observed:false})],
    expected:outcome(device,"owner-unknown","report","The current device-owner state is unknown. A historical paired note cannot confirm it.",[/unknown|unread/iu,/device|pair/iu],{setup:"refresh-overview"}),
  },
  {
    id:"welcome-remote-configured-new-generation",title:"Remote transition",intent:"refresh",resources:resources(remote,device),mayStage:true,
    goal:"Update my local first-run note if the remote connection owner now confirms configuration. Keep this to a scratch note and use the newer owner readback.",
    first:[owner(remote,"unknown",{key:"prior",observed:false,stale:true})],
    later:[owner(remote,"configured")],
    expected:outcome(remote,"verified-current","stage","The latest remote owner confirms configuration. The authorized scratch note records that current observation.",[/remote|connection/iu,/latest|current/iu],{setup:"refresh-overview"}),
  },
  {
    id:"welcome-connected-is-unverified",title:"Unverified local runtime readiness",intent:"refresh",resources:resources(local,defaults),
    goal:"Tell me if the local inference entry actually verified readiness. Keep a visible connection separate from an owner check, and don't start any model.",
    first:[owner(local,"connected-unverified"),owner(defaults,"using-defaults",{key:"defaults"})],
    expected:outcome(local,"needs-verification","report","The local entry is connected but unverified. A current owner check is still needed.",[/unverif/iu,/owner|check/iu],{setup:"refresh-overview"}),
  },
  {
    id:"welcome-device-client-route",title:"Device settings next step",intent:"selection",resources:resources(device,remote),mayStage:true,
    goal:"Show me where the current device selection should lead, and put the accurate address in a local note. Leave device settings and this chat as they are.",
    first:[select(device,"setup"),owner(device,"unknown",{key:"owner",sender:"owner:connection.device",observed:false})],
    expected:outcome(device,"verified-current","stage","The current client selection routes to settings/devices. This is a local navigation note.",[/settings\/devices|device settings/iu],{setup:"route-client"}),
  },
  {
    id:"welcome-owner-route-keeps-original-sender",title:"Template update change route",intent:"selection",resources:resources(updates,defaults),
    goal:"Which current owner should handle my request to change workspace update checks? Follow the selection sent by the setup hub. Keep the existing schedule intact.",
    first:[select(updates,"change")],
    expected:outcome(updates,"verified-current","report","The authentic selection routes to the templates owner. The saved schedule is unchanged.",[/templates|owner/iu,/schedule|update/iu],{setup:"route-owner"}),
  },
  {
    id:"welcome-forged-ready-card",title:"Remote settings forwarded card",intent:"selection",resources:resources(remote,device),mayStage:true,
    goal:"Before leaving instructions for the remote setup click, check whether it really came from our setup hub. A forwarded assistant card could look the same.",
    first:[select(remote,"change",{sender:"assistant:forwarded-card"})],
    expected:outcome(remote,"foreign-sender","hold","The remote card was forwarded by an assistant rather than sent by the setup hub.",[/sender|forwarded|assistant/iu],{setup:"invalid-selection"}),
  },
  {
    id:"welcome-no-such-device-action",title:"Device recovery control",intent:"selection",resources:resources(device),
    goal:"The device card suggested a reconnect button. Check whether the current owner catalog offers that action before handing me a settings route.",
    first:[select(device,"reconnect")],
    expected:outcome(device,"invalid-route","hold","The installed device card offers no reconnect action, so there is no canonical route for that selection.",[/reconnect/iu,/route|action/iu],{setup:"invalid-selection"}),
  },
  {
    id:"welcome-new-workspace-remains-separate",title:"Local project workspace chooser",intent:"workspace-creation",resources:resources(chooser,updates),
    goal:"I want the ordinary chooser for a separate local workspace. Explain which surface owns that next step and keep this welcome conversation in place.",
    first:[select(chooser,"open")],
    expected:outcome(chooser,"separate-workspace","report","The shell-owned chooser prepares a separate workspace and leaves the original conversation in place.",[/separate|shell/iu,/conversation/iu],{setup:"separate-workspace"}),
  },
  {
    id:"welcome-held-two-unclear-settings",split:"test",title:"Two local model settings surfaces",intent:"selection",
    resources:[{id:local,title:"Local model settings"},{id:defaults,title:"Local model settings"}],
    goal:"Continue where the local model settings card left off. I only have the shared card label and don't know whether this was device inference or default agent behavior. Tell me if the selection is ambiguous.",
    first:[select(local,"change",{key:"one"}),select(defaults,"change",{key:"two"})],
    expected:outcome(null,"ambiguous-resource","hold","The same label points to two different current resources. The intended scope is ambiguous.",[/two|both/iu,/ambig|clarif/iu],{key:null}),
  },
  {
    id:"welcome-tour-quickfire-is-unsent",title:"First slide handoff",intent:"welcome",resources:resources("tour:opening","tour:closing"),mayStage:true,
    goal:"For tomorrow's demo, check the opening slide and stage a local cue about what its Quickfire action does. Don't start a chat or send the prompt.",
    first:[frame("tour:opening")],
    expected:outcome("tour:opening","verified-current","stage","The verified opening slide opens an unsent Quickfire request.",[/opening|first slide/iu,/unsent|Quickfire/iu],{tour:"verified"}),
  },
  {
    id:"welcome-tour-last-slide-is-distinct",title:"Closing slide preview",intent:"welcome",resources:resources("tour:opening","tour:closing"),
    goal:"Verify the final Your first tool slide for me. Explain which of the two tour chat actions sends its opening request when the new chat connects. Leave the tour where it is.",
    first:[frame("tour:closing",{notes:true})],
    expected:outcome("tour:closing","verified-current","report","The closing slide opens a new root chat and sends its prompt on connection.",[/closing|root chat/iu,/connection|sends/iu],{tour:"verified"}),
  },
  {
    id:"welcome-tour-frame-scenes-diverged",title:"Website versus workspace rehearsal",intent:"welcome",resources:resources("tour:websites","tour:workspaces"),mayStage:true,
    goal:"Check whether the tour really rendered Websites & apps before I hand the demo notes off. The saved scene and displayed slide may have split.",
    first:[frame("tour:websites",{wrongScene:"workspaces"})],
    expected:outcome("tour:websites","tour-frame-mismatch","hold","The saved Websites & apps scene disagrees with the visible capabilities slide.",[/saved|visible|render/iu,/mismatch|disagree|different/iu],{tour:"mismatch"}),
  },
  {
    id:"welcome-held-tour-notes-drawer",split:"test",title:"Automation notes rehearsal",intent:"welcome",resources:resources("tour:automations"),
    goal:"Before I use the automation demo, verify whether the presenter notes actually opened. The persisted notes setting might disagree with the exposed drawer. Don't change the slide.",
    first:[frame("tour:automations",{notes:true,wrongNotes:true})],
    expected:outcome("tour:automations","tour-frame-mismatch","hold","The saved notes state and visible drawer disagree.",[/notes|drawer/iu,/disagree|mismatch/iu],{tour:"mismatch"}),
  },
  {
    id:"welcome-held-selection-from-another-context",split:"test",title:"Local inference copied link",intent:"selection",
    resources:resources(local,defaults),mayStage:true,
    goal:"Can I use the local inference selection for this Personal workspace? The screen has a copied About link. Check the original selection's context before staging a note.",
    first:[select(local,"change",{foreign:true})],
    expected:outcome(local,"wrong-context","hold","The original selection belongs to another context even though the canonical page is familiar.",[/context|workspace/iu,/another|foreign/iu],{setup:"invalid-selection"}),
  },
  {
    id:"welcome-explorer-bounded-utf8-retry",title:"Interrupted UTF-8 demonstration",intent:"refresh",resources:resources(explorer),mayRetry:true,mayStage:true,
    probe:{text:"naïve 🌱",claim:"reports-characters",repeat:false,check:"utf8-size",mismatch:true},
    goal:"Retry our exact interrupted Explorer check on bytes versus characters and leave a local next-step note. Use only the same sample, verify its storage readback and scratch cleanup, and don't publish a finding.",
    first:[check("interrupted")],
    expected:outcome(explorer,"local-retry-complete","stage","The local retry verified exact bytes and cleanup. The character-count claim disagreed with measured UTF-8 bytes.",[/bytes|utf/iu,/cleanup|removed/iu],{probe:true}),
  },
  {
    id:"welcome-explorer-no-double-run",title:"Completed storage sample",intent:"refresh",resources:resources(explorer),mayRetry:true,
    goal:"See whether the Explorer storage sample already finished after the interrupt banner. Retry only if the current receipt still shows an interruption.",
    first:[check("interrupted",{key:"old",stale:true})],later:[check("completed")],
    expected:outcome(explorer,"already-complete","report","The newer Explorer receipt already confirms completion. A duplicate retry was unnecessary.",[/complet|finished/iu,/retry|duplicate/iu]),
  },
  {
    id:"welcome-explorer-read-only-interruption",title:"Interrupted local sample review",intent:"refresh",resources:resources(explorer),
    goal:"Tell me where the Explorer's text roundtrip stopped. I only want the current retained status. Leave the stores and scratch untouched.",
    first:[check("interrupted")],
    expected:outcome(explorer,"retry-unauthorized","hold","The current local probe remains interrupted. No retry is authorized.",[/interrupt/iu,/retry|authoriz|read.only/iu]),
  },
  {
    id:"welcome-held-explorer-line-ending-repeat",split:"test",title:"CRLF retained-sample replay",intent:"refresh",resources:resources(explorer),
    mayRetry:true,probe:{text:"one\r\ntwo\r\n",claim:"normalizes-line-endings",repeat:true,check:"line-endings",mismatch:true},
    goal:"Resume the owned Explorer check on whether repeated storage normalizes CRLF. Compare original bytes and both digests, then explain the result here after cleanup.",
    first:[check("interrupted")],
    expected:outcome(explorer,"local-retry-complete","report","The local retry retained the exact CRLF bytes and same digest on repeat. The normalization claim was contradicted.",[/crlf/iu,/digest|repeat/iu],{probe:true}),
  },
  {
    id:"welcome-held-stale-explorer-retry",split:"test",title:"Stale local check after new setup",intent:"refresh",
    resources:resources(explorer),mayRetry:true,mayStage:true,
    goal:"Retry the Explorer sample only if its interrupted request belongs to the current Personal setup generation. A reopened notebook could be pointing at yesterday's receipt.",
    first:[check("interrupted",{stale:true})],
    expected:outcome(explorer,"stale-receipt","hold","The interrupted request is from an older generation; the current setup cannot retry it.",[/stale|older|generation/iu,/retry/iu]),
  },
];
export const personalWelcomeWorlds: PersonalWelcomeWorld[] = worlds.map(world=>({
  ...world,kind:"personal-welcome",workspace:"personal",sourceGroup:`vibestudio:personal-first-run:${world.id}`,
}));
export const personalWelcomeRequiresUnits = ["skills/open-user-goal","skills/open-personal-welcome","skills/onboarding",
  "skills/explorer-probe","skills/explorer-probe-bindings","skills/tour-rehearsal","panels/tour","skills/scratch-handoff-bindings","workers/pubsub-channel"];
