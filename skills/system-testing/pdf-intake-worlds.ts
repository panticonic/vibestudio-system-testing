type Claim = { question: string; evidence: { page: number; quote: string }[] };
type World = {
  id: string;
  goal: string;
  sheets: string[][];
  pages: number[];
  batchSize: number;
  purpose?: "text" | "layout" | "ocr";
  blocked?: "missing-pages" | "engine-unavailable";
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
];
