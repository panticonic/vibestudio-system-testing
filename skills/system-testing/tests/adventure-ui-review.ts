import { blobstore } from "@workspace/runtime";
import { setViewport, clearViewport } from "@workspace/testkit";
import { adventureCampaignTests } from "./adventure-campaign-play.js";
import type { TestCase, TestExecutionResult, TestOrchestrationContext } from "../types.js";

interface Frame {
  key: string;
  ready: boolean;
  enabled: boolean;
  tick: number;
  pending: string;
  asset: string;
  loaded: boolean;
  overflow: boolean;
  error: string;
  words: string;
  narration: string;
  inspector: string;
  journalOpen: boolean;
  composerTop: number;
  composerBottom: number;
  viewportHeight: number;
  proseHeight: number;
  proseScrollHeight: number;
  proseLineHeight: number;
  inputFocused: boolean;
}

/** Candidate-only UI checks. Import this list explicitly when the adventure fixture is present. */
async function orchestrate(context: TestOrchestrationContext): Promise<TestExecutionResult> {
  const started = Date.now();
  const evidence: Record<string, any> = {
    openings: [],
    freeInspection: [],
    screenshots: [],
  };
  const result: TestExecutionResult = {
    messages: [],
    duration: 0,
    diagnostics: { adventureUi: evidence },
  };
  const handles: Array<Awaited<ReturnType<typeof context.runner.openPanelClient>>> = [];
  let active: (typeof handles)[number] | undefined;
  const read = (handle: (typeof handles)[number]) =>
    context.runner.evalInPanelClient<Frame | null>(
      handle,
      `(() => {
    const root = document.querySelector('main.adventure'); if (!root) return null;
    const input = root.querySelector('#adventure-intention'), image = root.querySelector('.adventure-scene img');
    const form = root.querySelector('.adventure-composer')?.getBoundingClientRect(), prose = root.querySelector('.adventure-prose');
    const narration = [...root.querySelectorAll('.adventure-prose [data-event-kind="narration"]')].at(-1);
    return {key: root.dataset.gameKey || '', ready: root.dataset.ready === 'true', enabled: !!input && !input.disabled,
      tick: Number(root.dataset.tick), pending: root.dataset.pending || '', asset: root.dataset.assetId || '',
      loaded: !!image && image.complete && image.naturalWidth > 0,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      error: root.querySelector('.adventure-error')?.textContent || '', words: input?.value || '',
      narration: narration?.dataset.eventId || '', inspector: root.querySelector('.adventure-inspector')?.textContent || '',
      journalOpen: !!root.querySelector('dialog[open]'), composerTop: form?.top ?? -1,
      composerBottom: form?.bottom ?? -1, viewportHeight: innerHeight,
      proseHeight: prose?.clientHeight ?? 0, proseScrollHeight: prose?.scrollHeight ?? 0,
      proseLineHeight: prose ? parseFloat(getComputedStyle(prose).lineHeight) : 0,
      inputFocused: document.activeElement === input};
  })()`
    );
  const wait = async (
    handle: (typeof handles)[number],
    label: string,
    predicate: (frame: Frame) => boolean,
    budget = 180000
  ) => {
    active = handle;
    const end = Date.now() + Math.min(budget, context.remainingTimeMs() ?? budget);
    while (Date.now() < end) {
      const frame = await read(handle);
      evidence["lastFrame"] = frame;
      if (frame?.error) throw new Error(label + ": " + frame.error);
      if (frame && predicate(frame)) return frame;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    throw new Error(label + " timed out");
  };
  const capture = async (handle: (typeof handles)[number], name: string) => {
    const shot = await handle.cdp.screenshot({ format: "png" });
    evidence["screenshots"].push({
      name,
      ...(await blobstore.putBase64(shot.data)),
      mimeType: shot.mimeType,
      width: shot.width,
      height: shot.height,
    });
  };
  const assertReadingRoom = (frame: Frame, label: string) => {
    if (
      frame.proseScrollHeight > frame.proseHeight + 1 &&
      frame.proseHeight < frame.proseLineHeight * 6
    )
      throw new Error(label + " compresses the story into fewer than six readable lines");
  };
  const checkNaturalScroll = async (handle: (typeof handles)[number], label: string) => {
    const page = await handle.cdp.page();
    try {
      await page.locator(".adventure-composer").scrollIntoViewIfNeeded();
      await page.locator("#adventure-intention").focus();
      const frame = await read(handle);
      if (
        !frame ||
        frame.overflow ||
        !frame.enabled ||
        !frame.inputFocused ||
        frame.composerTop < -1 ||
        frame.composerBottom > frame.viewportHeight + 1
      )
        throw new Error(label + " composer cannot be reached and focused by ordinary scrolling");
      assertReadingRoom(frame, label);
      (evidence["reachability"] ??= []).push({ label, frame });
      await page.locator(".adventure-masthead").scrollIntoViewIfNeeded();
    } finally {
      try {
        await page.close();
      } catch (cause) {
        (result.cleanupErrors ??= []).push(String(cause));
      }
    }
  };
  try {
    const contextId = context.runner.workspaceRepoFixtureContextId;
    if (!contextId) throw new Error("Missing prepared adventure fixture");
    for (const id of ["dead-letter-office", "missing-country", "wandering-house"]) {
      const handle = await context.runner.openPanelClient("panels/" + id, {
        contextId,
        ref: "ctx:" + contextId,
        stateArgs: {
          gameKey: "adventure-ui-" + id + "-" + crypto.randomUUID(),
        },
        parentId: null,
        focus: false,
      });
      handles.push(handle);
      active = handle;
      await setViewport(handle, { width: 1440, height: 1000 });
      const opening = await wait(
        handle,
        id + " opening",
        (f) => f.ready && f.enabled && f.loaded && !!f.asset && !f.pending
      );
      if (opening.overflow) throw new Error(id + " desktop content overflows horizontally");
      await checkNaturalScroll(handle, id + " desktop");
      await capture(handle, id + "-desktop");
      const page = await handle.cdp.page();
      try {
        await page.locator(".adventure-entity").first().click();
        const inspected = await wait(handle, id + " free inspection", (f) => !!f.inspector);
        if (inspected.tick !== opening.tick || inspected.pending)
          throw new Error("Inspecting advanced the world");
        await page.getByRole("button", { name: "Your journal" }).click();
        await wait(handle, id + " journal", (f) => f.journalOpen);
        for (const tab of ["People", "Papers", "Leads", "Map", "Events"]) {
          await page.getByRole("button", { name: tab, exact: true }).click();
          const frame = await read(handle);
          if (!frame || frame.tick !== opening.tick || frame.pending)
            throw new Error("Browsing the journal advanced the world");
        }
        await page.getByRole("button", { name: "Close journal" }).click();
        await wait(handle, id + " close journal", (f) => !f.journalOpen);
        await page.getByRole("button", { name: "Close details" }).click();
        evidence["freeInspection"].push({
          id,
          before: opening.tick,
          after: inspected.tick,
        });
      } finally {
        try {
          await page.close();
        } catch (cause) {
          (result.cleanupErrors ??= []).push(String(cause));
        }
      }
      await setViewport(handle, { width: 390, height: 844, mobile: true });
      const mobile = await wait(handle, id + " mobile", (f) => f.ready && f.enabled && f.loaded);
      if (mobile.overflow) throw new Error(id + " mobile content overflows horizontally");
      await checkNaturalScroll(handle, id + " mobile");
      await capture(handle, id + "-mobile");
      evidence["openings"].push({ id, desktop: opening, mobile });
      await clearViewport(handle);
    }
    const handle = handles[0]!;
    active = handle;
    await setViewport(handle, { width: 1440, height: 1000 });
    const page = await handle.cdp.page();
    try {
      const before = await wait(
        handle,
        "keyboard ready",
        (f) => f.ready && f.enabled && !f.pending
      );
      await page.locator("#adventure-intention").fill("Describe the customs-house exterior.");
      await page.locator("#adventure-intention").press("Shift+Enter");
      const newline = await read(handle);
      if (!newline?.words.includes("\n") || newline.pending || newline.tick !== before.tick)
        throw new Error("Shift+Enter did not insert a free newline");
      await page
        .locator("#adventure-intention")
        .fill(
          "Describe the customs-house exterior from here, without moving or taking any action. This is only a question."
        );
      await page.locator("#adventure-intention").press("Enter");
      const answered = await wait(
        handle,
        "Enter submits and receives a response",
        (f) => f.enabled && !f.pending && !!f.narration && f.narration !== before.narration,
        240000
      );
      if (answered.tick !== before.tick) throw new Error("The question advanced fictional time");
      assertReadingRoom(answered, "Answered story");
      evidence["keyboard"] = { before, answered, shiftEnter: true };
      await page.locator("details.adventure-journey-menu > summary").click();
      await page.getByRole("button", { name: "Begin a new journey" }).click();
      const fresh = await wait(
        handle,
        "new journey",
        (f) => f.ready && f.enabled && !f.pending && f.key !== answered.key && f.tick === 0
      );
      await page.getByLabel("Resume a journey").selectOption(answered.key);
      const resumed = await wait(
        handle,
        "resume old journey",
        (f) =>
          f.ready &&
          f.enabled &&
          !f.pending &&
          f.key === answered.key &&
          f.narration === answered.narration &&
          f.asset === answered.asset
      );
      if (resumed.tick !== answered.tick || fresh.key === resumed.key)
        throw new Error("Journey switching did not preserve the earlier save");
      evidence["journeys"] = {
        previous: answered.key,
        fresh: fresh.key,
        resumed: resumed.key,
      };
    } finally {
      try {
        await page.close();
      } catch (cause) {
        (result.cleanupErrors ??= []).push(String(cause));
      }
    }
  } catch (cause) {
    result.error = String(cause);
    if (active)
      try {
        evidence["failure"] = {
          observation: await active.observe(),
          diagnosis: await active.diagnose(),
        };
      } catch (diagnosticError) {
        evidence["diagnosticError"] = String(diagnosticError);
      }
  } finally {
    for (const handle of handles)
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

export const adventureUiReviewTests: TestCase[] = [
  {
    ...adventureCampaignTests[0]!,
    name: "adventure-ui-review",
    description:
      "Three responsive adventure UIs, free reference panels, keyboard submission and preserved journeys",
    timeoutMs: 900000,
    orchestrate,
    validate(execution) {
      const evidence = execution.diagnostics?.["adventureUi"] as Record<string, any> | undefined;
      if (execution.error || !evidence?.["cleanupComplete"])
        return {
          passed: false,
          reason: execution.error ?? "Cleanup incomplete",
        };
      if (
        evidence["openings"]?.length !== 3 ||
        evidence["screenshots"]?.length !== 6 ||
        evidence["freeInspection"]?.length !== 3 ||
        evidence["reachability"]?.length !== 6 ||
        !evidence["keyboard"]?.shiftEnter ||
        !evidence["journeys"]
      )
        return {
          passed: false,
          reason: "UI regression evidence is incomplete",
        };
      return { passed: true, details: evidence };
    },
  },
];
