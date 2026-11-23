import { expect, it } from "vitest";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  readdir,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { prepareOpenTendrilRoute } from "./open-goal-tendril-route-managed.js";
import { openTendrilRouteWorlds } from "./open-goal-tendril-route-worlds.js";
import { tendrilPanel } from "./tendril-worlds.js";

it("accepts repeated authentic probes, but rejects foreign slots, stale revisions and forged findings", async () => {
  const world = openTendrilRouteWorlds.find(
    (w) => w.id === "tendril-route-capture-supply-label",
  )!;
  const prepared = await prepareOpenTendrilRoute(
    { contextId: "owned", caseId: world.id },
    world,
    {
      contextId: "owned",
      head: async () => "unchanged",
      file: {
        mkdtemp: (prefix) => mkdtemp(tmpdir() + "/" + prefix),
        readFile,
        writeFile,
        rm,
        readdir,
        exists: async (path) => {
          try {
            await access(path);
            return true;
          } catch {
            return false;
          }
        },
      },
      create: async (context, seed) => {
        const id = seed.key,
          channel = id + ":room";
        let rev = 0;
        const state: Record<string, unknown> = {};
        const presentations: unknown[] = [],
          functions: { slotId: string; name: string; phrases: string[] }[] = [];
        return {
          id,
          channel,
          describe: async () => ({
            tendrilId: id,
            contextId: context,
            channelId: channel,
            source: tendrilPanel,
            name: seed.title,
            rev,
            presentations,
            functions,
          }),
          state: async () => structuredClone({ rev, state }),
          apply: async (ops) => {
            for (const op of ops) {
              let target: any = state;
              for (const key of op.path.slice(0, -1)) target = target[key];
              target[op.path.at(-1)!] = structuredClone((op as any).value);
            }
            return { rev: ++rev };
          },
          register: async (slot) => {
            presentations.push(slot);
          },
          functions: async (slotId, values) => {
            for (const value of values)
              functions.push({
                slotId,
                name: value.name,
                phrases: value.phrases ?? [],
              });
          },
          readChannel: async () => ({
            contextId: context,
            title: seed.room,
            envelopes: [],
          }),
        };
      },
    } as never,
  );
  try {
    const proof = await prepared.qualify();
    expect(proof.passed).toBe(true);
    const finding = proof.finding!;
    const value = {
        status: world.expected.decision,
        finding,
        receipt: proof.receipt,
        reason:
          world.expected.reason.join(" ") ||
          "Matched the retained owned Tendril route",
      };
    await prepared.services.tendrilRouteRead.listBoards();
    await prepared.services.tendrilRouteRead.readBoard(finding.id);
    await prepared.services.tendrilRouteRead.probe(
      finding.id,
      finding.slot,
      finding.revision,
    );
    await prepared.services.tendrilRouteRead.probe(
      finding.id,
      finding.slot,
      finding.revision,
    );
    expect((await prepared.verify(value)).passed).toBe(true);
    await expect(
      prepared.services.tendrilRouteRead.probe(
        "foreign",
        finding.slot,
        finding.revision,
      ),
    ).rejects.toThrow();
    await expect(
      prepared.services.tendrilRouteRead.probe(
        finding.id,
        "foreign",
        finding.revision,
      ),
    ).rejects.toThrow();
    await expect(
      prepared.services.tendrilRouteRead.probe(
        finding.id,
        finding.slot,
        "stale",
      ),
    ).rejects.toThrow();
    expect(
      (
        await prepared.verify({
            ...value,
            finding: { ...finding, revision: "stale" },
          })
      ).passed,
    ).toBe(false);
  } finally {
    await prepared.close();
  }
});
