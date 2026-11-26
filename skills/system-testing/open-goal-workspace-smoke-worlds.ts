type Choice = "accepted" | "regression" | "hold-source" | "hold-ambiguity" | "hold-export";
export type ProbeKind = "inline" | "session" | "suggestions" | "completion" | "launcher";
type Entry = { id: string; title: string; aliases?: string[]; keywords?: string[]; visibility?: "hidden" | "disabled";
  args?: { name: string; label: string; type: "enum" | "string" | "number"; required: boolean; options?: { value: string; label: string }[] }[] };
type Input = { query?: string; commands?: Entry[]; actions?: { type: string; value?: string }[];
  seed?: Record<string,string>; seedQuery?: string; url?: string; limit?: number };
export type SmokeWorld = {
  id: string; kind: "workspace-smoke"; workspace: "system"; sourceGroup: string; split?: "test"; subject: string; goal: string;
  probe: ProbeKind; input: Input; runtime: unknown; accepted: unknown; source: "unique" | "stale" | "ambiguous" | "missing";
  mayStage: boolean; unavailableExport: boolean; expected: Choice; requestedAnswerRequired:boolean; noteRequest:"none"|"if-accepted";
};
type Options = { requestedAnswerRequired?:boolean; noteRequest?:"none"|"if-accepted"; held?: true; mayStage?: boolean; source?: SmokeWorld["source"]; unavailableExport?: true;
  acceptance?: { data: unknown } };
