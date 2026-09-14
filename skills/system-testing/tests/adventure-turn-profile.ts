import { blobstore } from "@workspace/runtime";
import { profilePanelInteraction, setViewport } from "@workspace/testkit";
import { adventureCampaignTests } from "./adventure-campaign-play.js";
import type {
  TestCase,
  TestExecutionResult,
  TestOrchestrationContext,
} from "../types.js";

/** Opt-in: requires the adventure units from Examples in the workspace fixture. */
async function orchestrate(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const started = Date.now();
  const evidence: Record<string, any> = {};
  const result: TestExecutionResult = {
    messages: [],
    duration: 0,
    diagnostics: { adventureProfile: evidence },
  };
  let handle:
    | Awaited<ReturnType<typeof context.runner.openPanelClient>>
    | undefined;
  try {
    const contextId = context.runner.workspaceRepoFixtureContextId;
    if (!contextId) throw new Error("Missing fixture context");
    handle = await context.runner.openPanelClient("panels/dead-letter-office", {
      contextId,
      ref: "ctx:" + contextId,
      stateArgs: { gameKey: "adventure-profile-" + crypto.randomUUID() },
      parentId: null,
      focus: false,
    });
    const active = handle;
    const read = () =>
      context.runner.evalInPanelClient<any>(
        active,
        `(()=>{
      const r=document.querySelector('main.adventure'); if(!r)return null;
      const t=r.querySelector('#adventure-intention'),i=r.querySelector('.adventure-scene img');
      return {ready:r.dataset.ready==='true',enabled:!!t&&!t.disabled,
        tick:Number(r.dataset.tick),location:r.dataset.location,pending:r.dataset.pending||'',
        scene:r.dataset.sceneStatus||'',fresh:r.dataset.sceneFresh,asset:r.dataset.assetId||'',
        prose:r.querySelector('.adventure-prose')?.textContent||'',
        narration:Array.from(r.querySelectorAll('.adventure-prose p:not(.adventure-player-intention):not(.adventure-dialogue):not(.adventure-stage-direction)')).map(p=>p.textContent).join('\\n'),
        loaded:!!i&&i.complete&&i.naturalWidth>0,error:r.querySelector('.adventure-error')?.textContent||'',
        overflow:document.documentElement.scrollWidth>innerWidth+1};})()`,
      );
    const wait = async (
      label: string,
      predicate: (f: any) => boolean,
      budget = 240000,
    ) => {
      const end =
        Date.now() + Math.min(budget, context.remainingTimeMs() ?? budget);
      while (Date.now() < end) {
        const f = await read();
        evidence["lastFrame"] = f;
        if (f?.error) throw new Error(label + ": " + f.error);
        if (f && predicate(f)) return f;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      throw new Error(label + " timed out");
    };
    await setViewport(active, { width: 1440, height: 1000 });
    evidence["opening"] = await wait(
      "usable opening",
      (f) => f.ready && f.enabled && !f.pending,
    );
    evidence["openToUsableMs"] = Date.now() - started;
    evidence["question"] = await profilePanelInteraction(
      active,
      async (page) => {
        await page
          .locator("#adventure-intention")
          .fill(
            "Describe the customs-house exterior from here, without moving or doing anything. This is only a question.",
          );
        await page.locator('button[type="submit"]').click();
        evidence["afterQuestion"] = await wait(
          "question response",
          (f) =>
            f.enabled &&
            !f.pending &&
            f.narration !== evidence["opening"].narration,
        );
      },
      { label: "question submit to response and available composer" },
    );
    evidence["openToFirstResponseMs"] = Date.now() - started;
    evidence["movement"] = await profilePanelInteraction(
      active,
      async (page) => {
        await page
          .locator("#adventure-intention")
          .fill("Walk to the quay. Do not speak or perform any other action.");
        await page.locator('button[type="submit"]').click();
        evidence["afterMovement"] = await wait(
          "walk and available composer",
          (f) =>
            f.location === "quay" &&
            f.tick > evidence["afterQuestion"].tick &&
            f.narration !== evidence["afterQuestion"].narration &&
            f.enabled &&
            !f.pending,
        );
      },
      { label: "walk submit to response and available composer" },
    );
    evidence["painted"] = await wait(
      "generated quay painting",
      (f) =>
        f.location === "quay" &&
        f.loaded &&
        f.asset &&
        f.asset !== evidence["opening"].asset &&
        !f.pending &&
        (!f.scene || f.scene === "complete" || f.scene === "ready"),
      360000,
    );
    await setViewport(active, { width: 390, height: 844, mobile: true });
    evidence["mobile"] = await read();
    const shot = await active.cdp.screenshot({ format: "png" });
    evidence["screenshot"] = {
      ...(await blobstore.putBase64(shot.data)),
      mimeType: shot.mimeType,
      width: shot.width,
      height: shot.height,
    };
    await active.reload();
    evidence["reloaded"] = await wait(
      "durable reload",
      (f) =>
        f.ready &&
        f.enabled &&
        f.loaded &&
        !f.pending &&
        f.location === "quay" &&
        f.asset === evidence["painted"].asset,
    );
  } catch (cause) {
    result.error = String(cause);
    if (handle)
      try {
        evidence["failure"] = {
          observation: await handle.observe(),
          diagnosis: await handle.diagnose(),
        };
      } catch {}
  } finally {
    if (handle)
      try {
        await handle.archive();
      } catch (cause) {
        (result.cleanupErrors ??= []).push(String(cause));
      }
    evidence["cleanupComplete"] = !result.cleanupErrors?.length;
    result.duration = Date.now() - started;
  }
  return result;
}
export const adventureTurnProfileTests: TestCase[] = [
  {
    ...adventureCampaignTests[0]!,
    name: "adventure-turn-profile",
    timeoutMs: 900000,
    description:
      "Native profiles of question and movement through the real adventure panel, plus generated art, mobile and reload",
    orchestrate,
    validate(execution) {
      const e = execution.diagnostics?.["adventureProfile"] as
        | Record<string, any>
        | undefined;
      if (execution.error || !e?.["cleanupComplete"])
        return {
          passed: false,
          reason: execution.error || "Cleanup incomplete",
        };
      if (e["afterQuestion"].tick !== e["opening"].tick)
        return { passed: false, reason: "A question advanced fictional time" };
      if (e["mobile"].overflow || e["reloaded"].tick !== e["painted"].tick)
        return {
          passed: false,
          reason: "Mobile overflow or changed state on reload",
        };
      return { passed: true, details: e };
    },
  },
];
