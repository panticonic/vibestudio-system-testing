import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prepareGoogleRunbook, prepareNewsEditionReview } from "./open-goal-product-owned-managed.js";

vi.mock("@workspace/runtime", () => ({ contextId: "owned", fs: {}, vcs: {} }));
vi.mock("@vibestudio/content-addressing", () => ({
  sha256HexSyncText: (text: string) => createHash("sha256").update(text).digest("hex"),
}));
vi.mock("@workspace-skills/scratch-handoff-bindings", () => ({ bindScratchHandoff: () => ({}) }));
vi.mock("@workspace-skills/visualize/render", () => ({ renderComponent: () => ({}) }));
vi.mock("./open-goal-news-evidence-managed.js", () => ({ prepareOpenNewsEvidenceWorld: vi.fn() }));

const input = { contextId: "owned", caseId: "assigned" };
function workspace() {
  const files = new Map<string, string>();
  return {
    contextId: input.contextId,
    status: async () => ({ mainEventId: "unchanged" }),
    fs: {
      mkdtemp: async (label: string) => "/scratch/" + label,
      writeFile: async (path: string, text: string) => void files.set(path, text),
      readFile: async (path: string) => files.get(path),
    },
  } as never;
}

it("rejects an incomplete News edition while retaining the native workspace checks", async () => {
  const verify = vi.fn(() => ({ passed: false }));
  const prepared = await prepareNewsEditionReview(input, {
    id: input.caseId, goal: "report the selected edition", title: "Current edition",
    news: { topic: "service changes" }, grant: "read-only", format: "brief",
    facts: [], action: "hold", spec: {},
  } as never, {} as never, workspace(), async () => ({ services: {}, verifyEvidence:verify, observedEvidence:async()=>null }) as never);
  for (const outcome of [{}, { news: { handoff: null } }]) {
    const result = await prepared.verify(outcome);
    expect(result.checks).toMatchObject({
      current_news_edition: false,
      exact_basis_attribution: false,
      preserved_workspace: true,
    });
    expect(result.passed).toBe(false);
  }
  expect(verify).not.toHaveBeenCalled();
});

it("rejects an incomplete runbook report without reading missing decision or Calendar fields", async () => {
  const verify = vi.fn();
  const prepared = await prepareGoogleRunbook(input, {
    id: input.caseId, goal: "check the runbook", before: "current notes", approval: "APP-REVIEW",
    authorization: "read only", action: "hold",
  } as never, { services: {}, verify } as never, workspace());
  const result = await prepared.verify({});
  expect(result.checks).toMatchObject({
    current_calendar: false,
    runbook_authority: false,
    exact_basis_attribution: false,
    preserved_workspace: true,
  });
  expect(result.passed).toBe(false);
  expect(verify).not.toHaveBeenCalled();
});
