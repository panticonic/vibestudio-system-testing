import { expect, it } from "vitest";
import { prepareRouteAuthority, compareExactAuthority } from "./open-goal-route-authority-managed.js";
import { openRouteAuthorityWorlds } from "./open-goal-route-authority-worlds.js";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
it("accepts only the nominated local preflight and rejects invented authority", async () => {
  const world = openRouteAuthorityWorlds.find(row => row.route === "working" && !row.note)!;
  let sequence = 0, head: any = { kind: "event", eventId: "main" }, committed = head, current = "";
  const sources = new Map<string, string>(), files = new Map<string, string>();
  const status = () => ({ contextId: "owned", clean: true, integrating: [], mainEventId: "main", workingHead: head, committed });
  const prepared = await prepareRouteAuthority({ contextId: "owned", caseId: world.id }, {
    contextId: "owned", vcs: { status: async () => status(),
      async edit(args: any) { const c = args.changes[0]; current = c.files?.[0].content.text ?? c.content.text;
        head = { kind: "application", applicationId: String(++sequence) }; sources.set(JSON.stringify(head), current); return { workingHead: head }; },
      async commit() { committed = head = { kind: "event", eventId: String(++sequence) }; sources.set(JSON.stringify(head), current); return { event: head }; },
      async resolveRepository() { return { repositoryId: "repo" }; },
      async readFile(args: any) { const text = sources.get(JSON.stringify(args.state))!; return { fileId: "file", content: { kind: "text", text }, contentHash: sha256HexSyncText(text) }; } },
    fs: { mkdtemp: async () => "/owned", writeFile: async (p: string, v: string) => { files.set(p, v); }, exists: async (p: string) => files.has(p), readdir: async () => [] },
    readBytes: async (p: string) => new TextEncoder().encode(files.get(p)!),
    bindAuthority: (request: any) => ({ request, services: { assignedAuthorityRead: { async preflight(id: string) { return { operationId: id, decision: "allowed", leaves: [] }; } } } }),
  } as never);
  const s = prepared.services, offer = await s.routeEvidenceRead.discover(), route = offer.routes.find(row => row.basis === "working")!;
  const observations = await Promise.all(route.operationIds.map(id => s.assignedAuthorityRead.preflight(id)));
  expect(observations).toHaveLength(2);
  const readback = await s.routeEvidenceRead.inspect(route.id);
  const report = { offer, choice: { routeId: route.id, execute: true, retain: false, reason: "Current local value requested" }, authority: compareExactAuthority(observations, []), readback, outcome: { status: "verified", summary: "Read actual current local record" }, handoff: null };
  expect((await prepared.verify({ status: "workspace-skill-reviewed", skill: "ownedRouteAuthority", outcome: report })).passed).toBe(true);
  await expect(s.assignedAuthorityRead.preflight("foreign-operation")).rejects.toThrow("scoped");
  expect((await prepared.verify({ status: "workspace-skill-reviewed", skill: "ownedRouteAuthority", outcome: { ...report, authority: { ...report.authority, reviews: [] } } })).passed).toBe(false);
});
