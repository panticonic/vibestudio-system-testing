import type { ArticleEvidence, BriefingEvidence, CadenceIntent, ReaderSelection } from "@workspace-skills/open-news-evidence/types";

type Article = { key:string;path:string;text:string;type?:ArticleEvidence["type"];supports?:string[];muted?:boolean;saved?:boolean;
  backlog?:boolean;foreign?:boolean;otherTopic?:boolean;missing?:boolean };
type Edition = { phase?:BriefingEvidence["phase"];claims?:{id:string;text:string}[];previous?:string[];declared?:number };
type Reader = { allowed?:boolean;stale?:boolean;foreign?:boolean;unconfigured?:boolean;feedsFailed?:boolean };
type Lane = { mode?:"curator"|"analyst";paused?:boolean;poll?:number|null;briefing?:{at:string;timezone:string}|{interval:number}|null };
export type OpenNewsEvidenceWorld = {
  kind:"news-evidence";workspace:"news";id:string;sourceGroup:string;split?:"test";goal:string;desk:string;topic:string;
  views:ReaderSelection["kind"][];focus?:BriefingEvidence["focus"];privateNote?:boolean;retarget?:boolean;
  reader?:Reader;latestReader?:Reader;cadence?:Lane;latestCadence?:Lane;intent?:CadenceIntent;edition?:Edition;latestEdition?:Edition;
  articles:Article[];lateArticles?:Article[]; noEdition?:boolean;
  expected:{reason:string;action:"report"|"hold"|"stage";schedule:string;explanation:string;claims:RegExp[]};
};
type Authored=Omit<OpenNewsEvidenceWorld,"kind"|"workspace"|"sourceGroup">;
const primary=(key:string,path:string,text:string,opts:Partial<Article>={}):Article=>({key,path,text,supports:["new"],...opts});
const mirror=(key:string,path:string,text:string,opts:Partial<Article>={}):Article=>primary(key,path,text,{type:"syndication",...opts});
const expect=(reason:string,action:OpenNewsEvidenceWorld["expected"]["action"],explanation:string,claims:RegExp[],
    schedule="manual-available"):OpenNewsEvidenceWorld["expected"]=>({reason,action,explanation,claims,schedule});
