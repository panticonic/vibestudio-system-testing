import { blobstore, images, vcs } from "@workspace/runtime";
import { importImagePanelFixture } from "../image-panel-fixture.js";
import {
  CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
  type TestCase,
  type TestExecutionResult,
  type TestOrchestrationContext,
} from "../types.js";
import {
  PANEL_AUTOMATION_RESOURCE,
  PANEL_RUNTIME_SUPERVISION_AUTHORITY,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";
import { systemTestFailure } from "../structured-error.js";

interface Frame {
  boot: string;
  job: string;
  asset: string;
  digest: string;
  status: string;
  error: string;
  loaded: boolean;
  width: number;
  height: number;
  src: string;
}
interface ImagePanelEvidence {
  before?: Frame;
  first?: Frame;
  reloaded?: Frame;
  edited?: Frame;
  sourceUnchanged?: boolean;
  screenshot?: { digest: string; mimeType: string; width: number; height: number };
  cleanupComplete?: boolean;
  lastFrame?: Frame;
}
export function validateImagePanel(execution: TestExecutionResult) {
  if (execution.error) return { passed: false, reason: execution.error };
  if (execution.cleanupErrors?.length)
    return { passed: false, reason: execution.cleanupErrors.join("; ") };
  const data = execution.diagnostics?.["imagePanel"] as ImagePanelEvidence | undefined;
  if (!data?.before || !data.first || !data.reloaded || !data.edited)
    return { passed: false, reason: "Missing observed running-panel image lifecycle" };
  const { before, first, reloaded, edited } = data;
  const visible = (frame: Frame) =>
    frame.loaded &&
    frame.width > 0 &&
    frame.height > 0 &&
    frame.src.startsWith("blob:") &&
    frame.asset &&
    frame.digest;
  if (![first, reloaded, edited].every(visible))
    return { passed: false, reason: "Generated original did not decode in the running panel" };
  if (before.boot !== first.boot || reloaded.boot !== edited.boot || first.boot === reloaded.boot)
    return {
      passed: false,
      reason: "Generation remounted the app, or explicit reload did not reopen it",
    };
  if (
    first.asset !== reloaded.asset ||
    first.job !== reloaded.job ||
    first.digest !== reloaded.digest
  )
    return {
      passed: false,
      reason: "Reload did not recover the same durable job and immutable image",
    };
  if (edited.asset === first.asset || edited.job === first.job || edited.digest === first.digest)
    return { passed: false, reason: "Reference generation did not display a new asset" };
  if (!data.sourceUnchanged || !data.cleanupComplete)
    return { passed: false, reason: "Source stability or resource cleanup was not established" };
  return {
    passed: true,
    details: {
      firstAsset: first.asset,
      editedAsset: edited.asset,
      recoveredAfterReload: true,
      sourceUnchanged: true,
    },
  };
}
async function orchestrate(context: TestOrchestrationContext): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  let handle: Awaited<ReturnType<typeof context.runner.openPanelClient>> | undefined;
  const evidence: ImagePanelEvidence = {};
  const execution: TestExecutionResult = {
    messages: [],
    duration: 0,
    diagnostics: { imagePanel: evidence },
  };
  const jobs = new Set<string>();
  try {
    const contextId = context.runner.workspaceRepoFixtureContextId;
    if (!contextId) throw new Error("Image panel test requires a prepared repository fixture");
    const fixture = await importImagePanelFixture({
      vcs,
      blobstore,
      contextId: contextId,
      name: `image-studio-${crypto.randomUUID()}`,
    });
    const basis = await vcs.status({ contextId: contextId });
    handle = await context.runner.openPanelClient(fixture.repoPath, {
      contextId: contextId,
      ref: `ctx:${contextId}`,
      parentId: null,
      focus: false,
    });
    const read = () =>
      context.runner.evalInPanelClient<Frame | null>(
        handle!,
        `(() => {const root=document.querySelector('[data-testid="image-studio"]');if(!(root instanceof HTMLElement))return null;const image=document.querySelector('[data-testid="generated-scene"]');return {boot:root.dataset.boot,job:root.dataset.job,asset:root.dataset.asset,digest:root.dataset.digest,status:root.dataset.status,error:document.querySelector('[data-testid="generation-error"]')?.textContent ?? '',loaded:image instanceof HTMLImageElement && image.complete && image.naturalWidth>0,width:image instanceof HTMLImageElement?image.naturalWidth:0,height:image instanceof HTMLImageElement?image.naturalHeight:0,src:image instanceof HTMLImageElement?image.src:''};})()`
      );
    const wait = async (label: string, predicate: (frame: Frame) => boolean, budget: number) => {
      const deadline = Date.now() + Math.min(budget, context.remainingTimeMs() ?? budget);
      while (Date.now() < deadline) {
        const frame = await read();
        if (frame) evidence.lastFrame = frame;
        if (frame?.job) jobs.add(frame.job);
        if (frame?.error || frame?.status === "failed" || frame?.status === "cancelled") {
          throw new Error(`${label}: ${frame.error || `Image generation ${frame.status}`}`);
        }
        if (frame && predicate(frame)) return frame;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`${label} did not become visible before the deadline`);
    };
    evidence.before = await wait("initial controls", (frame) => frame.status === "idle", 15000);
    await handle.click('[data-testid="generate"]');
    evidence.first = await wait(
      "generated scene",
      (frame) => frame.status === "succeeded" && frame.loaded,
      300000
    );
    await handle.reload();
    evidence.reloaded = await wait(
      "reopened scene",
      (frame) => frame.status === "succeeded" && frame.loaded,
      30000
    );
    await handle.click('[data-testid="reference"]');
    evidence.edited = await wait(
      "reference scene",
      (frame) =>
        frame.status === "succeeded" && frame.loaded && frame.asset !== evidence.first!.asset,
      300000
    );
    const screenshot = await handle.cdp.screenshot({ format: "png" });
    const storedScreenshot = await blobstore.putBase64(screenshot.data);
    evidence.screenshot = {
      digest: storedScreenshot.digest,
      mimeType: screenshot.mimeType,
      width: screenshot.width,
      height: screenshot.height,
    };
    const after = await vcs.status({ contextId: contextId });
    evidence.sourceUnchanged =
      JSON.stringify(after.workingHead) === JSON.stringify(basis.workingHead);
  } catch (cause) {
    execution.failure = systemTestFailure("image-panel-live-generation", cause);
    execution.error = execution.failure.error.message;
    if (handle) {
      try {
        execution.diagnostics!["panelFailure"] = {
          observation: await handle.observe(),
          diagnosis: await handle.diagnose(),
        };
      } catch {
        /* Primary failure retained; cleanup still runs. */
      }
    }
  } finally {
    const cleanupErrors: string[] = [];
    if (handle) {
      try {
        const state = await handle.stateArgs.get<{ jobs?: string[] }>();
        for (const job of state.jobs ?? []) jobs.add(job);
      } catch (cause) {
        cleanupErrors.push(`read owned jobs: ${String(cause)}`);
      }
    }
    for (const id of jobs) {
      try {
        const job = await images.getJob(id);
        if (job.status === "queued" || job.status === "running") await images.cancel(id);
        await images.forgetJob(id);
      } catch (cause) {
        cleanupErrors.push(`release job ${id}: ${String(cause)}`);
      }
    }
    try {
      await handle?.archive();
    } catch (cause) {
      cleanupErrors.push(`archive: ${String(cause)}`);
    }
    evidence.cleanupComplete = cleanupErrors.length === 0;
    if (cleanupErrors.length) execution.cleanupErrors = cleanupErrors;
    execution.duration = Date.now() - startedAt;
  }
  return execution;
}
export const imagePanelTests: TestCase[] = [
  {
    name: "image-panel-live-generation",
    description:
      "Generate and display original images in an already running panel, recover after reload, and edit using the first image",
    category: "image-generation",
    timeoutMs: 720000,
    prompt: "Exercise the running panel's real image generation and durable reload lifecycle.",
    validation: "harness",
    workspaceRepoFixture: CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("inspect-live-image-panel", [
      PANEL_RUNTIME_SUPERVISION_AUTHORITY,

      {
        ruleId: "generate-workspace-images",
        capability: { kind: "exact", key: "workspace-service:images" },
        resource: { kind: "exact", key: "do:workers/images:ImagesDO:workspace" },
        tier: "gated",
        decision: "once",
      },
    ]),
    orchestrate,
    validate: validateImagePanel,
  },
];
