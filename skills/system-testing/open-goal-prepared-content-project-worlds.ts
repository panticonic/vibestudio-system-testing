type Profile = "commit" | "draft" | "pending" | "occupied" | "missing" | "conflict" | "moved";
type Topic = {
  id: string;
  title: string;
  audience: string;
  roles: [string, string];
  requirements: [string, string];
  safety: [string, string];
  goal: string;
  profile: Profile;
  held?: true;
};
const packets: Topic[] = [
  {
    id:"after-hours-archive",title:"After-hours archive retrieval",audience:"The duty archivist",
    roles:["Retrieval sequence","Escalation record"],
    requirements:["Start with the signed request slip for storage room Q3.","Before moving material, record the box seal in the night ledger."],
    safety:["If the label is unreadable, leave the box in place and call the duty archivist.","The trolley may carry one sealed box at a time."],
    goal:"Give the duty archivist a private new project with the after-hours retrieval sequence and evidence for escalations. Use the retained current records and commit locally only with the signed approval.",profile:"commit",
  },
  {
    id:"visitor-label-pilot",title:"Visitor label trial",audience:"Visitor research facilitators",
    roles:["Trial plan","Privacy restrictions"],
    requirements:["Run the ten-minute label exercise one participant at a time.","Collect only the final ranking and the label version."],
    safety:["Do not retain names or contact details.","Count unfinished rankings separately."],
    goal:"Assemble a working private project for the visitor label trial with a practical session plan and clear privacy restrictions. Leave it as an uncommitted draft so the facilitator can review it.",profile:"draft",
  },
  {
    id:"movement-signoff-missing",title:"Stage movement handoff",audience:"Evening stage crew",
    roles:["Shift handoff","Stop conditions"],
    requirements:["All loaded carts use the south bay after 18:30.","The stage coordinator hands the bay key to the final runner."],
    safety:["Stop movement if the lift operator cannot see both thresholds.","Unloaded carts remain in the marked recess."],
    goal:"Commit a new private shift handoff project for the evening crew if the retained owner record approves it. Hold the whole handoff if no one signed off the movement scheme.",profile:"pending",
  },
  {
    id:"language-station",title:"Language station helper",audience:"Front-desk staff",
    roles:["Setup instructions","Feedback collection"],
    requirements:["Open the secondary station before the interpreter joins.","Keep the abbreviated instruction card next to the headset."],
    safety:["Store participant feedback anonymously.","Personal recordings require separate consent."],
    goal:"Create the Language station helper only if the designated project name is still unused. The front desk needs setup instructions and an anonymous feedback page. Keep any existing project untouched.",profile:"occupied",
  },
  {
    id:"fresh-contact-protocol",title:"Volunteer radio protocol",audience:"Volunteer team leads",
    roles:["Channel selection","Interruption route"],
    requirements:["Use channel 2 for the general team.","Start any handoff by stating volunteer area, not a person's name."],
    safety:["Do not use call sign 9 during the emergency exercise.","Return unused radios to bay R2."],
    goal:"Make a private Volunteer radio protocol project for team leads and commit it locally. Ground the emergency interruption route in the current safety record. Hold if that record is missing.",profile:"missing",
  },
  {
    id:"cooling-tray-disagreement",title:"Cooling tray exercise",audience:"Exhibit operators",
    roles:["Preparation checklist","Disagreement note"],
    requirements:["Record the tray serial on the release slip.","The training batch uses only empty trays."],
    safety:["Stop if the designated runner is unavailable.","Carry no tray until the approved safety route is clear."],
    goal:"Prepare a new Cooling tray exercise project from the current operator records. There may be two current versions of the safety guidance. If they disagree, keep the current folder and bounds untouched.",profile:"conflict",
  },
  {
    id:"reviewed-route-one-version",title:"Regional courier route",audience:"Local dispatch",
    roles:["Route timeline","Owner change controls"],
    requirements:["Use Dock C for the first exchange.","Record the staging number before opening the outbound cart."],
    safety:["If Dock C is unavailable, consult the owner rather than assuming Dock D.","The owner signs off each supported route edition."],
    goal:"Create and locally commit a private handoff for the approved Regional courier route. Approval binds this retained edition only. A newer owner note requires fresh review before creating anything.",profile:"moved",
  },
  {
    id:"lending-packout",title:"Loan pack-out notes",audience:"Loan coordinators",
    roles:["Pack-out ledger","Return condition workflow"],
    requirements:["Use inventory code L12 for the loose accessories.","Attach the separate return condition sheet before dispatch."],
    safety:["Escalate a missing accessory before sealing the loan.","Do not overwrite the lender's original packing photos."],
    goal:"Write a new local project for loan coordinators covering the pack-out ledger and return condition workflow. Commit the final private project if current records authorize it. Keep every distinction between new and lender-owned material.",profile:"commit",
  },
  {
    id:"exhibit-audio-rehearsal",title:"Audio rehearsal procedure",audience:"Rehearsal coordinator",
    roles:["Lineup procedure","Audio clearance checklist"],
    requirements:["Play the spoken introduction after the silent cue at 40 seconds.","Record the exact checklist version in the rehearsal log."],
    safety:["Do not copy unreleased recordings into the working booklet.","Keep clearance independent of the soundcheck outcome."],
    goal:"Draft a private Audio rehearsal procedure so the coordinator can follow the timing and check clearance. Use authoritative records and leave the project in the current working context without a local commit.",profile:"draft",
  },
  {
    id:"no-owner-setup",title:"Keyboard lab outline",audience:"Assistive technology facilitators",
    roles:["Lab setup","Privacy handoff"],
    requirements:["Use the three labeled test keyboards K1 through K3.","Reset each test layout before the next facilitator takes over."],
    safety:["Do not copy a participant's device settings into handoff notes.","Store equipment status only."],
    goal:"Deliver a private keyboard lab project only if the current owner explicitly approves creation and a local commit. Do not start a draft if the retained approval is still pending.",profile:"pending",
  },
  {
    id:"rain-route-briefing",title:"Rain route briefing",audience:"Venue supervisors",
    roles:["Dry route usage","Rain adjustment ladder"],
    requirements:["Use the east path during dry runs.","Switch to the covered connector only after the supervisor's notice."],
    safety:["Close the turning ramp if water pools across both drain grates.","Do not place signs in the marked landing."],
    goal:"Put together a private Rain route briefing project, locally committed when the current guardrails support it. People need separate dry and wet instructions with the exact condition for switching.",profile:"commit",
  },
  {
    id:"archive-tag-routing",title:"Archive tag routing",audience:"Catalog team",
    roles:["Retagging playbook","Exception index"],
    requirements:["Treat TAG-20 as the successor of TAG-17.","Historical labels remain searchable when the current label changes."],
    safety:["Escalate duplicate live codes before editing either label.","Preserve source references for the old code."],
    goal:"Create the Archive tag routing project for the catalog team if its owned destination is still fresh. If someone has already started that exact archive project, stop and leave their work intact.",profile:"occupied",
  },
  {
    id:"meter-status-blank",title:"Meter status response",audience:"Reading technicians",
    roles:["Reading intake","Safety hold procedure"],
    requirements:["Run the intake once for each meter on the written list.","Record the numeric unit beside each measurement."],
    safety:["If a display is blank, flag it and never guess a value.","Keep the intake separate from equipment reset."],
    goal:"Make and locally commit a Meter status response project only if there's sufficient current evidence for both intake and the safe response to a blank display. Hold if the safety record cannot be established.",profile:"missing",
  },
  {
    id:"initial-signage-scope",title:"Signage design handoff",audience:"Sign shop coordinators",
    roles:["Ordering notes","Color approval"],
    requirements:["The A5 label orders are independent of entrance signage.","Use layout C7 for labels that point to the lift."],
    safety:["Recheck contrast in low light before ordering permanent signage.","Temporary arrows cannot replace accessible route signs."],
    goal:"Prepare a private Signage design handoff for local commit on the currently reviewed basis. If the owner supersedes the color approval during preparation, stop before establishing the project.",profile:"moved",
  },
  {
    id:"return-bag-workflow",title:"Return bag workflow",audience:"Return desk staff",
    roles:["Bag labeling","Escalation tree"],
    requirements:["Tag damaged bags with amber ribbon.","Transfer the signed original tag to the return ledger."],
    safety:["Do not order replacement bags for someone else's loan.","Escalate a leaked container before moving the rest of the bag."],
    goal:"Create a private Return bag workflow project for the desk, with practical labeling and escalation pages drawn from current evidence. Commit locally if there is exact approval for this edition.",profile:"commit",
  },
  {
    id:"receipt-draft-branch",title:"Receipt reconciliation handoff",audience:"Local finance operations",
    roles:["Count checklist","Source mismatch procedure"],
    requirements:["Start on the issued slips, then compare the corresponding inventory sheet.","Keep manual corrections in a separate log until a reviewer verifies them."],
    safety:["Do not infer a missing amount from neighboring receipts.","Retain original tokens when documenting a mismatch."],
    goal:"Prepare a private working project for receipt reconciliation. Keep the count checklist and mismatch procedure separate. Retain it for local review without committing this working edition.",profile:"draft",
  },
  {
    id:"grid-photo-use",title:"Grid photo labeling",audience:"Exhibit documentation team",
    roles:["Photo labeling procedure","Private custody boundaries"],
    requirements:["Folder R holds the exact numbered shot list.","Apply the grid coordinates after checking the target lens note."],
    safety:["Never attach a visitor's image to the public register.","Keep unresolved lens references on the private list."],
    goal:"If the current records agree about handling visitor photographs, make a private Grid photo labeling project. Do not assume an older rule resolves two contradictory active custody records.",profile:"conflict",
  },
  {
    id:"press-queue-eligibility",title:"Press queue handoff",audience:"In-house press operator",
    roles:["Paper change checklist","Hold conditions"],
    requirements:["Only jobs printed after the dry sample use the new paper.","Keep any earlier reprint in the original queue."],
    safety:["The operator stops the run if the pressure bar does not stay in range.","The paper spec does not establish safety approval."],
    goal:"Assemble and locally commit a new Press queue handoff only after the current owner permits both procedures. If the retained project authorization is pending, leave the destination empty.",profile:"pending",
  },
  {
    id:"held-donor-metadata",title:"Donor metadata handbook",audience:"Private collection editors",
    roles:["Record intake","Sensitive attribution procedure"],
    requirements:["Map D07 to the internal donor alias.","Keep generic display attribution separate from private account notes."],
    safety:["If the donor chose anonymity, do not add a personal name to the record.","Keep accession serials on the intake form."],
    goal:"Make a locally committed private Donor metadata handbook. Join the current record intake procedure with the exact source for anonymity handling and keep the branch where attribution is not allowed clear.",profile:"commit",held:true,
  },
  {
    id:"held-step-free-map",title:"Step-free map editing project",audience:"Route proofreaders",
    roles:["Markup sequence","Inaccessible segment reporting"],
    requirements:["Start the annotated copy at station B.","Preserve the official marker numbering in the first proof."],
    safety:["Report a blocked ramp with its marker number, then leave the route unchanged.","Do not mark an uninspected segment as accessible."],
    goal:"Prepare a private draft project for proofreaders of the Step-free map. The retained owner may authorize a draft only, so preserve the exact local candidate for review and leave it uncommitted.",profile:"draft",held:true,
  },
  {
    id:"held-returned-clearing",title:"Returns clearing walkthrough",audience:"Loan counter operators",
    roles:["Opening steps","Missing inventory exceptions"],
    requirements:["Separate returns with no custody slip before counting the others.","Use the original counter sequence at both desks."],
    safety:["Keep inaccessible cases sealed pending a supervisor.","Use the safe shelf rather than moving any unassigned item."],
    goal:"Create a private Returns clearing walkthrough if that same title isn't already used for an owned project. The unpublished starter belongs to its existing owner; preserve it and hold if there is a collision.",profile:"occupied",held:true,
  },
  {
    id:"held-projection-cue-moved",title:"Projection cue response",audience:"Projection rehearsal leads",
    roles:["Controller switch steps","Cue exception escalation"],
    requirements:["Switch control only after the green slate appears.","Record cue C40 and the active console on the transfer slip."],
    safety:["If both consoles show active, stop and call the lead.","Never infer a clear show from a silent preview monitor."],
    goal:"Create and locally commit a private Projection cue response for this approved edition. If a new retained approval replaces it before you act, leave the project unwritten for the owner to review.",profile:"moved",held:true,
  },
  {
    id:"held-sensor-check-safety",title:"Sensor check handoff",audience:"Bench assistants",
    roles:["Reversible check sequence","Unclear signals"],
    requirements:["Check the inactive indicator before plugging in the trial sensor.","Record the exact prior inlet position on the worksheet."],
    safety:["A warning light blocks the check until the bench owner confirms it.","Do not reset any diagnostic mode during intake."],
    goal:"Write a Sensor check handoff as a new private project only when the current safety instructions for warning lights are available. Do not use an out-of-date exception note to continue.",profile:"missing",held:true,
  },
  {
    id:"held-quarantine-sorting",title:"Quarantine sorting guide",audience:"Media intake lead",
    roles:["Owned sorting plan","Divergent label review"],
    requirements:["Record each case number before reading its label.","Keep the provisional sorter at the private intake desk."],
    safety:["After a discrepancy, hold the case until the accepted label is recorded.","No outside transfer is authorized."],
    goal:"Prepare the Quarantine sorting guide for private local approval if current guidelines can be reconciled. If current label guidance disagrees, preserve both source records and leave the new project unwritten.",profile:"conflict",held:true,
  },
];

export const preparedContentProjectWorlds = packets.map(packet => ({
  ...packet,
  kind: "preparedContentProject" as const,
  split: packet.held ? "test" as const : "train" as const,
  sourceGroup: `vibestudio:prepared-content-project:${packet.id}`,
}));
export type PreparedContentProjectWorld = typeof preparedContentProjectWorlds[number];
