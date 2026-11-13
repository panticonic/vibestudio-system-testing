import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { workspaceProgramFailures } from "@workspace/natlang/testing";

// Every natlang program in this template compiles (the checks `natlang.load` runs) and its generated `.d.nl.ts`
// declarations are exactly what natlang emits. Regenerate them with NATLANG_UPDATE_DECLARATIONS=1.
describe("workspace natlang programs", () => {
  it("all compile, with current declarations", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    expect(await workspaceProgramFailures(root)).toEqual([]);
  });
});