const worlds:Authored[]=[
  {
    id:"news-evidence-closure-not-mirrors",desk:"River desk",topic:"Bridge closure",views:["saved","archive"],privateNote:true,
    goal:"Compare our saved and archived Bridge closure reporting. Prepare a private handoff based on the original closure notice, and account for copies that shouldn't count as separate readings.",
    articles:[primary("notice","/river/bridge","Bridge closure starts at 19:00 Friday.",{saved:true}),
      mirror("syndicated","/river/copy","Bridge closure starts at 19:00 Friday.")],edition:{declared:1},
    expected:expect("grounded-development","stage","The original closure notice supports the story. The syndicated copy does not count independently.",[/notice|original/iu,/copy|syndicat/iu]),
  },
  {
    id:"news-evidence-archive-after-pause",desk:"Council desk",topic:"Budget minutes",views:["archive","inbox"],
    goal:"The Budget minutes are in the archive but today's inbox seems quiet. Check whether the owner is paused and whether a manual review remains possible. Use the actual minutes in the recap.",
    cadence:{paused:true},edition:{declared:1},articles:[primary("minutes","/council/minutes","The street lighting appropriation stays unchanged.",{backlog:true})],
    expected:expect("grounded-development","report","The archived minutes are grounded. Automatic delivery is paused and manual review remains available.",[/archive|minutes/iu,/pause/iu,/manual/iu]),
  },
  {
    id:"news-evidence-triage-independent-saved",desk:"Mobility desk",topic:"Ferry schedule",views:["backlog","saved"],
    goal:"Reconcile the Ferry schedule backlog and the saved bulletin. Tell me why those counts can differ and which original bulletin supports our summary.",
    edition:{declared:1},articles:[primary("bulletin","/ferry/plan","The ferry moves to a winter timetable.",{saved:true}),
      primary("queue","/ferry/queue","Public input remains open.",{type:"secondary",backlog:true,supports:[]})],
    expected:expect("grounded-development","report","The saved bulletin grounds the timetable. The untriaged backlog is separate.",[/saved/iu,/backlog|triage/iu]),
  },
  {
    id:"news-evidence-missing-primary-bytes",desk:"Planning desk",topic:"Station design",views:["inbox","archive"],privateNote:true,
    goal:"The Station design digest names an official drawing and a commentary. Check the original retained bytes before making an evidence note. Hold if we only have commentary.",
    edition:{declared:1},articles:[primary("draw","/planning/design","Plan B uses the existing platform.",{missing:true}),
      primary("note","/planning/commentary","The station design debate continues.",{type:"secondary"})],
    expected:expect("primary-read-missing","hold","Retained commentary cannot replace missing bytes from the primary drawing.",[/primary|original/iu,/missing|commentary/iu]),
  },
  {
    id:"news-evidence-analyst-lane-scope",desk:"Court desk",topic:"Hearing order",views:["saved","archive"],
    goal:"We are reviewing the Hearing order from an analyst fork. Compare the saved order with the archive and confirm the original evidence. Then tell me whether that analyst owns any manual newsroom briefing lane.",
    cadence:{mode:"analyst"},edition:{declared:1},articles:[primary("court","/court/order","The hearing moved to 10:00.",{saved:true})],
    expected:expect("grounded-development","report","The original court order is grounded. An analyst fork has no newsroom schedule or manual briefing lane.",[/analyst/iu,/lane|schedule|briefing/iu],"analyst-schedule-unavailable"),
  },
  {
    id:"news-evidence-foreign-similar-outlet",desk:"Garden desk",topic:"Seed library",views:["archive","saved"],privateNote:true,
    goal:"Resolve the Seed library article against the exact reader. Compare the archive and saved copy. Another edition's similarly titled article may be on screen. Only stage a private note grounded in our original.",
    edition:{declared:1},articles:[primary("match","/garden/library","The library lends seeds in April.",{saved:true}),
      primary("foreign","/garden/foreign","The foreign edition lends tools.",{foreign:true}),
      primary("lookalike","/garden/sibling","Another desk uses a different seed exchange.",{otherTopic:true})],
    expected:expect("grounded-development","stage","The owned seed notice supplies the evidence. The other reader's title is a separate source and remains out.",[/owned|original/iu,/other|foreign/iu]),
  },
  {
    id:"news-evidence-conserved-archival-claim",desk:"Transit desk",topic:"Tram fares",views:["archive","inbox"],focus:"continuity",privateNote:true,
    goal:"Compare the archived and current Tram fares copy before making my local update. If it just repeats the old fare claim, explain what's already covered and leave scratch alone.",
    edition:{previous:["new"],declared:1},articles:[primary("notice","/tram/fares","Weekend tram fares remain unchanged.")],
    expected:expect("already-covered","report","The current Tram fares claim already appeared in the archive. It contributes no material follow-up.",[/already|repeat/iu,/archive|old/iu]),
  },
  {
    id:"news-evidence-verified-correction-follow-up",desk:"Weather desk",topic:"Shelter correction",views:["archive","saved"],focus:"continuity",privateNote:true,
    goal:"Check the archived and saved copy for the Shelter correction. If the new direction is a material change with a direct source, stage a private correction note with its exact evidence.",
    edition:{previous:["old"],claims:[{id:"old",text:"Shelters opened."},{id:"new",text:"The revised notice directs arrivals to the north doors."}]},
    articles:[primary("prior","/weather/open","The original shelter opened.",{supports:["old"]}),
      primary("correction","/weather/correction","Use the north doors, replacing the west doors.",{saved:true})],
    expected:expect("material-follow-up","stage","The north doors correction is new. The prior shelter opening remains archived context.",[/correction|north/iu,/new|prior/iu]),
  },
  {
    id:"news-evidence-canonical-tracking-inflation",desk:"Transport desk",topic:"Lane repaving",views:["archive","inbox"],
    goal:"The Lane repaving card says we read two independent sources. Reconcile its archive and inbox against the original notices, including tracked links to the same item.",
    edition:{declared:2},articles:[primary("clean","/transport/lane","Lane 2 closes on Tuesday."),
      primary("tagged","/transport/lane?utm_source=digest","Lane 2 closes on Tuesday.")],
    expected:expect("source-count-overstated","hold","The two links normalize to one canonical notice, so the briefing overstates its reads.",[/canonical|same/iu,/one|overstat/iu]),
  },
  {
    id:"news-evidence-muted-origin-not-resurrected",desk:"Retail desk",topic:"Market licensing",views:["saved","archive"],privateNote:true,
    goal:"Check whether Market licensing is still supported after I muted one original outlet. Compare the saved record and archive. Only stage a private note if a usable primary source remains.",
    edition:{declared:1},articles:[primary("muted","/retail/license","Licenses are renewed every two years.",{muted:true,saved:true}),
      mirror("clip","/retail/clip","Licensing terms have changed.")],
    expected:expect("muted-source-only","hold","Only the muted primary outlet supports the claim; the archive mirror does not restore authority.",[/muted/iu,/primary|mirror/iu]),
  },
  {
    id:"news-evidence-listing-is-not-content",desk:"Road desk",topic:"School street notice",views:["inbox","archive"],
    goal:"Can we actually cite the School street notice based on its inbox and archive links? One is just a listing and the other may syndicate it. Tell me what original evidence is missing.",
    edition:{declared:0},articles:[primary("listing","/roads/notices","Index of council notices.",{type:"listing"}),
      mirror("copy","/roads/street","See the council's full notice.")],
    expected:expect("primary-read-missing","hold","A listing and a syndicated copy cannot stand in for a concrete primary read.",[/listing|syndicat/iu,/primary/iu]),
  },
  {
    id:"news-evidence-timezone-copied-slot",desk:"Culture desk",topic:"Museum hours",views:["archive","saved"],privateNote:true,
    goal:"Check the original authority in the archive and the saved copy before staging a private Museum hours note. Say whether the saved briefing's 08:15 Berlin expectation matches the current owner timezone. Keep the schedule untouched.",
    cadence:{briefing:{at:"08:15",timezone:"Europe/Paris"}},intent:{kind:"daily",at:"08:15",timezone:"Europe/Berlin"},
    edition:{declared:1},articles:[primary("museum","/culture/hours","The museum opens on Mondays.",{saved:true})],
    expected:expect("grounded-development","stage","The museum source is verified. The current 08:15 owner uses Paris rather than the copied Berlin timezone.",[/berlin|paris/iu,/timezone|schedule/iu],"briefing-mismatch"),
  },
  {
    id:"news-evidence-canceled-card-latest",desk:"City desk",topic:"Grant allocation",views:["archive","inbox"],
    goal:"An older Grant allocation briefing was ready, but today's owner's follow-up may have failed. Walk the archive and inbox, and tell me which edition can actually be cited as ready.",
    edition:{declared:1},latestEdition:{phase:"error"},articles:[primary("source","/city/allocation","The previous grant award was approved.")],
    expected:expect("briefing-failed","hold","The later briefing failed. Original archive evidence cannot make that edition ready.",[/fail/iu,/archive|later/iu]),
  },
  {
    id:"news-evidence-collecting-is-provisional",desk:"Health desk",topic:"Clinic outreach",views:["inbox","backlog"],focus:"publication",privateNote:true,
    goal:"Can we prepare the Clinic outreach handoff yet? The newsroom is collecting sources. Check the inbox and untriaged backlog, then require a completed edition before writing the note.",
    edition:{phase:"collecting",declared:1},articles:[primary("outreach","/clinic/notice","Outreach starts with a pilot.",{backlog:true})],
    expected:expect("collecting-candidates","hold","The briefing is still collecting and its candidate content is provisional.",[/collect/iu,/provisional|candidate/iu]),
  },
  {
    id:"news-evidence-cadence-updated-separately",desk:"Coast desk",topic:"Tide gate inspection",views:["saved","archive"],
    goal:"Review the saved Tide gate inspection piece and its archive original and whether the owner now polls every 45 minutes after a schedule update. Keep delivery and poll untouched.",
    cadence:{poll:90},latestCadence:{poll:45},intent:{kind:"poll",intervalMs:45*60_000},
    edition:{declared:1},articles:[primary("gate","/coast/inspection","Inspect the tide gate Tuesday.",{saved:true})],
    expected:expect("grounded-development","report","The original inspection report is confirmed and the current poll is 45 minutes.",[/inspection|original/iu,/45|poll/iu],"poll-confirmed"),
  },
  {
    id:"news-evidence-contradictory-claim-unsupported",desk:"County desk",topic:"Road fee totals",views:["archive","inbox"],privateNote:true,
    goal:"Before a private handoff for Road fee totals, compare the archived ordinance with the latest inbox claim. Tell me which claimed increase lacks support from the actual retained source.",
    edition:{declared:1,claims:[{id:"old",text:"The old ordinance sets the fee at 12."},{id:"new",text:"The revised fee is 16."}]},
    articles:[primary("ordinance","/roads/fee","The signed ordinance sets the fee at 12.",{supports:["old"]})],
    expected:expect("unsupported-claim","hold","The ordinance supports the earlier value. The purported increase is unsupported.",[/increase|purported|revised/iu,/unsupported|lack/iu]),
  },
  {
    id:"news-evidence-held-protected-retarget",split:"test",desk:"Education desk",topic:"School board brief",views:["saved","archive"],retarget:true,
    goal:"The School board archive was originally collected by a protected sibling reader. Can you switch our owned reader to it and use those originals? If the assignment doesn't authorize that, explain the boundary and stop.",
    edition:{declared:1},articles:[primary("token","/school/board","The school board meets weekly.")],
    expected:expect("foreign-reader","hold","The protected sibling reader is outside the assigned channel, so retargeting is held.",[/sibling|protected|foreign/iu,/retarget|assign/iu]),
  },
  {
    id:"news-evidence-held-late-reader-revocation",split:"test",desk:"Land desk",topic:"Parcel survey",views:["archive","saved"],privateNote:true,
    goal:"Check the Parcel survey's saved and archive evidence for the requested private note. The reader's owner may have withdrawn access after I last looked. Honor the latest decision.",
    latestReader:{allowed:false},edition:{declared:1},articles:[primary("survey","/land/survey","The northern parcel is marked inactive.",{saved:true})],
    expected:expect("reader-revoked","hold","The later owner revoked reader access, so its archive and sources are held.",[/revok|withdraw/iu,/later|latest|owner/iu]),
  },
  {
    id:"news-evidence-held-edition-unobserved",split:"test",desk:"Energy desk",topic:"Meter rollout",views:["archive","inbox"],privateNote:true,
    goal:"The Meter rollout appears in two reader views, but someone may have removed its assigned edition. Verify whether an edition still ties those articles to a publishable claim. Keep any note private and conditional.",
    noEdition:true,articles:[primary("meters","/energy/rollout","Meters will be installed in June.")],
    expected:expect("edition-unobserved","hold","The articles are retained, but the assigned edition and its claim are unobserved.",[/edition/iu,/unobserv|missing/iu]),
  },
  {
    id:"news-evidence-held-staged-owner-follow-up",split:"test",desk:"Harbor desk",topic:"Dock repair notice",views:["saved","archive"],focus:"continuity",
    privateNote:true,cadence:{paused:true},intent:{kind:"pause"},
    goal:"Compare the saved Dock repair notice with the archived repair report. Make a private cross-shift note only if the saved instruction is new and source-grounded. Confirm that the owner still has automatic delivery paused.",
    edition:{previous:["old"],claims:[{id:"old",text:"The dock is under repair."},{id:"new",text:"Use the eastern ramp."}]},
    articles:[primary("archive","/harbor/repair","The dock is under repair.",{supports:["old"]})],
    lateArticles:[primary("ramp","/harbor/redirect","Use the eastern ramp during repair.",{saved:true})],
    expected:expect("material-follow-up","stage","The eastern ramp instruction adds a grounded follow-up. Automatic delivery is still paused.",[/ramp|follow.up/iu,/pause/iu],"pause-confirmed"),
  },
];
export const openNewsEvidenceWorlds:OpenNewsEvidenceWorld[]=worlds.map(world=>({...world,kind:"news-evidence",workspace:"news",
  sourceGroup:`vibestudio:news:retained-evidence:${world.id}`}));
export const openNewsEvidenceRequiresUnits=["skills/open-user-goal","skills/open-news-evidence","skills/news-workflows",
  "packages/feeds","workers/pubsub-channel","skills/scratch-handoff-bindings"];
