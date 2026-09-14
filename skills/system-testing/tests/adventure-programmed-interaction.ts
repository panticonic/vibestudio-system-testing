import { blobstore } from "@workspace/runtime";
import { setViewport } from "@workspace/testkit";
import { adventureCampaignTests } from "./adventure-campaign-play.js";
import type {
  TestCase,
  TestExecutionResult,
  TestOrchestrationContext,
} from "../types.js";

/** A real player intention requiring causal object composition, rather than an authored action button. */
async function orchestrate(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const start = Date.now();
  const evidence: Record<string, any> = { builderObserved: false };
  const result: TestExecutionResult = {
    messages: [],
    duration: 0,
    diagnostics: { programmedInteraction: evidence },
  };
  let handle:
    | Awaited<ReturnType<typeof context.runner.openPanelClient>>
    | undefined;
  try {
    const contextId = context.runner.workspaceRepoFixtureContextId;
    if (!contextId) throw new Error("Missing test context");
    handle = await context.runner.openPanelClient("panels/dead-letter-office", {
      contextId,
      ref: "ctx:" + contextId,
      parentId: null,
      focus: false,
      stateArgs: { gameKey: "adventure-code-" + crypto.randomUUID() },
    });
    const active = handle;
    const read = () =>
      context.runner.evalInPanelClient<any>(
        active,
        `(()=>{
      const r=document.querySelector('main.adventure');if(!r)return null;
      const t=r.querySelector('#adventure-intention'), i=r.querySelector('.adventure-scene img');
      return {key:r.dataset.gameKey,ready:r.dataset.ready==='true',enabled:!!t&&!t.disabled,
        pending:r.dataset.pending||'',scene:r.dataset.sceneStatus||'',fresh:r.dataset.sceneFresh,
        tick:Number(r.dataset.tick),asset:r.dataset.assetId||'',loaded:!!i&&i.complete&&i.naturalWidth>0,
        light:r.querySelector('[aria-label="Light condition"]')?.textContent||'',
        narration:[...r.querySelectorAll('[data-event-kind="narration"]')].at(-1)?.dataset.eventId||'',
        error:r.querySelector('.adventure-error')?.textContent||''};})()`,
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
        if (f?.pending === "builder") evidence["builderObserved"] = true;
        if (f?.error) throw new Error(label + ": " + f.error);
        if (f && predicate(f)) return f;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      throw new Error(label + " timed out");
    };
    await setViewport(active, { width: 1440, height: 1000 });
    await wait(
      "opening",
      (f) => f.ready && f.enabled && f.loaded && f.asset && !f.pending,
    );
    const page = await active.cdp.page();
    try {
      await page
        .getByRole("button", { name: "The harbour lamp", exact: false })
        .click();
      evidence["before"] = await wait("shining lamp", (f) =>
        f.light.includes("shining"),
      );
      await page
        .locator("#adventure-intention")
        .fill(
          "Fold my oilskin wrap double and put it over the harbour lamp so its light is blocked.",
        );
      await page.locator("#adventure-intention").press("Enter");
      evidence["after"] = await wait(
        "programmed covering",
        (f) =>
          f.enabled &&
          !f.pending &&
          f.tick > evidence["before"].tick &&
          f.narration !== evidence["before"].narration &&
          f.light.includes("blocked by a covering"),
      );
      evidence["painted"] = await wait(
        "visible consequence illustrated",
        (f) =>
          f.loaded &&
          f.fresh === "true" &&
          !f.scene &&
          f.asset !== evidence["before"].asset,
        360000,
      );
    } finally {
      await page.close();
    }
    const shot = await active.cdp.screenshot({ format: "png" });
    evidence["screenshot"] = {
      ...(await blobstore.putBase64(shot.data)),
      mimeType: shot.mimeType,
      width: shot.width,
      height: shot.height,
    };
    await active.reload();
    await wait(
      "reload",
      (f) =>
        f.ready &&
        f.enabled &&
        !f.pending &&
        f.asset === evidence["painted"].asset,
    );
    const reopened = await active.cdp.page();
    try {
      await reopened
        .getByRole("button", { name: "The harbour lamp", exact: false })
        .click();
      evidence["reloaded"] = await wait("persistent covering", (f) =>
        f.light.includes("blocked by a covering"),
      );
    } finally {
      await reopened.close();
    }
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
    result.duration = Date.now() - start;
  }
  return result;
}
export const adventureProgrammedInteractionTests: TestCase[] = [
  {
    ...adventureCampaignTests[0]!,
    name: "adventure-programmed-interaction",
    timeoutMs: 900000,
    description:
      "Player-agent code composes an unscripted physical covering, changes real light, repaints and survives reload",
    prompt:
      "Fold the oilskin wrap and use it to cover the harbour lamp, blocking its light.",
    orchestrate,
    validate(execution) {
      const e = execution.diagnostics?.["programmedInteraction"] as
        | Record<string, any>
        | undefined;
      if (execution.error || !e?.["cleanupComplete"])
        return {
          passed: false,
          reason: execution.error || "Cleanup incomplete",
        };
      if (e["builderObserved"])
        return {
          passed: false,
          reason:
            "Existing manipulation mechanics required a builder round trip",
        };
      if (e["reloaded"].tick !== e["after"].tick || e["reloaded"].key !== e["after"].key)
        return {
          passed: false,
          reason: "Reload did not preserve the manipulation",
        };
      return { passed: true, details: e };
    },
  },
];
