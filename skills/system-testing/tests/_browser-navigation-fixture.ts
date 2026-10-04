// Own the documents whose rendered headings the navigation scenarios require.
// Public example domains are documentation placeholders, not stable test pages.
// Data URLs use the ordinary browser-panel path without another HTTP service.
function page(title: string, heading: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${heading}</h1><p>A disposable browser navigation fixture.</p></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export const INITIAL_BROWSER_PAGE = page(
  "Initial comparison page",
  "Northern harbour",
);
export const FINAL_BROWSER_PAGE = page(
  "Final comparison page",
  "Southern garden",
);
