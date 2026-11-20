import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, describe, it } from "vitest";
import * as updateModel from "@workspace/client-update-core";
import * as updateProjection from "@workspace-clients/desktop-browser/update-projection";
import * as layout from "@workspace-clients/desktop-browser/placement";
import { bindClientAdmission } from "@workspace-skills/clientdev/workflow";
import { openDesktopReadinessWorlds } from "./open-goal-desktop-readiness-worlds.js";
import { prepareDesktopReadiness } from "./open-goal-desktop-readiness-managed.js";

type Ports = Parameters<typeof prepareDesktopReadiness>[2];

describe("desktop readiness with the installed client and canonical projections", () => {
  for (const world of openDesktopReadinessWorlds) {
    it(world.id, async () => {
      const contextId = "readiness-" + world.id;
      const system =
        process.env.VIBE_SYSTEM_TEMPLATE ??
        path.resolve(import.meta.dirname, "../../../system");
      const files = {
        "clients/desktop-browser/package.json": await fs.readFile(
          path.join(system, "clients/desktop-browser/package.json"),
          "utf8",
        ),
        "meta/vibestudio.yml": await fs.readFile(
          path.join(system, "meta/vibestudio.yml"),
          "utf8",
        ),
      };
      const calls: string[] = [];
      const ports = {
        contextId,
        desktop: { updateModel, updateProjection, layout, bindClientAdmission },
        vcs: {
          async status(input: { contextId: string }) {
            expect(input.contextId).toBe(contextId);
            return {
              mainEventId: "main-1",
              workingHead: { kind: "event", eventId: "main-1" },
            };
          },
          async resolveRepository(input: { state: unknown; repoPath: string }) {
            expect(input.state).toEqual({ kind: "event", eventId: "main-1" });
            return { repositoryId: input.repoPath };
          },
          async readFile(input: {
            repositoryId: string;
            file: { path: string };
            state: unknown;
          }) {
            expect(input.state).toEqual({ kind: "event", eventId: "main-1" });
            const key = (input.repositoryId +
              "/" +
              input.file.path) as keyof typeof files;
            const text = files[key];
            expect(text).toBeTypeOf("string");
            return {
              contentHash: createHash("sha256").update(text).digest("hex"),
              content: { kind: "text", text },
            };
          },
        },
        rpc: {
          async call(
            target: string,
            method: { name: string },
            args: unknown[],
          ) {
            expect(target).toBe("main");
            expect(method.name).toBe("build.listUnits");
            expect(args).toEqual([]);
            calls.push(method.name);
            return [
              {
                kind: "extension",
                source: "clients/desktop-browser",
                status: "building",
              },
              {
                kind: "client",
                source: "clients/desktop-browser",
                status: "ready",
                effectiveVersion: "installed",
                activeBuildKey: "actual-readback",
              },
            ];
          },
        },
      } as unknown as Ports;
      const fixture = await prepareDesktopReadiness(
        { contextId, caseId: world.id },
        world,
        ports,
      );
      const report = await fixture.qualify();
      expect(report.checks).toEqual(
        Object.fromEntries(
          Object.keys(report.checks).map((key) => [key, true]),
        ),
      );
      expect(calls).toEqual([
        "build.listUnits",
        "build.listUnits",
        "build.listUnits",
      ]);
      expect(
        report.exactAdmission?.source.observation.catalog?.activeBuildKey,
      ).toBe("actual-readback");
      expect(report.updates.portCalls).toBe(0);
      const destination = process.env.VIBE_DESKTOP_PROOFS;
      if (destination)
        await fs.writeFile(
          path.join(destination, world.id + ".json"),
          JSON.stringify(report),
        );
    });
  }
});
