import type { HeadlessRunner } from "./runner.js";

type PanelHandle = Awaited<ReturnType<HeadlessRunner["openPanelClient"]>>;

/**
 * Exercise the real candidate panel. The harness owns this operation and its
 * panel handle. Its result does not depend on the teacher's report or edits.
 */
export async function verifyPanelDraft(handle: PanelHandle) {
  const session = await handle.cdp.session();
  try {
    const { page } = session;
    const topic = page.getByRole("textbox", { name: "Topic", exact: true });
    const preview = page.getByRole("button", {
      name: "Preview topic",
      exact: true,
    });
    const editor = page.getByRole("button", {
      name: "Edit topic",
      exact: true,
    });
    const saved = page.locator('[aria-label="Saved topic"]');
    const draft = `Draft ${crypto.randomUUID()}`;
    const abandoned = `Discard ${crypto.randomUUID()}`;

    const original = await topic.inputValue();
    await topic.fill(draft);
    await preview.click();
    await saved.waitFor({ state: "visible" });
    const previewBeforeSave = await saved.textContent();
    await editor.click();
    await topic.waitFor({ state: "visible" });
    const afterNavigation = await topic.inputValue();

    // Check Save independently so a lost draft still gives a precise failure.
    await topic.fill(draft);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await preview.click();
    await saved.waitFor({ state: "visible" });
    const previewAfterSave = await saved.textContent();
    await editor.click();
    await topic.waitFor({ state: "visible" });
    await topic.fill(abandoned);
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    const afterDiscard = await topic.inputValue();
    await preview.click();
    await saved.waitFor({ state: "visible" });
    const previewAfterDiscard = await saved.textContent();
    await editor.click();
    await topic.waitFor({ state: "visible" });
    const afterDiscardAndReturn = await topic.inputValue();
    const checks = {
      preservesUnsavedDraft: afterNavigation === draft,
      navigationDoesNotSave: previewBeforeSave === original,
      saveCommitsDraft: previewAfterSave === draft,
      discardRestoresSaved:
        afterDiscard === previewAfterSave &&
        previewAfterDiscard === previewAfterSave,
      discardedDraftStaysDiscarded: afterDiscardAndReturn === previewAfterSave,
    };
    return {
      passed: Object.values(checks).every(Boolean),
      checks,
      evidence: {
        original,
        draft,
        abandoned,
        previewBeforeSave,
        afterNavigation,
        previewAfterSave,
        afterDiscard,
        previewAfterDiscard,
        afterDiscardAndReturn,
      },
      browserBinding: session.receipt,
    };
  } finally {
    await session.close();
  }
}

/** Open the current revision in the seeded context and retire that exact handle. */
export async function observePanelDraft(
  runner: HeadlessRunner,
  contextId: string,
  panelPath: string,
) {
  const handle = await runner.openPanelClient(panelPath, {
    contextId,
    ref: `ctx:${contextId}`,
    focus: false,
    parentId: null,
  });
  try {
    return await verifyPanelDraft(handle);
  } finally {
    await handle.archive();
  }
}
