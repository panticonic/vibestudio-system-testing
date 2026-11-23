import { expect, it, vi } from "vitest";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { bindTerminalDiscovery } from "./open-goal-terminal-discovery.js";

it("uses known live contracts and installed knowledge without a search route or aggregate call quota", async () => {
  const guide = "skills/terminal-apps";
  const quote = "Detaching leaves this program running and preserves the same session.";
  const rpc = { call: vi.fn(async (_target, method, args) => {
    if (method === mainRpcMethods["docs.search"]) return [];
    if (method === mainRpcMethods["docs.describe"]) return { id: args[0], surface: "service", qualifiedName: String(args[0]).slice(8), description: "Owned terminal operation", argsSchema: {}, returnsSchema: {}, argumentNames: [] };
    if (method === mainRpcMethods["docs.getSchema"]) return { argsSchema: {}, returnsSchema: {} };
    if (method === mainRpcMethods["workspace.listSkills"]) return [...Array.from({ length: 100 }, (_, i) => ({ dirPath: `skills/other-${i}`, skillPath: `skills/other-${i}/SKILL.md`, name: `Other ${i}`, description: "Other installed guide" })), { dirPath: guide, skillPath: guide + "/SKILL.md", name: "Terminal apps", description: "Durable terminal rules" }];
    if (method === mainRpcMethods["workspace.readSkill"]) return args[0] === guide ? "# Durable terminal rules\n\n" + quote : null;
    throw new Error("Unexpected native method");
  }) };
  const bound = bindTerminalDiscovery(rpc as never, () => {});
  for (let i = 0; i < 10; i++) await bound.services.search("terminal sessions");
  const route = await bound.services.open("service:terminalApps.list");
  expect(route).not.toBeNull();
  const extra = await bound.services.open("service:terminalApps.resume");
  let loaded;
  for (let i = 0; i < 6; i++) loaded = await bound.services.load(guide, ["running", "session"]);
  expect(loaded?.skillPath).toBe(guide + "/SKILL.md");
  const actual = { routes: [extra!, route!], guidance: [{ skillPath: loaded!.skillPath, sha256: loaded!.sha256, quote }] };
  const expected = { methods: ["terminalApps.list"], guidance: [{ dirPath: guide, focus: ["session"], rule: /running/u }] };
  expect(await bound.verify(actual, expected)).toBe(true);
  expect(await bound.verify({ ...actual, routes: [{ ...route!, sha256: "invented" }] }, expected)).toBe(false);
  expect(await bound.verify({ ...actual, guidance: [{ ...actual.guidance[0]!, quote: "Invented authority says it keeps running." }] }, expected)).toBe(false);
  expect(await bound.services.load("skills/not-installed", ["private"])).toBeNull();
});
