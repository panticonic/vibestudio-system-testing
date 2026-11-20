import assert from "node:assert/strict";
import { test } from "node:test";
import { listOwnedScratchEntries } from "./owned-scratch-entries.ts";

test("an absent owned scratch directory is empty", async () => {
  const missing = Object.assign(new Error("directory missing"), {
    code: "ENOENT",
  });
  const entries = await listOwnedScratchEntries({
    async readdir(path) {
      assert.equal(path, "/.tmp");
      throw missing;
    },
  });

  assert.deepEqual(entries, []);
});

test("a populated owned scratch directory returns the actual entries", async () => {
  const entries = ["unrelated-step", "evidence-handoff-0"];
  const current = await listOwnedScratchEntries({
    async readdir(path) {
      assert.equal(path, "/.tmp");
      return entries;
    },
  });

  assert.deepEqual(current, entries);
});

test("inspection errors propagate to the evidence verifier", async () => {
  const refusal = Object.assign(new Error("directory access refused"), {
    code: "EACCES",
  });
  await assert.rejects(
    listOwnedScratchEntries({
      async readdir() {
        throw refusal;
      },
    }),
    refusal,
  );
});
