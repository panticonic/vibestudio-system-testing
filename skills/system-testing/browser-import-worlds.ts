const categories = ["bookmarks", "history"] as const;
const totals = [
  { category: "bookmarks", total: 4 },
  { category: "history", total: 0 },
] as const;
const progress = [
  { category: "bookmarks", stored: 3, skipped: 1, errors: 0 },
  { category: "history", stored: 1, skipped: 0, errors: 2 },
] as const;
const available = { state: "available", categories } as const;
const blocked = { state: "blocked", categories } as const;
const partial = { phase: "partial", resumable: true, progress } as const;

export const managedBrowserImportWorlds = [
  {
    id: "preview-with-zero-history",
    goal: "Review bookmarks and history from my selected Firefox source. Tell me whether the preview covers both categories and preserve any zero counts.",
    kind: "preview",
    categories,
    source: available,
    dropSourceBeforePreview: false,
    preview: { status: "previewed", totals, warningCount: 1 },
    job: null,
    reads: ["source", "preview"],
    expected: {
      next: "review-preview",
      source: available,
      totals,
      progress: [],
    },
  },
  {
    id: "source-lost-after-review",
    goal: "Review the selected migration source. If it disappears after inspection, keep the first observation and route me back to the inspector to choose a source.",
    kind: "preview",
    categories,
    source: available,
    dropSourceBeforePreview: true,
    preview: { status: "source-changed", totals: [], warningCount: 0 },
    job: null,
    reads: ["source", "preview"],
    expected: {
      next: "use-inspector",
      source: available,
      totals: [],
      progress: [],
    },
  },
  {
    id: "partial-import-original-source-ready",
    goal: "Recover the retained import for my selected Firefox source. Explain what was stored and skipped, and whether to review a retry for the same source.",
    kind: "recover",
    categories,
    source: available,
    dropSourceBeforePreview: false,
    preview: null,
    job: partial,
    reads: ["history", "source"],
    expected: { next: "review-retry", source: available, totals: [], progress },
  },
  {
    id: "partial-import-original-source-blocked",
    goal: "Recover the retained import. The workspace kept some results, and the original Firefox source is now blocked. Preserve the counts and guide me to the right action.",
    kind: "recover",
    categories,
    source: blocked,
    dropSourceBeforePreview: false,
    preview: null,
    job: partial,
    reads: ["history", "source"],
    expected: { next: "use-inspector", source: blocked, totals: [], progress },
  },
  {
    id: "cancelled-import-keeps-batches",
    goal: "What survived the import I cancelled? Keep the observed batches and respect the cancellation.",
    kind: "recover",
    categories,
    source: available,
    dropSourceBeforePreview: false,
    preview: null,
    job: { phase: "cancelled", resumable: true, progress },
    reads: ["history"],
    expected: { next: "keep-results", source: null, totals: [], progress },
  },
] as const;
