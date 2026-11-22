import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { prepareOpenGoal } from "./open-goal-managed.js";
import { openGoalWorlds } from "./open-goal-worlds.js";

vi.mock("./open-goal-suite-managed.js", () => ({ prepareOpenGoalSuite: vi.fn() }));

const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("@workspace/runtime", () => ({
  fs: {
    readFile, readdir, writeFile,
    async mkdtemp(prefix: string) {
      fixture.directory = await mkdtemp(join(tmpdir(), prefix));
      return fixture.directory;
    },
  },
  web: {},
}));

afterEach(async () => {
  if (fixture.directory) await rm(fixture.directory, { recursive: true, force: true });
  fixture.directory = "";
});

it("requires fresh observations and independently reads back a recovered revision", async () => {
  const world = openGoalWorlds.find(({ id }) => id === "reconcile-workshop-update");
  if (world?.kind !== "workspace-edit") throw new Error("Expected the workshop fixture");
  const files: Readonly<Record<string, string>> = world.files;
  const prepared = await prepareOpenGoal({ contextId: "owned-context", caseId: world.id });
  if (!("goalWorkspace" in prepared.services)) throw new Error("Expected the document workspace binding");
  const workspace = prepared.services.goalWorkspace;
  expect(await workspace.list()).toEqual(Object.keys(files).sort());
  const earlier = await workspace.read(world.destination);
  expect(earlier?.text).toBe(files[world.destination]);
  expect(await workspace.read(world.source)).toBeTruthy();
  expect(await workspace.revise(world.destination, earlier!.version, world.expected)).toEqual({ status: "changed" });
  expect((await prepared.verify({ status: "edited" })).passed).toBe(false);
  const latest = await workspace.read(world.destination);
  expect(latest?.text).toContain(world.concurrentAddition);
  const write = await workspace.revise(world.destination, latest!.version, world.expected);
  expect(write.status).toBe("written");
  if (!("version" in write)) throw new Error("Missing stored document version");
  await workspace.read(world.destination);
  const report = { status: "edited", path: world.destination, version: write.version };
  expect((await prepared.verify(report)).passed).toBe(true);
  await writeFile(join(fixture.directory, world.source), "changed source");
  expect((await prepared.verify(report)).passed).toBe(false);
});

it("accepts a correct recovered edit after extra stale retries without requiring a list route", async () => {
  const world = openGoalWorlds.find(({ id }) => id === "reconcile-workshop-update");
  if (world?.kind !== "workspace-edit") throw new Error("Expected the workshop fixture");
  const prepared = await prepareOpenGoal({ contextId: "owned-context", caseId: world.id });
  if (!("goalWorkspace" in prepared.services)) throw new Error("Expected document bindings");
  const workspace = prepared.services.goalWorkspace;
  await workspace.read(world.source);
  const original = await workspace.read(world.destination);
  expect((await workspace.revise(world.destination, original!.version, world.expected)).status).toBe("changed");
  expect((await workspace.revise(world.destination, original!.version, world.expected)).status).toBe("changed");
  const fresh = await workspace.read(world.destination);
  const result = await workspace.revise(world.destination, fresh!.version, world.expected);
  if (!("version" in result)) throw new Error("Expected stored revision");
  await workspace.read(world.destination);
  expect((await prepared.verify({ status: "edited", path: world.destination, version: result.version })).passed).toBe(true);
});
