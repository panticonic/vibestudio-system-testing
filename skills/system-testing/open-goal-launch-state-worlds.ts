type Change=Record<string,unknown>;
type World={
  id:string;title:string;goal:string;
  policy:"apply"|"readonly"|"test-rejection"|"hold-if-moved"|"preserve-other";
  patch:Change;advance?:Change;replaceEntry?:boolean;note?:boolean;split?:"test";
  outcome:"confirmed"|"held"|"applied"|"rejected";
};
const cases:World[]=[
  {id:"sort-queue-only",title:"Bus queue",goal:"Switch the working Bus queue panel from oldest-first to newest-first for the next operator. Keep its pinned stops and owner.",
    policy:"apply",patch:{settings:{order:"desc"}},outcome:"applied"},
  {id:"remove-obsolete-lane-label",title:"Passenger lanes",goal:"On the active Passenger lanes panel, clear the expired temporary label. Leave its owning team and launch mode unchanged. Keep a private change note.",
    policy:"apply",patch:{label:null},outcome:"applied",note:true},
  {id:"replace-order-without-copying-archive",title:"Volunteer desk",goal:"Change the active Volunteer desk panel pins to exactly captain, then supplies, and check that the similarly named record was untouched.",
    policy:"apply",patch:{settings:{pins:["captain","supplies"]}},outcome:"applied"},
  {id:"retain-independent-owner-side-move",title:"East entrance",goal:"Change the active East entrance panel to detail mode. If the owner independently moves its pinned side while you work, preserve their change and leave a private readback.",
    policy:"preserve-other",patch:{mode:"detail"},advance:{settings:{side:"east"}},outcome:"applied",note:true},
  {id:"same-key-moved-in-working-panel",title:"Rehearsal board",goal:"Prepare a detail-mode launch on Rehearsal board, only while the observed launch mode still matches its opening state. Keep a private decision if the operator already chose a different mode.",
    policy:"hold-if-moved",patch:{mode:"detail"},advance:{mode:"quiet"},outcome:"held",note:true},
  {id:"count-current-value-readonly",title:"Inventory bins",goal:"Inventory bins and its archive share a title. Determine the active launch count and its exact saved slot. Leave all settings as they are.",
    policy:"readonly",patch:{},outcome:"confirmed"},
  {id:"required-owner-deletion-tested",title:"Loan cabinet",goal:"In the disposable Loan cabinet panel, check whether clearing the required owner can succeed. If rejected, verify the entire saved state is still intact and keep a private note.",
    policy:"test-rejection",patch:{owner:null},outcome:"rejected",note:true},
  {id:"whole-patch-fails-on-bad-mode",title:"Recording log",goal:"Try setting the disposable Recording log panel to live mode and a count of seven in one submitted change. If the mode is rejected, show whether the count was protected.",
    policy:"test-rejection",patch:{mode:"live",count:7},outcome:"rejected"},
  {id:"min-bound-tests-no-fallback",title:"Reading seats",goal:"Check whether the disposable Reading seats panel accepts a zero launch count. Avoid substituting another number, and privately record what the actual state owner does.",
    policy:"test-rejection",patch:{count:0},outcome:"rejected",note:true},
  {id:"coerce-string-to-count",title:"Badge printer",goal:"Set Badge printer's launch count to six using the text value '6' from its configuration form. Verify the saved numeric value and keep its other controls intact.",
    policy:"apply",patch:{count:"6"},outcome:"applied"},
  {id:"clear-nested-note-keep-neighbors",title:"Market supply",goal:"Remove the outdated nested routing note from Market supply. Keep the same side, ordering and pins. Verify the exact persisted result.",
    policy:"apply",patch:{settings:{lastNote:null}},outcome:"applied"},
  {id:"empty-list-means-empty",title:"Cart routes",goal:"Clear every launch pin on Cart routes. Leave an explicit empty pins list rather than removing its setting. Keep a private record.",
    policy:"apply",patch:{settings:{pins:[]}},outcome:"applied",note:true},
  {id:"unknown-nested-setting-is-rejected",title:"Parking review",goal:"Try the obsolete nested parking camera switch only on this disposable review panel. Confirm whether the current schema admits it without changing any other launch state.",
    policy:"test-rejection",patch:{settings:{camera:true}},outcome:"rejected"},
  {id:"preserve-late-badge-while-replacing-pins",title:"Dispatch doors",goal:"Set Dispatch doors pins to north and east. The operator may add a temporary launch label during your review. Preserve their label and verify both results privately.",
    policy:"preserve-other",patch:{settings:{pins:["north","east"]}},advance:{label:"operator check"},outcome:"applied",note:true},
  {id:"active-value-already-edited-read-only",title:"Load counter",goal:"Read the active Load counter after the floor operator updates the launch count. Explain what actually persisted and keep a private handoff without another state change.",
    policy:"readonly",patch:{},advance:{count:10},outcome:"confirmed",note:true},
  {id:"hold-on-operator-new-pin-list",title:"Library returns",goal:"Reuse the Library returns start-of-shift pin plan only if the active list is still the one you initially read. If another operator replaced it, leave it intact.",
    policy:"hold-if-moved",patch:{settings:{pins:["desk","archive"]}},advance:{settings:{pins:["special returns"]}},outcome:"held"},
  {id:"authorized-quiet-and-count-together",title:"Coat check",goal:"For Coat check's active launch, set quiet mode and count eight together. Verify both saved values and preserve the owner's pinned locations.",
    policy:"apply",patch:{mode:"quiet",count:8},outcome:"applied"},
  {id:"nested-required-deletion-atomic",title:"Supply balances",goal:"Check whether the disposable Supply balances launch will accept deleting the required side while also changing the order. Verify the entire rejected or committed pair without compensating changes.",
    policy:"test-rejection",patch:{settings:{side:null,order:"desc"}},outcome:"rejected"},
  {id:"held-replaced-entry-even-with-same-name",title:"Stage entry",goal:"Switch the Stage entry panel to the east side only if it is still the original launch entry. A new entry with the same title and policy value cannot inherit this approval. Keep a private decision.",
    policy:"hold-if-moved",patch:{settings:{side:"east"}},replaceEntry:true,outcome:"held",note:true,split:"test"},
  {id:"held-coerce-max-with-late-sibling",title:"Meter reading",goal:"Set the Meter reading count from the '12' text in the setup note, while preserving the late change to the owner's secondary routing note. Verify the durable values.",
    policy:"preserve-other",patch:{count:"12"},advance:{settings:{lastNote:"retain this route"}},outcome:"applied",split:"test"},
  {id:"held-mutator-response-without-rerender",title:"Workshop board",goal:"The Workshop board need only save the next quiet startup, even if nothing about the live renderer was observed. Set quiet and leave a private receipt based on owner storage.",
    policy:"apply",patch:{mode:"quiet"},outcome:"applied",note:true,split:"test"},
  {id:"held-validation-rejects-one-key-protects-siblings",title:"Training schedule",goal:"Try adding the outdated training room key with a new pin list on the disposable Training schedule. If the key is unsupported, verify that none of the new pins were committed.",
    policy:"test-rejection",patch:{room:"archive",settings:{pins:["review"]}},outcome:"rejected",split:"test"},
  {id:"held-same-title-newer-archive-untrusted",title:"Electrical inspection",goal:"The archived Electrical inspection has a newer temporary label. Read the active owner-selected launch policy and exact revision without borrowing the archive's value. Keep a private note.",
    policy:"readonly",patch:{},outcome:"confirmed",note:true,split:"test"},
  {id:"held-replace-list-and-remove-only-temp-label",title:"Terms desk",goal:"Replace Terms desk live launch pins with service and breaks, and remove its temporary launch label. Keep the order and owning team from the active saved entry. Verify both changes.",
    policy:"apply",patch:{settings:{pins:["service","breaks"]},label:null},outcome:"applied",split:"test"},
];
export type OpenLaunchStateWorld=World&{kind:"launch-state";workspace:"system";sourceGroup:string};
export const openLaunchStateWorlds:OpenLaunchStateWorld[]=cases.map(row=>({...row,id:`launch-state-${row.id}`,
  kind:"launch-state",workspace:"system",sourceGroup:`vibestudio:owned-launch-state:${row.id}`}));
export const openLaunchStateRequiresUnits=["skills/open-user-goal","skills/open-panel-launch-state","skills/capabilities","panels/launch-state-fixture"];
