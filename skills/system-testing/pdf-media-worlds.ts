const lines = ["Dispatch notes", "Depot access closes at six."] as const;

export const pdfMediaWorlds = [
  { id: "rendered-notice-evidence", goal: "Verify whether the second page has an actual image artifact suitable for handoff.", need: "image", requested: [2], extracted: [2], pages: lines, images: true, disposition: "pdf-ready" },
  { id: "complete-report-layout", goal: "Review the layout and geometry for both pages of the dispatch packet.", need: "structure", requested: [1, 2], extracted: [1, 2], pages: lines, images: false, disposition: "pdf-ready" },
  { id: "missing-extract-page", goal: "Check that the supplied extraction covers both pages of the dispatch report.", need: "text", requested: [1, 2], extracted: [1], pages: lines, images: false, disposition: "missing-pages" },
  { id: "blank-appendix-layout", goal: "Check the second page for usable layout evidence before handing it to the renderer.", need: "structure", requested: [2], extracted: [2], pages: [lines[0], ""], images: false, disposition: "missing-layout" },
  { id: "text-only-extract-image-needed", goal: "Review whether the attachment includes an image of the notice.", need: "image", requested: [2], extracted: [2], pages: lines, images: false, disposition: "missing-artifact" },
] as const;
