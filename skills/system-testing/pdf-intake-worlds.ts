type Claim = {
  question: string;
  evidence: { page: number; quote: string; line?: number }[];
};
type World = {
  id: string;
  goal: string;
  sheets: string[][];
  pages: number[];
  batchSize: number;
  purpose?: "text" | "layout" | "ocr";
  blocked?: "missing-pages" | "engine-unavailable";
  fault?: { batch: number; kind: "receipt-mismatch" | "read-error" };
  claims: Claim[];
};

export const managedPdfWorlds: World[] = [
  {
    id: "superseded-release-date",
    goal: "Cite the initial release date and its replacement from the assigned packet. Distinguish the superseding decision from the original.",
    sheets: [
      ["Original release: March 4"],
      ["Review records"],
      ["Approved replacement: March 11"],
    ],
    pages: [1, 2, 3],
    batchSize: 1,
    claims: [
      {
        question: "Which original date did the revised decision replace?",
        evidence: [
          { page: 1, quote: "Original release: March 4" },
          { page: 3, quote: "Approved replacement: March 11" },
        ],
      },
    ],
  },
  {
    id: "retention-and-hold",
    goal: "Collect evidence from the two assigned parts of the policy. Cite the normal retention period and the exception.",
    sheets: [
      ["Review exports expire after 30 days"],
      ["This page discusses staffing"],
      ["Legal holds suspend deletion until release"],
    ],
    pages: [3, 1],
    batchSize: 1,
    purpose: "layout",
    claims: [
      {
        question: "When do review exports expire?",
        evidence: [{ page: 1, quote: "Review exports expire after 30 days" }],
      },
      {
        question: "What exception applies to records under a hold?",
        evidence: [
          { page: 3, quote: "Legal holds suspend deletion until release" },
        ],
      },
    ],
  },
  {
    id: "handoff-partial",
    goal: "Find the time and owner of the next check. Report any unsupported part separately.",
    sheets: [
      ["Next export check: 14:00"],
      ["Review owner has not been recorded"],
    ],
    pages: [1, 2],
    batchSize: 2,
    claims: [
      {
        question: "When is the export check?",
        evidence: [{ page: 1, quote: "Next export check: 14:00" }],
      },
      { question: "Who owns the export check?", evidence: [] },
    ],
  },
  {
    id: "selected-pages-exclude-answer",
    goal: "Look for the approval date using only the assigned pages.",
    sheets: [["Rough proposal"], ["Approval date: June 12"], ["Bibliography"]],
    pages: [1, 3],
    batchSize: 2,
    claims: [
      { question: "What date was the proposal approved?", evidence: [] },
    ],
  },
  {
    id: "caption-and-value",
    goal: "Cite the forecast value together with its unit caption so the figure is unambiguous.",
    sheets: [
      [
        "Water forecast",
        "Figures in liters per household",
        "Planning forecast: 240",
      ],
    ],
    pages: [1],
    batchSize: 1,
    purpose: "layout",
    claims: [
      {
        question: "What is the planning forecast and its unit?",
        evidence: [
          { page: 1, quote: "Figures in liters per household" },
          { page: 1, quote: "Planning forecast: 240" },
        ],
      },
    ],
  },
  {
    id: "batch-across-sections",
    goal: "Read the two groups of pages and cite the routing change and follow-up deadline.",
    sheets: [
      ["Route proposed: North"],
      ["Review checklist"],
      ["Approved route: West"],
      ["Verify signage by Friday"],
    ],
    pages: [1, 2, 3, 4],
    batchSize: 2,
    claims: [
      {
        question: "Which route superseded the proposal?",
        evidence: [
          { page: 1, quote: "Route proposed: North" },
          { page: 3, quote: "Approved route: West" },
        ],
      },
      {
        question: "When is signage verification due?",
        evidence: [{ page: 4, quote: "Verify signage by Friday" }],
      },
    ],
  },
  {
    id: "page-not-in-pdf",
    goal: "Check the exact assigned page range before searching this appendix.",
    sheets: [["Appendix starts on this page"], ["Appendix ends on this page"]],
    pages: [1, 4],
    batchSize: 2,
    blocked: "missing-pages",
    claims: [{ question: "Which item was retained?", evidence: [] }],
  },
  {
    id: "ocr-not-authorized",
    goal: "Run OCR only if authorized for this assignment. Report the blocked request without substituting an extraction method.",
    sheets: [["Local transcription marker"]],
    pages: [1],
    batchSize: 1,
    purpose: "ocr",
    blocked: "engine-unavailable",
    claims: [{ question: "What is the transcription marker?", evidence: [] }],
  },
  {
    id: "superseded-custody-route",
    goal: "Locate the superseded custody destination and the approved replacement in the assigned revisions.",
    sheets: [
      ["Record copy only"],
      ["Initial custody desk: North"],
      ["Draft suggestion: East"],
      ["Approved replacement desk: West"],
    ],
    pages: [4, 2, 3],
    batchSize: 2,
    claims: [
      {
        question:
          "Which original custody desk was replaced and which desk was approved?",
        evidence: [
          { page: 2, quote: "Initial custody desk: North" },
          { page: 4, quote: "Approved replacement desk: West" },
        ],
      },
    ],
  },
  {
    id: "section-specific-hold",
    goal: "Cite the Support status together with the heading that disambiguates it from Intake.",
    sheets: [["INTAKE", "Status: hold", "SUPPORT", "Status: hold"]],
    pages: [1],
    batchSize: 1,
    purpose: "layout",
    claims: [
      {
        question: "What is the Support status under the SUPPORT heading?",
        evidence: [
          { page: 1, quote: "SUPPORT" },
          { page: 1, line: 3, quote: "Status: hold" },
        ],
      },
    ],
  },
  {
    id: "audit-denominator",
    goal: "Cite the count with the exact denominator and the scope of the audit. Use the final measurement only.",
    sheets: [
      ["Preliminary check: 16 of 20"],
      ["Audit scope: pilot regions only"],
      ["Final measurement: 38 passed", "Denominator: 40 assigned checks"],
    ],
    pages: [2, 3, 1],
    batchSize: 2,
    purpose: "layout",
    claims: [
      {
        question: "What were the final count and denominator?",
        evidence: [
          { page: 3, quote: "Final measurement: 38 passed" },
          { page: 3, quote: "Denominator: 40 assigned checks" },
        ],
      },
      {
        question: "What was the audit scope?",
        evidence: [{ page: 2, quote: "Audit scope: pilot regions only" }],
      },
    ],
  },
  {
    id: "storage-exceptions",
    goal: "Collect the storage rule, its exception, and the evidence needed to end the exception.",
    sheets: [
      ["The default archive expires after two years"],
      ["Exception: retain an open review indefinitely"],
      ["A signed reconciliation closes the review"],
    ],
    pages: [1, 3, 2],
    batchSize: 1,
    claims: [
      {
        question: "What is the normal archive retention?",
        evidence: [
          { page: 1, quote: "The default archive expires after two years" },
        ],
      },
      {
        question: "What overrides the default and what closes that exception?",
        evidence: [
          { page: 2, quote: "Exception: retain an open review indefinitely" },
          { page: 3, quote: "A signed reconciliation closes the review" },
        ],
      },
    ],
  },
  {
    id: "release-approval-out-of-scope",
    goal: "Report the active cohort and whether approval can be established from the selected pages.",
    sheets: [
      ["Active cohort: partner pilot"],
      ["Final approval: Dana, May 9"],
      ["Meeting draft: Casey may review"],
    ],
    pages: [3, 1],
    batchSize: 2,
    claims: [
      {
        question: "What is the active cohort?",
        evidence: [{ page: 1, quote: "Active cohort: partner pilot" }],
      },
      { question: "Who recorded final approval and when?", evidence: [] },
    ],
  },
  {
    id: "review-deadline-pending",
    goal: "Report the confirmed intake deadline. Keep the release and publication date requests unanswered if the packet only shows proposals.",
    sheets: [
      ["Suggested release date: Feb 3"],
      ["Intake closes on Jan 21"],
      [
        "Suggested publication date: Feb 8",
        "Neither proposed date is approved",
      ],
    ],
    pages: [1, 2, 3],
    batchSize: 2,
    claims: [
      { question: "When is the approved release?", evidence: [] },
      {
        question: "When does intake actually close?",
        evidence: [{ page: 2, quote: "Intake closes on Jan 21" }],
      },
      { question: "When is publication scheduled?", evidence: [] },
    ],
  },
  {
    id: "rehearsal-record-only",
    goal: "Check selected pages for a completed custody transfer and actual signer. Rehearsal details are not completion evidence.",
    sheets: [
      ["Rehearsal at 09:00", "Simulated signer: Morgan"],
      ["Signed receipt: Casey"],
      ["Selected appendix: planned operations only"],
    ],
    pages: [1, 3],
    batchSize: 1,
    claims: [
      { question: "When did the actual transfer finish?", evidence: [] },
      { question: "Who actually signed the transfer?", evidence: [] },
    ],
  },
  {
    id: "duplicated-page-selection",
    goal: "Check the page assignment before citing the audit outcome.",
    sheets: [["Audit outcome: accepted"], ["Appendix"]],
    pages: [2, 1, 2],
    batchSize: 2,
    blocked: "missing-pages",
    claims: [{ question: "What was the audit outcome?", evidence: [] }],
  },
  {
    id: "page-zero-selection",
    goal: "Check whether the exact requested page sequence exists before reading the receiving plan.",
    sheets: [["Receiving plan: Friday"], ["Schedule appendix"]],
    pages: [0, 1],
    batchSize: 1,
    blocked: "missing-pages",
    claims: [{ question: "When does receiving start?", evidence: [] }],
  },
  {
    id: "final-batch-mismatched-receipt",
    goal: "Cite the approved activation window and the named owner to the extent the assigned page reads can be verified.",
    sheets: [
      ["Owner: Rina"],
      ["Approved activation: Tuesday 19:00"],
      ["Annex instructions"],
    ],
    pages: [2, 3, 1],
    batchSize: 2,
    fault: { batch: 2, kind: "receipt-mismatch" },
    claims: [
      { question: "Who owns activation?", evidence: [] },
      {
        question: "When is the approved activation window?",
        evidence: [{ page: 2, quote: "Approved activation: Tuesday 19:00" }],
      },
    ],
  },
  {
    id: "interrupted-review-batches",
    goal: "Establish what can be verified about the review schedule and the backup check. Preserve any interruption in the report.",
    sheets: [
      ["Backup check: 08:30"],
      ["Schedule draft only"],
      ["Approved review: 14:30"],
      ["Index"],
    ],
    pages: [3, 2, 1, 4],
    batchSize: 1,
    fault: { batch: 3, kind: "read-error" },
    claims: [
      {
        question: "When is the approved review?",
        evidence: [{ page: 3, quote: "Approved review: 14:30" }],
      },
      { question: "When is the backup check?", evidence: [] },
    ],
  },
  {
    id: "interrupted-first-batch",
    goal: "Try to verify the exact day and destination from the assigned packet and report any unread pages.",
    sheets: [["Destination: archives"], ["Delivery day: Thursday"]],
    pages: [2, 1],
    batchSize: 1,
    fault: { batch: 1, kind: "read-error" },
    claims: [
      { question: "What is the delivery day?", evidence: [] },
      { question: "What is the destination?", evidence: [] },
    ],
  },
];

export function managedPdfExpectation({
  pages,
  batchSize,
  blocked,
  fault,
  claims,
}: World) {
  const readCount = blocked
    ? 0
    : fault
      ? (fault.batch - 1) * batchSize
      : pages.length;
  const answered = claims.filter(({ evidence }) => evidence.length > 0).length;
  const attempted = blocked
    ? 0
    : (fault?.batch ?? Math.ceil(pages.length / batchSize));
  return {
    expectedStatus:
      blocked ??
      (fault
        ? "incomplete"
        : answered === 0
          ? "no-match"
          : answered === claims.length
            ? "verified"
            : "partial-match"),
    readPages: pages.slice(0, readCount),
    remaining: pages.slice(readCount),
    attemptedBatches: Array.from({ length: attempted }, (_, index) =>
      pages.slice(index * batchSize, (index + 1) * batchSize),
    ),
  };
}
