import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkWorkspaceNatlangPrograms,
  UPDATE_DECLARATIONS_ENV,
} from "@workspace/natlang/testing";
import { expect, it } from "vitest";

it("compiles the session-test reviewer and verifies its generated signatures", async () => {
  const source = fileURLToPath(
    new URL("../session-test-review", import.meta.url),
  );
  const temporary = await mkdtemp(path.join(tmpdir(), "session-test-review-"));
  const program = "skills/session-test-review";
  const target = path.join(temporary, program);
  const updateDeclarations = process.env[UPDATE_DECLARATIONS_ENV] === "1";
  try {
    await mkdir(path.dirname(target));
    await cp(source, target, { recursive: true });
    expect(
      await checkWorkspaceNatlangPrograms(temporary, { updateDeclarations }),
    ).toEqual([{ program, failure: null }]);
    if (updateDeclarations) {
      for (const file of await readdir(target, { recursive: true })) {
        if (file.endsWith(".d.nl.ts"))
          await cp(path.join(target, file), path.join(source, file));
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
