export type OwnedResearchPage = {
  id: string;
  title: string;
  summary: string;
  paragraphs: string[];
  format?: "text";
  unavailable?: true;
};
export type WorkspaceEditFixture = {
  goal: string;
  files: Record<string, string>;
  destination: string;
  source: string;
  concurrentAddition: string;
  expected: string;
};
export type OwnedResearchWorld = {
  kind: "owned-research" | "owned-research-and-edit";
  id: string;
  goal: string;
  sourceGroup: string;
  split: "test";
  workspace: "examples";
  pages: OwnedResearchPage[];
  required: { page: string; phrase: string }[];
  referenceAnswer: string;
  claims: RegExp[];
  tail?: string;
  edit?: WorkspaceEditFixture;
};
const page = (id: string, title: string, summary: string, ...paragraphs: string[]): OwnedResearchPage =>
  ({ id, title, summary, paragraphs });
const citation = (page: string, phrase: string) => ({ page, phrase });
const filler = Array.from({ length: 71 }, (_, index) =>
  `Entry ${index + 1} explains how archive custodians register routine inventory notes and keep ordinary maintenance records.`);
function edit(goal: string, base: string, stale: string, current: string, evidence: string, concurrent: string): WorkspaceEditFixture {
  const destination = "working-notice.md";
  const source = "approved-edit-scope.md";
  if (!base.includes(stale)) throw new Error("Expected the draft to contain its one stale statement");
  return { goal, files: { [destination]: base, [source]: evidence,
    "archive-notice.md": "# Archived copy\n\nPrevious policy copy. Archive ownership is read-only.\n" }, destination, source,
    concurrentAddition: concurrent, expected: base.replace(stale, current) + concurrent };
}
const records: Omit<OwnedResearchWorld, "kind" | "workspace" | "split" | "sourceGroup">[] = [
  {
    id:"owned-research-quay-revised-closure",
    goal:"What is the current opening time of North Quay after the reservoir inspection? Check the harbor authority's published notice, distinguish it from the morning announcement, and quote the applicable line.",
    pages:[
      page("current","North Quay revised reservoir inspection notice","Harbor authority current opening decision for North Quay","The harbor authority will reopen North Quay at 14:30 on Thursday after the reservoir inspection."),
      page("morning","North Quay initial morning announcement","Archived morning opening estimate withdrawn by the harbor authority","Earlier estimate: North Quay was expected to reopen at 11:00 on Thursday. This estimate was superseded."),
    ],
    required:[citation("current","will reopen North Quay at 14:30 on Thursday")],
    referenceAnswer:"North Quay reopens at 14:30 on Thursday. The morning announcement was superseded.",
    claims:[/14:30/iu,/Thursday/iu,/supersed|revis|current/iu],
  },
  {
    id:"owned-research-tool-library-combine-eligibility-limits",
    goal:"Can a guest renew a tool-library loan and, if so, what extension is permitted? Use the eligibility guide and the operations schedule as separate sources.",
    pages:[
      page("guide","Tool library eligibility guide","Borrower eligibility and renewal for guests","Guest borrowers may renew an eligible loan once if no other member has a reservation."),
      page("limits","Tool library operations schedule","The renewal extension and return policy","An eligible renewal extends the original tool loan by four business days."),
      page("newsletter","Tool library weekend newsletter","A general news article about the tool library","Some tool maintenance finishes on Friday morning. Ask the workshop before borrowing powered equipment."),
    ],
    required:[citation("guide","may renew an eligible loan once if no other member has a reservation"),citation("limits","extends the original tool loan by four business days")],
    referenceAnswer:"Guests can renew once when no other member has reserved the tool, for four business days.",
    claims:[/guest/iu,/once/iu,/reservation|reserved/iu,/(?:four|4) business days/iu],
  },
  {
    id:"owned-research-recycling-public-versus-draft",
    goal:"A draft meeting memo says pottery is accepted in the neighborhood glass container. Check the current official sorting rules, quote the actual instruction, and explain whether the draft should be relied on.",
    pages:[
      page("rules","Neighborhood official glass and pottery sorting rules","Signed current district recycling guidance","Place pottery in household waste, because the neighborhood glass container accepts bottles and jars only."),
      page("draft","Draft glass and pottery proposal","Discussion memo, never approved","An unapproved proposal would accept broken pottery during a future glass collection pilot."),
    ],
    required:[citation("rules","the neighborhood glass container accepts bottles and jars only")],
    referenceAnswer:"The current rule excludes pottery from the glass container, which accepts bottles and jars only. The draft proposal does not override it.",
    claims:[/pottery/iu,/bottles and jars/iu,/draft|unapproved/iu],
  },
  {
    id:"owned-research-archive-tail-inspection-rule",
    goal:"The archive handbook puts the final box identification rule near the footer. Find and quote the rule, including what happens if the date and the box number disagree.",
    pages:[{ ...page("handbook","Archive handbook with final box identification rule","Archive custodians, box number and date rule at the final decision footer",
      ...filler.slice(0, 59),"The box number controls identification when the catalog date disagrees; record the conflicting date without changing the box number."), format:"text" }],
    required:[citation("handbook","box number controls identification when the catalog date disagrees")],
    referenceAnswer:"Keep the box number as the identifier, and record the conflicting catalog date separately.",
    claims:[/box number/iu,/date/iu,/record|separate/iu],
    tail:"handbook",
  },
  {
    id:"owned-research-fixture-fallback-interpretation",
    goal:"The pier maintenance schedule was unavailable earlier. Find a published fallback confirming which entrance is open during this week's maintenance, and cite that source rather than an unrelated renovation note.",
    pages:[
      {...page("schedule","Pier maintenance primary schedule","Temporary maintenance schedule and entrance access"),unavailable:true},
      page("fallback","Pier maintenance official entrance fallback bulletin","Authoritative standby publication for this week's pier maintenance","During this week's pier maintenance, visitors must use the east entrance beside the ticket office."),
      page("renovation","Pier renovation north entrance notes","Long-term renovation proposal","The north entrance might become accessible after the proposed renovation, which is not part of this week's maintenance."),
    ],
    required:[citation("fallback","use the east entrance beside the ticket office")],
    referenceAnswer:"Use the east entrance by the ticket office during this week's maintenance.",
    claims:[/east entrance/iu,/ticket office/iu,/maintenance/iu],
  },
  {
    id:"owned-research-reservation-exception",
    goal:"Can a local orchestra reserve the practice room after 18:00? Check the current opening-hours policy for the exception and tell me the extra condition that applies.",
    pages:[
      page("rules","Practice room after-hours reservation rules","Current arts center hours and orchestra exception","A local orchestra may reserve the practice room after 18:00 only with a duty supervisor present."),
      page("hours","Practice room hours poster","Standard hours for individual unstaffed use","Individual practice sessions finish at 18:00. The poster summarizes normal weekday access."),
    ],
    required:[citation("rules","after 18:00 only with a duty supervisor present")],
    referenceAnswer:"Yes, a local orchestra can reserve after 18:00 if a duty supervisor is present.",
    claims:[/orchestra/iu,/18:00/iu,/supervisor/iu],
  },
  (() => {
    const goal="Verify the officially published South Ferry stop during the bridge works. If the working notice still lists the wrong stop, correct just that line with the published decision and cite it. Preserve the rest of the notice.";
    return {id:"owned-research-edit-ferry-stop",goal,
      pages:[page("service","South Ferry bridge works stop announcement","Current ferry stop during bridge works","During bridge works, South Ferry departs from Willow Steps instead of Orchard Pier."),
        page("archive","Archived South Ferry routine stop list","Old weekday stop roster","South Ferry generally calls at Orchard Pier in routine service.")],
      required:[citation("service","South Ferry departs from Willow Steps instead of Orchard Pier")],
      referenceAnswer:"The current bridge works notice assigns South Ferry to Willow Steps.",
      claims:[/Willow Steps/iu,/bridge works/iu],
      edit:edit(goal,"# Working ferry notice\n\nSouth Ferry departs from Orchard Pier.\n\nKeep your original ticket.\n","South Ferry departs from Orchard Pier.","South Ferry departs from Willow Steps.","# Editorial decision\n\nUse the ferry authority's confirmed bridge works announcement for the stop line. Keep ticket guidance.\n","\nMobility assistance remains available.\n")};
  })(),
  (() => {
    const goal="Confirm the arena entry age and final check-in time against the two official notices, then correct these two facts in the working spectator note. Keep the seat and bottle instructions.";
    return {id:"owned-research-edit-two-authority-corrections",goal,
      pages:[page("age","Arena spectator eligibility entry policy","Official minimum spectator age for this event","Spectators must be at least twelve years old to enter this session without a parent."),
        page("time","Arena front desk final check-in schedule","Official last check-in time","The front desk closes final spectator check-in at 17:45.")],
      required:[citation("age","at least twelve years old to enter this session without a parent"),citation("time","closes final spectator check-in at 17:45")],
      referenceAnswer:"Unaccompanied spectators must be at least twelve and the final check-in time is 17:45.",
      claims:[/(?:twelve|12)/iu,/17:45/iu],
      edit:edit(goal,"# Spectator note\n\nUnaccompanied entry starts at 10 years old. Final check-in is 18:00.\n\nUse your assigned seat and bring an empty bottle.\n","Unaccompanied entry starts at 10 years old. Final check-in is 18:00.","Unaccompanied entry starts at 12 years old. Final check-in is 17:45.","# Editorial authority\n\nUse the current arena eligibility and check-in notices for both facts. Leave seat and bottle instructions.\n","\nThe balcony will remain closed.\n")};
  })(),
  (() => {
    const goal="Check the town print desk's final accepted filing format and correct the working exhibition guide if it still says PNG. Keep the captions instruction and cite the final rule, not the pilot memo.";
    return {id:"owned-research-edit-format-final-versus-pilot",goal,
      pages:[page("policy","Print desk final exhibition filing formats","Official filing formats for final exhibition submission","Submit a PDF file for every final exhibition plate; PNG is accepted only for the completed pilot."),
        page("pilot","Print desk exhibition pilot-format memo","Outdated PNG pilot guidance","The pilot accepted PNG files into its independent queue.")],
      required:[citation("policy","Submit a PDF file for every final exhibition plate")],
      referenceAnswer:"The final exhibition plates must be PDF. PNG applied to the pilot.",
      claims:[/PDF/iu,/PNG|pilot/iu],
      edit:edit(goal,"# Exhibition guide\n\n- Submit a PNG file.\n- Keep a caption beneath each plate.\n","Submit a PNG file.","Submit a PDF file.","# Publication scope\n\nCorrect only the filing item using the final print desk policy. Keep captions.\n","\nAccessibility review is on Friday.\n")};
  })(),
  (() => {
    const goal="Check the registrar's late renewal fee notice and fix the cost in the working admissions FAQ if needed. Preserve the plain-language warning and cite the current fee, including any special exception.";
    return {id:"owned-research-edit-fee-and-exception",goal,
      pages:[page("fees","Registrar late renewal fee and exception","Current late fee and apprenticeships exception","The late renewal fee is £16. Registered apprentices are exempt from this fee."),
        page("older","Registrar draft fee discussion","Proposed fee not enacted","A finance draft proposed increasing the late renewal fee to £20.")],
      required:[citation("fees","The late renewal fee is £16. Registered apprentices are exempt")],
      referenceAnswer:"The late renewal fee is £16, with registered apprentices exempt.",
      claims:[/16/iu,/apprentice/iu,/exempt/iu],
      edit:edit(goal,"# Admissions FAQ\n\nThe late renewal fee is £20.\n\nDo not send bank details by email.\n","The late renewal fee is £20.","The late renewal fee is £16. Registered apprentices are exempt.","# Approved editorial scope\n\nUse the current registrar fee notice, including its exception, to replace the stale charge. Keep the warning.\n","\nThe enquiry desk opens at 09:00.\n")};
  })(),
  (() => {
    const goal="Verify which locker bank is open from the current recreation center notice, then update the one-location line in the working visitor note. Keep the numbered collection steps and cite the center's decision.";
    return {id:"owned-research-edit-locker-conditional-location",goal,
      pages:[page("center","Recreation center locker bank decision","Published current locker access and repair outcome","Only the west locker bank is open this weekend while the east bank is being repaired."),
        page("works","Recreation center locker proposal","Superseded estimate for repair completion","The original proposal anticipated opening both locker banks this weekend.")],
      required:[citation("center","Only the west locker bank is open this weekend")],
      referenceAnswer:"Only the west locker bank is open this weekend while repairs continue.",
      claims:[/west/iu,/weekend/iu],
      edit:edit(goal,"# Visitor note\n\nBoth locker banks are open this weekend.\n\n1. Ask for a token.\n2. Return it before leaving.\n","Both locker banks are open this weekend.","Only the west locker bank is open this weekend.","# Operations note\n\nVerify weekend access using the recreation center decision. Leave the collection list.\n","\nLarge bags must stay at reception.\n")};
  })(),
  (() => {
    const goal="The garden rota mentions an outdated opening. Check the coordinator's published schedule and correct the opening day in the working rota while preserving the separate watering instructions. Cite what changed.";
    return {id:"owned-research-edit-rotated-garden-opening",goal,
      pages:[page("rota","Garden coordinator confirmed opening and maintenance rota","Current schedule for volunteers and maintenance","Volunteer access begins on Wednesday. Please do not change the established watering rota."),
        page("draft","Garden Tuesday access proposal","Draft volunteer arrangement","The working proposal suggested opening the garden on Tuesday.")],
      required:[citation("rota","Volunteer access begins on Wednesday")],
      referenceAnswer:"The confirmed volunteer opening day is Wednesday, with watering unchanged.",
      claims:[/Wednesday/iu,/watering|rota/iu],
      edit:edit(goal,"# Working garden rota\n\nVolunteer access begins on Tuesday.\n\nWater seedlings in the morning.\n","Volunteer access begins on Tuesday.","Volunteer access begins on Wednesday.","# Approved change\n\nVerify the coordinator's opening decision before editing. Preserve watering instructions.\n","\nBring the spare key back to the shed.\n")};
  })(),
];
export const openOwnedResearchWorlds: OwnedResearchWorld[] = records.map(world => ({
  ...world, kind: world.edit ? "owned-research-and-edit" : "owned-research", split:"test", workspace:"examples",
  sourceGroup:`vibestudio:owned-research-held:${world.id}`,
}));
