import { blobstore, vcs } from "@workspace/runtime";
import { setViewport, clearViewport } from "@workspace/testkit";
import {
  CONTENT_WORKSPACE_REPO_FIXTURE,
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
const CAMPAIGNS = [
  { id: "dead-letter-office", title: "The Dead Letter Office", location: "landing" },
  { id: "missing-country", title: "The Embassy of a Missing Country", location: "vestibule" },
  { id: "wandering-house", title: "The House That Crosses the World", location: "lobby" },
] as const;
interface Frame {
  key: string;
  title: string;
  location: string;
  journal: string;
  ready: boolean;
  enabled: boolean;
  loaded: boolean;
  asset: string;
  tick: number;
  revision: number;
  pending: string;
  error: string;
  overflow: boolean;
}
interface Evidence {
  initial?: Frame[];
  sideGames?: Frame[];
  before?: Frame;
  after?: Frame;
  reloaded?: Frame;
  lastFrame?: Frame | null;
  screenshots?: Array<{
    name: string;
    digest: string;
    mimeType: string;
    width: number;
    height: number;
  }>;
  sourceUnchanged?: boolean;
  cleanupComplete?: boolean;
}
export function validateAdventureCampaignPlay(execution: TestExecutionResult) {
  if (execution.error) return { passed: false, reason: execution.error };
  if (execution.cleanupErrors?.length)
    return { passed: false, reason: execution.cleanupErrors.join("; ") };
  const e = execution.diagnostics?.["adventureCampaign"] as Evidence | undefined;
  if (
    e?.initial?.length !== 3 ||
    !e.initial.every(
      (f, i) =>
        f.ready &&
        f.loaded &&
        f.asset &&
        f.location === CAMPAIGNS[i]!.location &&
        f.title === CAMPAIGNS[i]!.title
    )
  )
    return {
      passed: false,
      reason: "Three real opening worlds and decoded images were not observed",
    };
  if (
    !e.before ||
    !e.after ||
    !e.reloaded ||
    e.after.location !== "customs" ||
    e.after.tick <= e.before.tick ||
    e.after.pending ||
    !e.after.loaded ||
    !e.after.asset ||
    e.after.asset === e.before.asset
  )
    return {
      passed: false,
      reason: "The player did not reach the customs office and receive its generated scene",
    };
  if (
    e.reloaded.key !== e.after.key ||
    e.reloaded.tick !== e.after.tick ||
    e.reloaded.asset !== e.after.asset ||
    e.reloaded.journal !== e.after.journal
  )
    return { passed: false, reason: "Reload did not preserve the completed campaign" };
  if (
    e.sideGames?.length !== 2 ||
    e.sideGames.some(
      (frame, index) =>
        frame.tick <= e.initial![index + 1]!.tick ||
        frame.pending ||
        !frame.enabled ||
        !frame.loaded ||
        frame.journal === e.initial![index + 1]!.journal
    )
  )
    return {
      passed: false,
      reason: "Both the embassy and hotel must complete real player actions",
    };
  if (
    e.initial.some((f) => f.overflow) ||
    !e.sourceUnchanged ||
    !e.cleanupComplete ||
    e.screenshots?.length !== 7
  )
    return {
      passed: false,
      reason: "Viewport, source stability, screenshot or cleanup evidence missing",
    };
  return {
    passed: true,
    details: {
      campaigns: 3,
      generatedAsset: e.after.asset,
      recoveredAfterReload: true,
      screenshots: e.screenshots,
    },
  };
}
async function orchestrate(context: TestOrchestrationContext): Promise<TestExecutionResult> {
  const start = Date.now(),
    e: Evidence = { initial: [], screenshots: [] },
    result: TestExecutionResult = {
      messages: [],
      duration: 0,
      diagnostics: { adventureCampaign: e },
    };
  const handles: Array<Awaited<ReturnType<typeof context.runner.openPanelClient>>> = [];
  const contextId = context.runner.workspaceRepoFixtureContextId;
  let activeHandle: (typeof handles)[number] | undefined;
  const read = (handle: (typeof handles)[number]) =>
    context.runner.evalInPanelClient<Frame | null>(
      handle,
      `(()=>{const r=document.querySelector('main.adventure');if(!(r instanceof HTMLElement))return null;const i=r.querySelector('.adventure-scene img'),t=r.querySelector('#adventure-intention');return {key:r.dataset.gameKey||'',title:r.querySelector('h1')?.textContent||'',location:r.dataset.location||'',journal:r.querySelector('.adventure-prose')?.textContent||'',ready:r.dataset.ready==='true',enabled:t instanceof HTMLTextAreaElement&&!t.disabled,loaded:i instanceof HTMLImageElement&&i.complete&&i.naturalWidth>0,asset:r.dataset.assetId||'',tick:Number(r.dataset.tick),revision:Number(r.dataset.revision),pending:r.dataset.pending||'',error:r.querySelector('.adventure-error')?.textContent||'',overflow:document.documentElement.scrollWidth>innerWidth+1};})()`
    );
  const wait = async (
    handle: (typeof handles)[number],
    label: string,
    predicate: (f: Frame) => boolean,
    budget = 180000
  ) => {
    activeHandle = handle;
    const end = Date.now() + Math.min(budget, context.remainingTimeMs() ?? budget);
    while (Date.now() < end) {
      const f = await read(handle);
      e.lastFrame = f;
      if (f?.error) throw new Error(label + ": " + f.error);
      if (f && predicate(f)) return f;
      await new Promise((r) => setTimeout(r, 350));
    }
    throw new Error(label + " did not complete");
  };
  const capture = async (handle: (typeof handles)[number], name: string) => {
    const screenshot = await handle.cdp.screenshot({ format: "png" });
    const b = await blobstore.putBase64(screenshot.data);
    e.screenshots!.push({
      name,
      digest: b.digest,
      mimeType: screenshot.mimeType,
      width: screenshot.width,
      height: screenshot.height,
    });
  };
  try {
    if (!contextId) throw new Error("Prepared campaign test context missing");
    const basis = await vcs.status({ contextId });
    for (const c of CAMPAIGNS) {
      const handle = await context.runner.openPanelClient("panels/" + c.id, {
        contextId,
        ref: "ctx:" + contextId,
        stateArgs: { gameKey: "adventure-test-" + c.id + "-" + crypto.randomUUID() },
        parentId: null,
        focus: false,
      });
      handles.push(handle);
      await setViewport(handle, { width: 1440, height: 1000 });
      const first = await wait(
        handle,
        c.id + " opening",
        (f) => f.ready && f.enabled && f.loaded && !!f.asset && !f.pending
      );
      e.initial!.push(first);
      await capture(handle, c.id + "-desktop");
      await setViewport(handle, { width: 390, height: 844, mobile: true });
      const narrow = await read(handle);
      if (narrow?.overflow) throw new Error(c.id + " overflows narrow viewport");
      await capture(handle, c.id + "-mobile");
      await clearViewport(handle);
    }
    const handle = handles[0]!;
    e.before = await wait(
      handle,
      "postal scene before interaction",
      (f) => f.ready && f.enabled && f.loaded && !!f.asset && !f.pending
    );
    const page = await handle.cdp.page();
    await page
      .locator("#adventure-intention")
      .fill("Go into the customs house and ask Elin about the letter addressed to Mara Vale.");
    await page.locator('button[type="submit"]').click();
    e.after = await wait(
      handle,
      "player conversation and illustration",
      (f) =>
        f.location === "customs" &&
        f.tick > e.before!.tick &&
        !f.pending &&
        f.enabled &&
        f.loaded &&
        !!f.asset &&
        f.asset !== e.before!.asset,
      360000
    );
    await handle.reload();
    e.reloaded = await wait(
      handle,
      "saved campaign",
      (f) => f.ready && f.loaded && f.enabled && !f.pending && f.asset === e.after!.asset
    );
    await capture(handle, "dead-letter-after");
    e.sideGames = [];
    for (const [index, text] of [
      [1, "Offer Ada asylum by entering her name in the visitors' book."],
      [2, "Ring the arrival bell so the house stops safely."],
    ] as const) {
      const other = handles[index]!;
      const before = await wait(
        other,
        CAMPAIGNS[index]!.id + " before interaction",
        (f) => f.ready && f.enabled && f.loaded && !!f.asset && !f.pending
      );
      const page = await other.cdp.page();
      await page.locator("#adventure-intention").fill(text);
      await page.locator('button[type="submit"]').click();
      e.sideGames.push(
        await wait(
          other,
          CAMPAIGNS[index]!.id + " player action",
          (frame) => frame.tick > before.tick && !frame.pending && frame.enabled && frame.loaded,
          300000
        )
      );
    }
    const after = await vcs.status({ contextId });
    e.sourceUnchanged = JSON.stringify(after.workingHead) === JSON.stringify(basis.workingHead);
  } catch (cause) {
    result.failure = systemTestFailure("adventure-campaign-play", cause);
    result.error = result.failure.error.message;
    const h = activeHandle ?? handles.at(-1);
    if (h)
      try {
        result.diagnostics!["panelFailure"] = {
          observation: await h.observe(),
          diagnosis: await h.diagnose(),
        };
      } catch (error) {
        result.diagnostics!["diagnosisError"] = String(error);
      }
  } finally {
    for (const h of handles)
      try {
        await h.archive();
      } catch (error) {
        (result.cleanupErrors ??= []).push(String(error));
      }
    e.cleanupComplete = !result.cleanupErrors?.length;
    result.duration = Date.now() - start;
  }
  return result;
}
export const adventureCampaignTests: TestCase[] = [
  {
    name: "adventure-campaign-play",
    description:
      "Three real adventure panels, independent world agents, generated scene, mobile layout and durable reload",
    category: "adventure",
    timeoutMs: 900000,
    prompt:
      "Play the three illustrated adventures and check their opening scenes. In The Dead Letter Office, visit the customs house and ask Elin about your letter, then reopen the story.",
    validation: "harness",
    workspaceRepoFixture: CONTENT_WORKSPACE_REPO_FIXTURE,
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("play-adventure-campaigns", [
      PANEL_RUNTIME_SUPERVISION_AUTHORITY,
      {
        ruleId: "adventure-world",
        capability: { kind: "exact", key: "workspace-service:adventure" },
        resource: { kind: "prefix", prefix: "do:workers/adventure-world:AdventureWorldDO:" },
        tier: "gated",
        decision: "once",
      },
      {
        ruleId: "adventure-images",
        capability: { kind: "exact", key: "workspace-service:images" },
        resource: { kind: "exact", key: "do:workers/images:ImagesDO:workspace" },
        tier: "gated",
        decision: "once",
      },
      {
        ruleId: "adventure-channel",
        capability: { kind: "exact", key: "workspace-service:channel" },
        resource: { kind: "prefix", prefix: "" },
        tier: "gated",
        decision: "once",
      },
      {
        ruleId: "adventure-subagents",
        capability: { kind: "exact", key: "subagents.create" },
        resource: { kind: "prefix", prefix: "" },
        tier: "gated",
        decision: "once",
      },
    ]),
    orchestrate,
    validate: validateAdventureCampaignPlay,
  },
];
