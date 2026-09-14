import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  cancel: vi.fn(),
  forgetJob: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@workspace/runtime", () => ({
  blobstore: {},
  images: { getJob: mocks.getJob, cancel: mocks.cancel, forgetJob: mocks.forgetJob },
  vcs: { status: mocks.status },
}));
vi.mock("../image-panel-fixture.js", () => ({
  importImagePanelFixture: async () => ({ repoPath: "panels/owned", contextId: "context:owned" }),
}));
import { imagePanelTests, validateImagePanel } from "./image-panel.js";
function execution() {
  const frame = {
    boot: "boot1",
    job: "job1",
    asset: "asset1",
    digest: "digest1",
    status: "succeeded",
    error: "",
    loaded: true,
    width: 1536,
    height: 1024,
    src: "blob:first",
  };
  return {
    messages: [],
    duration: 1,
    diagnostics: {
      imagePanel: {
        before: { ...frame, status: "idle" },
        first: { ...frame },
        reloaded: { ...frame, boot: "boot2" },
        edited: { ...frame, boot: "boot2", job: "job2", asset: "asset2", digest: "digest2" },
        sourceUnchanged: true,
        cleanupComplete: true,
      },
    },
  };
}
it("accepts dynamically decoded assets with reload recovery and released jobs", () => {
  expect(validateImagePanel(execution()).passed).toBe(true);
});
it("rejects remounting to display a newly generated scene", () => {
  const value = execution();
  value.diagnostics.imagePanel.first.boot = "replacement";
  expect(validateImagePanel(value)).toMatchObject({
    passed: false,
    reason: expect.stringContaining("remounted"),
  });
});
it("rejects lost reload state and source-file rewrites", () => {
  const value = execution();
  value.diagnostics.imagePanel.reloaded.job = "new-job";
  expect(validateImagePanel(value).passed).toBe(false);
  const changed = execution();
  changed.diagnostics.imagePanel.sourceUnchanged = false;
  expect(validateImagePanel(changed).passed).toBe(false);
});
it("rejects incomplete decode and leaked jobs", () => {
  const value = execution();
  value.diagnostics.imagePanel.edited.loaded = false;
  expect(validateImagePanel(value).passed).toBe(false);
  const leaked = execution();
  leaked.diagnostics.imagePanel.cleanupComplete = false;
  expect(validateImagePanel(leaked).passed).toBe(false);
});

it("cancels and releases owned jobs and archives the panel after a primary failure", async () => {
  mocks.status.mockResolvedValue({ workingHead: { kind: "event", eventId: "source" } });
  mocks.getJob.mockResolvedValue({ id: "job:owned", status: "running" });
  mocks.cancel.mockResolvedValue({ id: "job:owned", status: "cancelled" });
  mocks.forgetJob.mockResolvedValue(undefined);
  const archive = vi.fn(async () => {});
  const handle = {
    stateArgs: { get: async () => ({ jobs: ["job:owned"] }) },
    observe: async () => ({ phase: "ready" }),
    diagnose: async () => ({}),
    archive,
  };
  const result = await imagePanelTests[0]!.orchestrate!({
    runner: {
      workspaceRepoFixtureContextId: "context:owned",
      openPanelClient: async () => handle,
      evalInPanelClient: async () => ({
        ...execution().diagnostics.imagePanel.first,
        error: "provider unavailable",
      }),
    },
    remainingTimeMs: () => 1000,
  } as never);
  expect(result.error).toContain("provider unavailable");
  expect(mocks.cancel).toHaveBeenCalledWith("job:owned");
  expect(mocks.forgetJob).toHaveBeenCalledWith("job:owned");
  expect(archive).toHaveBeenCalledOnce();
  expect(result.cleanupErrors).toBeUndefined();
});

it.each(["failed", "cancelled"])(
  "stops immediately on a terminal %s frame even without error text",
  async (status) => {
    mocks.status.mockResolvedValue({ workingHead: { kind: "event", eventId: "source" } });
    const handle = {
      stateArgs: { get: async () => ({ jobs: [] }) },
      observe: async () => ({ phase: "ready" }),
      diagnose: async () => ({}),
      archive: vi.fn(async () => {}),
    };
    const read = vi.fn(async () => ({
      ...execution().diagnostics.imagePanel.first,
      job: "",
      status,
      error: "",
    }));
    const result = await imagePanelTests[0]!.orchestrate!({
      runner: {
        workspaceRepoFixtureContextId: "context:owned",
        openPanelClient: async () => handle,
        evalInPanelClient: read,
      },
      remainingTimeMs: () => 1000,
    } as never);
    expect(result.error).toContain(`Image generation ${status}`);
    expect(read).toHaveBeenCalledOnce();
    expect(result.diagnostics?.["imagePanel"]).toMatchObject({
      lastFrame: { status },
      cleanupComplete: true,
    });
  }
);
