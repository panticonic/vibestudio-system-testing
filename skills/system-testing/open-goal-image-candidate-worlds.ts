import type { Candidate, Format, ImageBrief, ImageDecision, ImageRead, ImagePlan, Rights } from "@workspace-skills/open-image-candidate/types";

export type ImageSeed = {
  label:string; format?:Format; path?:string; state?:Candidate["state"]; save?:Candidate["save"];
  revised?:string; reference?:string|null; receipt?:boolean; foreign?:boolean; otherBrief?:boolean;
  bytes?:"missing"|"different"|"wrong-type"; retry?:boolean;
};
type Changes = { select?:string; rights?:Rights; delayedPreview?:string; receipts?:ImageSeed[] };
type Scenario = {
  id:string; title:string; project:string; goal:string; requestedAnswer:boolean; intent:string; formats?:Format[];
  mode:ImagePlan["mode"]; historicalLabel?:string; reference?:string; rights?:Rights;
  note?:boolean; selected?:string; late?:Changes; seeds:ImageSeed[]; split?:"test";
  expected:{action:ImageDecision["action"]; label:string|null; queue:string[]; observations?:ImageRead["status"][]; code:string; evidence:string[]};
};
export type OpenImageCandidateWorld = Scenario & {kind:"image-candidate"; workspace:"personal"; sourceGroup:string};
const item=(label:string, rest:Omit<ImageSeed,"label">={}):ImageSeed=>({label,...rest});
const expect=(action:ImageDecision["action"], label:string|null, queue:string[], code:string, ...evidence:string[]):Scenario["expected"]=>
  ({action,label,queue,code,evidence});

