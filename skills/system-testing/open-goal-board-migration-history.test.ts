import {mkdtemp, readFile, writeFile, open, rm, access} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect, it, vi} from "vitest";
import {openBoardMigrationWorlds} from "./open-goal-board-migration-worlds.js";

// Unit adapter for the browser boundary. The fixture's authority, filesystem,
// admission and verifier execute unchanged; this is not a native CDP qualifier.
vi.mock("@workspace/runtime", () => ({
  contextId: "owned-migration-history",
  fs: {
    mkdtemp: (prefix: string) => mkdtemp(join(tmpdir(), prefix)),
    readFile, writeFile, open, rm,
    exists: (path: string) => access(path).then(() => true, () => false),
  },
  openPanel: async (url: string) => {
    const text = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    const unescape = (value: string) => value.replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
    const field = (source: string, key: string) => unescape(source.match(new RegExp(`<[^>]*${key}[^>]*>([^<]*)</`))?.[1] ?? "");
    const rendered = {
      id: text.match(/data-board="([^"]+)"/)![1], title: field(text, "h1"), edition: field(text, "data-edition"),
      cards: [...text.matchAll(/<article data-card="([^"]+)" data-archived="([^"]+)">([\s\S]*?)<\/article>/g)].map(([, id, archived, body]) => ({
        id, archived: archived === "true", title: field(body!, "h2"), list: field(body!, "data-list"), summary: field(body!, "data-summary"),
        checklist: [...body!.matchAll(/<p data-check>([^<]*)<\/p>/g)].map(match => unescape(match[1]!)),
        attachments: [...body!.matchAll(/<p data-attachment>([^<]*)<\/p>/g)].map(match => unescape(match[1]!)),
      })),
    };
    const panelId = "panel:" + rendered.id;
    return {id: panelId, observe: async () => ({kind: "browser", source: "browser:" + url, panelId}), archive: async () => {},
      cdp: {session: async () => ({receipt: {generation: {panelId}}, page: {waitForSelector: async () => {}, evaluate: async () => structuredClone(rendered)}, close: async () => {}})}};
  },
}));

import {prepareOpenBoardMigration} from "./open-goal-board-migration-managed.js";

it("preserves pre-write authority when the actor reads its successful retained result", async () => {
  const world = openBoardMigrationWorlds.find(world => world.id === "board-migration-trio-two-artifact")!;
  expect(world).toBeDefined();
  const fixture = await prepareOpenBoardMigration({caseId: world.id, goal: world.goal, contextId: "owned-migration-history"}, world);
  try {
    const service = fixture.services.boardMigration;
    const source = (await service.listSources()).find(row => row.edition === "handoff edition")!;
    const view = await service.inspect(source.id);
    const before = await service.readTarget();
    expect(before.existing).toBeNull();
    const receipt = await service.retain(view.board.id, view.board.revision, {target: before.target, cards: view.cards.filter(card => card.id === "trio")});
    expect(receipt).not.toBeNull();
    const after = await service.readTarget();
    expect(after.existing).toEqual(receipt!.cards);
    after.approval = null;
    const proof = await fixture.verify({disposition: "retained", receipt, reason: "Kept the requested current Trio with its checklist and attachment."});
    expect(proof.checks.exactMigrationAuthority).toBe(true);
    expect(proof.passed).toBe(true);
    expect(proof.targetObservations).toHaveLength(2);
  } finally {await fixture.close();}
});

it("does not manufacture actor authority from verifier-only reads", async () => {
  const world = openBoardMigrationWorlds.find(world => world.id === "board-migration-trio-two-artifact")!;
  const fixture = await prepareOpenBoardMigration({caseId: world.id, goal: world.goal, contextId: "owned-migration-history"}, world);
  try {
    const source = (await fixture.services.boardMigration.listSources()).find(row => row.edition === "handoff edition")!;
    const view = await fixture.services.boardMigration.inspect(source.id);
    expect(await fixture.services.boardMigration.retain(view.board.id, view.board.revision, {target: world.target, cards: view.cards.filter(card => card.id === "trio")})).toBeNull();
    const proof = await fixture.verify({disposition: "held", receipt: null, reason: "No authority observed."});
    expect(proof.checks.exactMigrationAuthority).toBe(false);
    expect(proof.checks.independentMigrationReadback).toBe(false);
    expect(proof.passed).toBe(false);
  } finally {await fixture.close();}
});
