import type { OwnedResearchPage } from "./open-goal-owned-research-worlds.js";

const escapeHtml = (text: string) => text.replace(/[&<>"']/gu, value =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);

export function ownedResearchDocument(page: OwnedResearchPage) {
  if (page.format === "text") {
    return { contentType: "text/plain; charset=utf-8", body: [page.title, ...page.paragraphs].join("\n\n") + "\n" };
  }
  return { contentType: "text/html; charset=utf-8", body:
    `<!doctype html><html lang="en"><head><title>${escapeHtml(page.title)}</title></head><body><main><article><h1>${escapeHtml(page.title)}</h1>` +
    page.paragraphs.map(text => `<p>${escapeHtml(text)}</p>`).join("") + "</article></main></body></html>" };
}

export function ownedResearchEndpointInput(pages: readonly OwnedResearchPage[], nonce: string) {
  if (!/^[a-f0-9]{24}$/u.test(nonce) || !pages.length || pages.length > 4)
    throw new Error("Use an exact finite owned research address");
  const sites = Object.fromEntries(pages.map(page => {
    if (!/^[a-z][a-z0-9-]{0,31}$/u.test(page.id)) throw new Error("Invalid owned page identity");
    const document = ownedResearchDocument(page);
    if (new TextEncoder().encode(document.body).length > 10_000) throw new Error("Owned research fixture page is too large");
    return [`/${nonce}/${page.id}`, { ...document, status: page.unavailable ? 503 : 200 }];
  }));
  if (Object.keys(sites).length !== pages.length) throw new Error("Duplicate owned research page");
  return JSON.stringify(sites);
}

/** Finite, cookie-free, loopback-only GET server. Runs in the native shell, never in the model. */
export const ownedResearchServerProgram = String.raw`
const { createServer } = require("node:http");
const routes = JSON.parse(process.argv[1]);
const server = createServer((request, response) => {
  const item = Object.hasOwn(routes, request.url) ? routes[request.url] : null;
  const authority = "127.0.0.1:" + server.address().port;
  if (request.method !== "GET" || request.headers.host !== authority || !item ||
      request.headers.cookie || request.headers.authorization) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not available in this research fixture");
    return;
  }
  response.writeHead(item.status, {
    "Content-Type": item.contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'",
  });
  response.end(item.body);
});
server.requestTimeout = 8000;
server.headersTimeout = 5000;
server.listen(0, "127.0.0.1", () => process.stdout.write("OWNED_RESEARCH_READY " + server.address().port + " END\n"));
setTimeout(() => server.close(), 360000).unref();
`;