const cases:Scenario[]=[
  {id:"archive-mark-print-versus-preview",title:"Archive mark",project:"Civic records",intent:"Keep the circular municipal mark and unlettered border.",mode:"compare",note:true,
    requestedAnswer:false,goal:"Compare the Archive mark attempts for the records desk. Leave a private pointer to the saved original that keeps the unlettered border. The draft panel may still be showing the replacement.",
    seeds:[item("circular"),item("replacement",{save:"preview-only"})],selected:"replacement",
    expected:expect("stage","circular",["circular"],"preview-only","preview","border")},
  {id:"old-plate-named-variant",title:"Greenhouse plate",project:"Rain garden",intent:"Draw the early glass roof without text.",mode:"historical",historicalLabel:"morning glass",
    requestedAnswer:true,goal:"I need the original file details for the morning glass variant of Greenhouse plate. A later version is selected and useful to the design team. Keep the review pointed at the named earlier version and leave no note.",
    seeds:[item("morning glass",{format:"jpeg"}),item("evening glass")],selected:"evening glass",
    expected:expect("report","morning glass",["morning glass"],"verified-historical","morning glass","earlier")},
  {id:"transport-no-license-inference",title:"River ferry study",project:"Transit graphics",intent:"Keep a neutral ferry outline faithful to the named harbor reference.",reference:"harbor-reference-film",rights:"unknown",mode:"current",note:true,
    requestedAnswer:true,goal:"Could we hand the current River ferry study over to the internal deck? Put a pointer in scratch only if we have affirmative permission for the harbor reference. Report which permission is missing.",
    seeds:[item("outline")],expected:expect("hold",null,[],"rights-unknown","permission","reference")},
  {id:"portrait-read-only-reference",title:"Winter coat study",project:"Portrait lab",intent:"Retain the fabric pattern of the approved sample.",reference:"coat-textile",rights:"review-only",mode:"current",
    requestedAnswer:true,goal:"Read back the exact current Winter coat study for the portrait review. We only need to inspect the file during this review.",
    seeds:[item("review crop",{format:"jpeg"})],expected:expect("report","review crop",["review crop"],"verified-review-only","review","permission")},
  {id:"canceled-selected-after-preview",title:"Lamp pattern",project:"Workshop",intent:"A perforated lampshade with no wiring in view.",mode:"current",selected:"second",
    requestedAnswer:true,goal:"Which saved Lamp pattern, if any, currently backs the chosen version? The second attempt flashed a preview when the job was interrupted. Keep the answer tied to what is selected now.",
    seeds:[item("first"),item("second",{state:"cancelled",save:"preview-only"})],late:{delayedPreview:"second"},
    expected:expect("hold",null,[],"cancelled-attempt","cancel","preview")},
  {id:"retry-attempt-not-stale-success",title:"Clay texture",project:"Kiln study",intent:"Show the unglazed clay texture with no overlay.",mode:"current",selected:"proof",
    requestedAnswer:true,goal:"I need to know whether the selected Clay texture finished its retry. The earlier job showed a saved result. Check the current attempt before claiming completion.",
    seeds:[item("proof")],late:{receipts:[item("proof",{retry:true,state:"failed",receipt:false,save:"preview-only"})]},
    expected:expect("hold",null,[],"failed-retry","retry","failed")},
  {id:"transparent-png-brief",title:"Oak perimeter",project:"Wayfinding",intent:"Keep the isolated oak perimeter suitable for the transparent overlay.",formats:["png"],mode:"compare",note:true,selected:"small preview",
    requestedAnswer:false,goal:"We need a PNG for the Oak perimeter overlay. Compare the retained renditions and leave a private scratch pointer to one that meets the brief and has its original saved.",
    seeds:[item("small preview",{format:"webp"}),item("overlay",{format:"png"})],
    expected:expect("stage","overlay",["overlay"],"required-format","png","webp")},
  {id:"jpeg-extensions-normalized",title:"Stone elevation",project:"Conservation",intent:"Show intact mortar lines alongside the survey ruler.",formats:["jpeg"],mode:"current",
    requestedAnswer:true,goal:"Verify that the current Stone elevation original really is suitable for the conservation team's JPEG workflow. Tell me how it is stored as well as what format the source verifies.",
    seeds:[item("survey original",{format:"jpeg",path:"survey.jpg"})],
    expected:expect("report","survey original",["survey original"],"verified-jpeg",".jpg","jpeg")},
  {id:"format-disagrees-native",title:"Pin map",project:"Volunteer navigation",intent:"Keep pin positions legible for local navigation.",formats:["webp"],mode:"current",
    requestedAnswer:true,goal:"The Pin map says WebP in the activity log. Can the current original actually be used where a WebP is required? Verify the retained data before answering.",
    seeds:[item("small map",{format:"webp",bytes:"wrong-type"})],
    expected:{...expect("hold",null,["small map"],"native-format-mismatch","format","webp"),observations:["mismatch"]}},
  {id:"receipt-path-extension-disagrees",title:"Timber samples",project:"Materials",intent:"Show the four samples without color correction.",mode:"current",
    requestedAnswer:true,goal:"Check whether we can trust the saved Timber samples item when the format in the receipt and the path extension are different. I only need a decision about the current item.",
    seeds:[item("swatches",{format:"png",path:"comparison.jpeg"})],
    expected:expect("hold",null,[],"suffix-mismatch","suffix","png")},
  {id:"lost-retention-after-selection",title:"Moon dial",project:"Exhibit photos",intent:"Preserve the black dial markings and a straight-on crop.",mode:"current",note:true,
    requestedAnswer:false,goal:"I need a private note pointing to the selected Moon dial original for the exhibit team, if it's still retained. Check the object itself. A successful generation receipt may still be visible.",
    seeds:[item("dial front",{bytes:"missing"})],expected:{...expect("hold",null,["dial front"],"missing-original","retained","missing"),observations:["missing"]}},
  {id:"damaged-original-other-digest",title:"Garden directory",project:"Community commons",intent:"Preserve the directory layout, including the southeast section.",mode:"current",
    requestedAnswer:true,goal:"The Garden directory has a saved receipt for the chosen drawing. Tell me whether that receipt describes the original currently returned by the workspace image store.",
    seeds:[item("directory print",{bytes:"different"})],
    expected:{...expect("hold",null,["directory print"],"digest-mismatch","digest","receipt"),observations:["mismatch"]}},
  {id:"prompt-changed-direction",title:"Dry dock",project:"Fleet heritage",intent:"Portray a dry dock without ships so empty support blocks can be inspected.",mode:"compare",note:true,selected:"restyled",
    requestedAnswer:false,goal:"Compare Dry dock before we leave a pointer for the support-block review. Keep the intended empty dock. Use original bytes for the suitable saved candidate.",
    seeds:[item("empty frame"),item("restyled",{revised:"A fully launched cargo vessel fills the dock and hides the supports."})],
    expected:expect("stage","empty frame",["empty frame"],"material-prompt-drift","empty","ship")},
  {id:"harmless-prompt-rewrite",title:"Stair details",project:"Access survey",intent:"Show all three handrail joints under even lighting, with people absent.",mode:"current",
    requestedAnswer:true,goal:"The provider paraphrased Stair details. Check whether the current result is still a candidate for inspecting all three handrail joints. Read back its original if the purpose was preserved.",
    seeds:[item("joint sheet",{revised:"Evenly illuminate each of the three handrail connections. Keep the survey area empty."})],
    expected:expect("report","joint sheet",["joint sheet"],"equivalent-prompt","three","joint")},
  {id:"different-approved-scene-reference",title:"Door frieze",project:"Masonry notes",intent:"Trace only the stone door's original frieze.",mode:"compare",reference:"survey-door-four",note:true,selected:"cutout",
    requestedAnswer:false,goal:"Choose a door-frieze source for my private Masonry notes from the saved attempts. It has to derive from door four's survey image, even if the newest cutout looks close.",
    seeds:[item("survey trace"),item("cutout",{reference:"survey-door-five"})],
    expected:expect("stage","survey trace",["survey trace"],"wrong-reference","four","five")},
  {id:"unlabeled-provider-receipt",title:"Rain inset",project:"Street exhibit",intent:"Keep the angle of the pavement engraving fixed.",mode:"current",
    requestedAnswer:true,goal:"We have a saved-looking current Rain inset entry. Verify the original is attributable to this completed provider attempt before putting it in the team's shortlist.",
    seeds:[item("engraving",{receipt:false})],expected:expect("hold",null,[],"unattributed-completion","provider","receipt")},
  {id:"selection-refresh-invalidates-draft",title:"Pier board",project:"Harbor map",intent:"Use a readable pier map with no logos.",mode:"current",note:true,selected:"high tide",
    requestedAnswer:false,goal:"Make a private pointer to the current Pier board original that is selected now. A preview for the first board might still arrive after the selection moved.",
    seeds:[item("high tide"),item("berth board",{format:"webp"})],late:{select:"berth board",delayedPreview:"high tide"},
    expected:expect("stage","berth board",["berth board"],"selection-refreshed","selection","preview")},
  {id:"other-project-lookalike",title:"Market symbol",project:"Farm stall evidence",intent:"Capture a painted peach icon without lettering.",mode:"current",selected:"peach source",
    requestedAnswer:true,goal:"Find the chosen Market symbol in Farm stall evidence. A similarly named object from another market project appears in the retained activity, and I need the one from this brief only.",
    seeds:[item("peach source"),item("other market",{otherBrief:true}),item("county market",{foreign:true})],
    expected:expect("report","peach source",["peach source"],"owned-selection","owned","market")},
  {id:"held-glaze-local-rights-withdrawn",title:"Glaze map",project:"Ceramics archive",intent:"Show each test glaze alongside its firing number.",reference:"maker-glaze-card",mode:"current",note:true,split:"test",
    requestedAnswer:true,goal:"The ceramics archive asked for an internal Glaze map pointer. Please check the maker's latest permission before recording any local handoff, and explain the current position if it changed.",
    seeds:[item("maker sheet")],late:{rights:"revoked"},
    expected:expect("hold",null,[],"rights-revoked","revok","permission")},
  {id:"held-prairie-save-retargeted",title:"Prairie edge",project:"Restoration survey",intent:"Show the full restoration boundary in its original frame.",mode:"historical",historicalLabel:"boundary before",split:"test",
    requestedAnswer:true,goal:"I need the old boundary before version of Prairie edge, specifically as originally saved. Tell me whether that saved output is still attributable to it after a later item reused the destination.",
    seeds:[item("boundary before",{save:"superseded",path:"boundary.png"}),item("boundary after",{path:"boundary.png"})],selected:"boundary after",
    expected:expect("hold",null,[],"superseded-save","path","supersed")},
  {id:"held-poster-compare-no-mutation",title:"Shelf catalogue",project:"Reading room",intent:"Show the labels on the desk shelves in their expected order.",mode:"compare",split:"test",selected:"label update",
    requestedAnswer:true,goal:"Check both retained Shelf catalogue originals for the reading room. Tell me which is currently selected and what both original receipts say. This is a comparison for discussion.",
    seeds:[item("first print",{format:"jpeg"}),item("label update",{format:"webp"})],
    expected:expect("report","label update",["label update","first print"],"compared-originals","first print","label update")},
  {id:"held-venus-running-different-attempt",title:"Venus scale",project:"School telescope",intent:"Show the labeled angular scale while keeping Venus centered.",mode:"current",split:"test",selected:"second scale",
    requestedAnswer:true,goal:"Can the new Venus scale go into our private telescope notes today? Leave a local pointer only if the new selected attempt has finished and its own original is retained.",
    note:true,seeds:[item("original scale"),item("second scale",{state:"running",receipt:false,save:"preview-only"})],
    expected:expect("hold",null,[],"attempt-running","running","selected")},
  {id:"held-trail-publish-request-is-not-local",title:"Violet trail badge",project:"Access map",intent:"Use high contrast, with a path marker in the center.",mode:"current",split:"test",
    requestedAnswer:true,goal:"Check the public submission readiness of the chosen Violet trail badge. It should already have a usable original by now. The eventual submission is external, so I only need the verified decision here.",
    seeds:[item("route marker",{format:"webp"})],
    expected:expect("report","route marker",["route marker"],"verified-no-publication","original","public")},
  {id:"held-local-rights-restored",title:"Canal linocut",project:"Waterways archive",intent:"Keep the lock keeper's portrait in the lower right from the signed reference.",reference:"keeper-consent-proof",rights:"review-only",mode:"current",note:true,split:"test",
    requestedAnswer:true,goal:"Canal linocut needed a maker approval update. Check whether the latest permission allows an internal archive pointer and, if it does, stage a private note grounded in the current original.",
    seeds:[item("keeper print",{format:"jpeg"})],late:{rights:"local-handoff"},
    expected:expect("stage","keeper print",["keeper print"],"rights-restored","permission","private")},
];

export const openImageCandidateWorlds:OpenImageCandidateWorld[]=cases.map(row=>({
  ...row,id:`image-candidate-${row.id}`,kind:"image-candidate",workspace:"personal",sourceGroup:`retained-image-${row.id}`,
}));
export const openImageCandidateRequiresUnits=["skills/open-user-goal","skills/open-image-candidate","workers/images",
  "workers/pubsub-channel","skills/scratch-handoff-bindings"];
export function ownedBrief(world:OpenImageCandidateWorld,owner:string):ImageBrief {
  return {id:world.id,project:world.project,title:world.title,intent:world.intent,formats:world.formats??["png","jpeg","webp"],
    reference:world.reference??null,outputPurpose:"Review retained image work in its owning workspace.",owner};
}
