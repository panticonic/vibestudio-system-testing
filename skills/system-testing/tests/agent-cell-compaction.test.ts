import { describe, expect, it } from "vitest";
import { evalLifecycleTests } from "./eval-lifecycle.js";

const test = evalLifecycleTests.find(
  (candidate) => candidate.name === "agent-cell-compaction-soak",
)!;
const evidence = () => ({
  turns: 65,
  validatedTurns: 65,
  modelCalls: 0,
  nativeReceiptDigest: "a".repeat(64),
  firstStorage: {
    engine: "dolt",
    compaction: {
      head: "initial",
      lastCollectedHead: null,
      observedCommitsAtLastCollection: null,
      logLimit: 10000,
    },
  },
  lastStorage: {
    engine: "dolt",
    compaction: {
      head: "after",
      lastCollectedHead: "collected",
      observedCommitsAtLastCollection: 64,
      logLimit: 10000,
    },
  },
});
async function validate(probe: unknown) {
  return test.validate!({
    messages: [],
    duration: 0,
    diagnostics: { agentCellCompaction: probe },
  });
}
describe("actual agent compaction evidence", () => {
  it("accepts joined model-free turns with a real collection observation", async () => {
    expect(await validate(evidence())).toMatchObject({ passed: true });
  });
  it.each([
    [
      "not enough turns",
      (p: ReturnType<typeof evidence>) => {
        p.turns = 64;
      },
    ],
    [
      "unjoined results",
      (p: ReturnType<typeof evidence>) => {
        p.validatedTurns = 64;
      },
    ],
    [
      "a model was used",
      (p: ReturnType<typeof evidence>) => {
        p.modelCalls = 1;
      },
    ],
    [
      "no collection",
      (p: ReturnType<typeof evidence>) => {
        p.lastStorage.compaction.lastCollectedHead = "";
      },
    ],
    [
      "premature collection",
      (p: ReturnType<typeof evidence>) => {
        p.lastStorage.compaction.observedCommitsAtLastCollection = 63;
      },
    ],
    [
      "no receipt chain",
      (p: ReturnType<typeof evidence>) => {
        p.nativeReceiptDigest = "";
      },
    ],
  ] as const)("rejects %s", async (_name, change) => {
    const probe = evidence();
    change(probe);
    expect(await validate(probe)).toMatchObject({ passed: false });
  });
  it("rejects a missing observation instead of throwing", async () => {
    expect(
      await validate({ turns: 65, validatedTurns: 65, modelCalls: 0 }),
    ).toMatchObject({ passed: false });
  });
});