function world(id: string, subject: string, goal: string, probe: ProbeKind, input: Input, runtime: unknown, options: Options = {}): SmokeWorld {
  const source = options.source ?? "unique", accepted = options.acceptance ? options.acceptance.data : runtime;
  const expected = source === "ambiguous" ? "hold-ambiguity" : source !== "unique" ? "hold-source" : options.unavailableExport ?
    "hold-export" : options.acceptance ? "regression" : "accepted";
  return { id: "workspace-smoke-" + id, kind: "workspace-smoke", requestedAnswerRequired:options.requestedAnswerRequired??true,noteRequest:options.noteRequest??"none", workspace: "system",
    sourceGroup: "vibestudio:workspace-smoke:" + id, ...(options.held ? { split: "test" } : {}),
    subject, goal, probe, input, runtime, accepted, source, expected, mayStage: options.mayStage ?? false,
    unavailableExport: options.unavailableExport ?? false };
}
const free = (name: string, required = true) => ({ name, label: name, type: "string" as const, required });
const number = (name: string) => ({ name, label: name, type: "number" as const, required: true });
const enumerated = (name: string, values: string[], required = true) => ({
  name, label: name, type: "enum" as const, required, options: values.map(value=>({value,label:value})),
});
const command = (id:string,title:string,args?:Entry["args"],extra:Partial<Entry>={})=>({id,title,args,...extra});
const move = command("move","Move panel",[enumerated("side",["left","right"])],{aliases:["shift view"]});
const ask = command("ask","Ask teammate",[free("query")],{aliases:["ask"]});
const review = command("review","Review note",[free("lane"), free("summary",false)]);
const tag = command("tag","Tag shift",[number("slot"),free("label",false)]);
const input = (value:string) => ({ type:"input",value });
const enter = (value?:string)=>({type:"enter",...(value===undefined?{}:{value})});
const draft = (at:string, filled:Record<string,string>, query="", error:string|null=null) => ({ kind:"session", at, filled, query, error });
const execute = (filled:Record<string,string>)=>({kind:"execute",filled});
export const openWorkspaceSmokeRequiresUnits = [
  "skills/open-user-goal","skills/workspace-dev","skills/sandbox","skills/system-testing","workers/system-test-runner","packages/omnibox-core",
];
export const openWorkspaceSmokeWorlds = [
  world("approve-move-alias-with-resolved-enum","Panel movement",
    "Can we sign off the local panel movement shortcut after the alias update? Find the approved test and keep an acceptance note only if it still chooses the intended side.",
    "inline",{commands:[move],query:"shift view ri"},{id:"move",head:"shift view",filled:{side:"right"},residual:"",complete:true},{requestedAnswerRequired:true,noteRequest:"if-accepted",mayStage:true}),
  world("free-text-not-just-first-token","Teammate lookup",
    "Check the installed Ask teammate shortcut against our current test. I need to know whether it keeps the full question before we record a local pass.",
    "inline",{commands:[ask],query:"ask where is the parcel"},{id:"ask",head:"ask",filled:{query:"where is the parcel"},residual:"",complete:true},{requestedAnswerRequired:true,noteRequest:"none",mayStage:true}),
  world("short-prefix-should-stay-in-ranking","Sidebar movement",
    "The Sidebar test expects a partial typed command to stay in suggestions instead of consuming an argument. Verify the current package against the approved note.",
    "inline",{commands:[move],query:"mo right"},null,{requestedAnswerRequired:true,noteRequest:"none"}),
  world("invalid-direction-preserves-query","Desk navigation",
    "Our Desk navigation review was held because an invalid direction could disappear. Check whether the installed shortcut keeps the unrecognized input.",
    "inline",{commands:[move],query:"move upward"},{id:"move",head:"move",filled:{},residual:"upward",complete:false},{requestedAnswerRequired:true,noteRequest:"none"}),
  world("longest-accepted-command-wins","Main deck moves",
    "The Main deck has a general move command and a focused panel command. Run the accepted check before filing a pass for the exact operation.",
    "inline",{commands:[command("generic","Move",[free("target")]),move],query:"move panel left"},
    {id:"move",head:"move panel",filled:{side:"left"},residual:"",complete:true},{requestedAnswerRequired:false,noteRequest:"if-accepted",mayStage:true}),
  world("bare-command-does-not-start-inline-args","Desk labels",
    "Someone thinks typing the bare Desk label command immediately resolves its arguments. Verify the current installed behavior and point out any conflict with the accepted note.",
    "inline",{commands:[command("label","Label",[free("name")])],query:"label"},null,{requestedAnswerRequired:true,noteRequest:"none",acceptance:{data:{id:"label",complete:true}},mayStage:true}),
  world("optional-argument-skipped-without-empty-value","Review notes",
    "Before we use Review notes for shift handoff, check what happens when the reviewer supplies the lane and deliberately skips the optional note.",
    "session",{commands:[review],actions:[enter("evening"),enter()]},execute({lane:"evening"}),{requestedAnswerRequired:true,noteRequest:"none",mayStage:true}),
  world("missing-required-keeps-prompt-open","Badge handoff",
    "Please check the Badge handoff prompt when the operator submits an empty required field. Keep the project unchanged.",
    "session",{commands:[review],actions:[enter()]},draft("lane",{},"","lane is required."),{requestedAnswerRequired:true,noteRequest:"none"}),
  world("backspace-reopens-last-chip","Cabinet review",
    "The Cabinet review operator needs to correct the earlier lane selection without losing it from the prompt. Validate the accepted correction scenario locally.",
    "session",{commands:[review],actions:[enter("archive"),{type:"backspace"}]},draft("lane",{},"archive"),{requestedAnswerRequired:true,noteRequest:"none",mayStage:true}),
  world("escape-restores-nominated-query","Reading room tags",
    "Does backing out of the Reading room tag prompt leave the original search exactly as the operator typed it? File a pass only if the installed reducer confirms it.",
    "session",{commands:[tag],query:">tag shift 2",actions:[{type:"escape"}]},
    {kind:"exit",restoreQuery:">tag shift 2"},{requestedAnswerRequired:true,noteRequest:"if-accepted",mayStage:true}),
  world("invalid-number-then-correction","Supply queue control",
    "Check whether the Supply queue control can recover from an invalid slot and preserve the corrected number when the operator skips its optional label.",
    "session",{commands:[tag],actions:[enter("later"),input("7"),enter(),enter()]},execute({slot:"7"}),{requestedAnswerRequired:true,noteRequest:"none"}),
  world("contradictory-document-on-backspace","Collection review",
    "The current Collection review note says Backspace drops the old value permanently. Verify that exact claim against the installed package before signing off.",
    "session",{commands:[review],actions:[enter("desk A"),{type:"backspace"}]},draft("lane",{},"desk A"),
    {requestedAnswerRequired:true,noteRequest:"none",acceptance:{data:draft("lane",{})},mayStage:true}),
  world("hidden-command-not-present","Archive export search",
    "Verify the approved Archive export check that hides a command outside this surface while leaving the available one discoverable.",
    "suggestions",{commands:[command("hidden-export","Export archive",undefined,{visibility:"hidden"}),command("owned-export","Export note")],query:"export"},
    [{id:"owned-export",disabled:false}],{requestedAnswerRequired:true,noteRequest:"none",mayStage:true}),
  world("disabled-command-visible-below-ready","Library search actions",
    "The Library review distinguishes a disabled command from a hidden one. Check order and state in the current package before accepting the local result.",
    "suggestions",{commands:[command("dis","Read note",undefined,{visibility:"disabled"}),command("ok","Read note")],query:"read"},
    [{id:"ok",disabled:false},{id:"dis",disabled:true}],{requestedAnswerRequired:true,noteRequest:"none",mayStage:true}),
  world("keyword-weak-match-with-limit","Documentation actions",
    "The approved Documentation check keeps one result. Verify that a title match keeps its place above a keyword-only alternative.",
    "suggestions",{commands:[command("other","Copy text",undefined,{keywords:["draft"]}),command("right","Draft release")],query:"draft",limit:1},
    [{id:"right",disabled:false}],{requestedAnswerRequired:true,noteRequest:"none"}),
  world("completion-without-duplicating-scheme","Workspace handbook",
    "The handbook address was saved with a full URL, but the operator types only the host. Check the exact suggested completion against our latest local test.",
    "completion",{query:"handbook",url:"https://www.handbook.invalid/setup"},"handbook.invalid/setup",{requestedAnswerRequired:true,noteRequest:"none",mayStage:true}),
  world("completion-unmatched-query","Calendar shortcuts",
    "Check whether the Calendar shortcut test suppresses unrelated address completions instead of changing an expression the operator typed.",
    "completion",{query:"inventory",url:"https://calendar.invalid/view"},null,{requestedAnswerRequired:true,noteRequest:"none"}),
  world("launcher-chat-scope-trims-separator","Utility chat shortcut",
    "The Utility shortcut should enter the chat scope and keep the rest of the typed message while dropping the separator. Find and witness the approved test.",
    "launcher",{query:"/   ask for help"},{mode:"chat",prefix:"/",query:"ask for help"},{requestedAnswerRequired:true,noteRequest:"none",mayStage:true}),
  world("listed-document-not-current-approved","Archive note lookup",
    "The Archive note smoke may only survive in a previous release. Confirm whether the current accepted plan can still be found before loading anything.",
    "inline",{commands:[move],query:"move left"},{id:"move",head:"move",filled:{side:"left"},residual:"",complete:true},{requestedAnswerRequired:true,noteRequest:"none",source:"stale",held:true}),
  world("two-current-conflicting-docs","Intake launcher",
    "We may have accidentally approved two Intake launcher smoke notes. Find the current authoritative test before compiling a QA receipt.",
    "launcher",{query:"@ current"},{mode:"goto",prefix:"@",query:"current"},{requestedAnswerRequired:true,noteRequest:"none",held:true,source:"ambiguous",mayStage:true}),
  world("no-discovered-current-spec-from-neighbor","Review panel",
    "Recover the accepted Review panel smoke for this revision. If only a lookalike neighboring note survives, keep the run on hold.",
    "session",{commands:[review],actions:[enter("north")]},draft("summary",{lane:"north"}),{requestedAnswerRequired:true,noteRequest:"none",held:true,source:"missing"}),
  world("removed-export-is-visible-runtime-hold","Setup sequence",
    "The setup acceptance note still names an export that may have disappeared. Inspect what is actually available in the installed package before giving a pass.",
    "session",{commands:[review],actions:[enter("closed")]},draft("summary",{lane:"closed"}),{requestedAnswerRequired:true,noteRequest:"none",held:true,unavailableExport:true,mayStage:true}),
  world("fresh-input-clears-required-error","Range check",
    "Verify that starting to correct an empty Range check prompt clears its warning while leaving it open. Report the actual current behavior.",
    "session",{commands:[review],actions:[enter(),input("east")]},draft("lane",{},"east"),{requestedAnswerRequired:true,noteRequest:"none",held:true}),
  world("no-scheme-search-not-an-address","Permit tracker",
    "Run the current Permit tracker completion regression. Operators deliberately type an unrelated identifier and expect the saved route not to replace it.",
    "completion",{query:"permit-Q",url:"https://www.permit.invalid/report"},null,{requestedAnswerRequired:true,noteRequest:"none",held:true,mayStage:true}),
  world("held-ui-ranking-slate-claimed-too-many","Shift shortcuts",
    "The accepted Shift shortcuts plan says this query shows both options. Check whether the installed suggestion limit actually permits that before writing any smoke receipt.",
    "suggestions",{commands:[command("confirm","Shift confirm"),command("review","Shift review")],query:"shift",limit:1},
    [{id:"confirm",disabled:false}],{requestedAnswerRequired:true,noteRequest:"none",held:true,acceptance:{data:[{id:"confirm",disabled:false},{id:"review",disabled:false}]},mayStage:true}),
  world("held-inline-tail-not-discarded","Parcel direction",
    "The Parcel shortcut has one reviewed direction option. Check whether extra words are retained as input needing review instead of silently accepting the move.",
    "inline",{commands:[move],query:"move right later"},{id:"move",head:"move",filled:{side:"right"},residual:"later",complete:false},
    {requestedAnswerRequired:true,noteRequest:"none",held:true,mayStage:true}),
] satisfies SmokeWorld[];
