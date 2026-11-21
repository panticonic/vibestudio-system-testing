import type { PanelHandle } from "@workspace/runtime";
import { waitFor } from "@workspace/testkit";

export type GrimoireClock = { day: number; phase: number };
export type GrimoireFixturePanel = { contextId: string; estateKey: string };
type Panel = Pick<PanelHandle, "id" | "observe" | "stateArgs" | "cdp">;

const scenePrefix = "natlang-scene-";
export function grimoireSceneEstate(key: string): string {
  return scenePrefix + key;
}
export function grimoireSceneDocket(estateKey: string): string {
  if (!/^natlang-scene-[a-f0-9-]{36}$/u.test(estateKey))
    throw new Error("Expected one assigned caretaker garden");
  return estateKey.slice(scenePrefix.length);
}
export function grimoireClockIndex(clock: GrimoireClock): number {
  return clock.day * 4 + clock.phase;
}
function clockLabel(index: number): string {
  const phase = ["MORNING", "AFTERNOON", "EVENING", "NIGHT"][index % 4];
  return `DAY ${Math.floor(index / 4)} · ${phase}`;
}

export async function assertOwnedGrimoirePanel(panel: Panel, fixture: GrimoireFixturePanel): Promise<void> {
  const observed = await panel.observe();
  if (observed.panelId !== panel.id || observed.kind !== "workspace" ||
      observed.source !== "panels/grimoire" || observed.contextId !== fixture.contextId ||
      observed.requestedRef !== `ctx:${fixture.contextId}` ||
      (await panel.stateArgs.get<{ estateKey?: string }>()).estateKey !== fixture.estateKey)
    throw new Error("The Grimoire player panel is outside the exact owned garden");
}

/** Advance only the owned panel's normal player control. The native DO still decides player authority. */
export async function advanceOwnedGrimoirePanel(panel: Panel, fixture: GrimoireFixturePanel, before: GrimoireClock): Promise<void> {
  await assertOwnedGrimoirePanel(panel, fixture);
  const { page } = await panel.cdp.session();
  try {
    const index = grimoireClockIndex(before);
    const current = () => page.evaluate<{ clock: string; busy: boolean }>(`({
      clock: document.querySelector(".garden-caption .eyebrow")?.textContent?.replace(/\\s+/gu, " ").trim() ?? "",
      busy: document.querySelector("main.grimoire")?.getAttribute("aria-busy") !== "false"
    })`);
    async function settled(expected: number) {
      await waitFor(async () => {
        const state = await current();
        return !state.busy && state.clock === clockLabel(expected) || undefined;
      }, { timeoutMs: 30_000, label: `Owned Grimoire player settles at ${clockLabel(expected)}` });
    }
    await settled(index);
    await assertOwnedGrimoirePanel(panel, fixture);
    await page.getByRole("button", { name: "Observe quietly", exact: true }).click();
    await settled(index + 1);
    await assertOwnedGrimoirePanel(panel, fixture);
  } finally {
    await page.close();
  }
}

/** Visit through an observation control that stays reachable as the illustration crops. */
export async function visitOwnedGrimoirePanel(
  panel: Panel,
  fixture: GrimoireFixturePanel,
  before: GrimoireClock,
  resident: string,
): Promise<void> {
  if (!resident.trim())
    throw new Error("A native Grimoire visit needs a real resident.");
  await assertOwnedGrimoirePanel(panel, fixture);
  const { page } = await panel.cdp.session();
  try {
    const expected = clockLabel(grimoireClockIndex(before));
    const read = () => page.evaluate<{ clock: string; busy: boolean; notice: string }>(`({
      clock: document.querySelector(".garden-caption .eyebrow")?.textContent?.replace(/\\s+/gu, " ").trim() ?? "",
      busy: document.querySelector("main.grimoire")?.getAttribute("aria-busy") !== "false",
      notice: document.querySelector(".garden-observations p")?.textContent ?? ""
    })`);
    await waitFor(async () => {
      const state = await read();
      return (!state.busy && state.clock === expected) || undefined;
    }, { timeoutMs: 30_000, label: "owned Grimoire resident control" });
    await assertOwnedGrimoirePanel(panel, fixture);
    await page.getByRole("button", { name: `Visit ${resident}`, exact: true }).click();
    await waitFor(async () => {
      const state = await read();
      return (!state.busy && state.clock === expected &&
        (state.notice.startsWith(`${resident} pauses to watch you.`) ||
          state.notice.startsWith(`${resident} recognises your hand`))) || undefined;
    }, { timeoutMs: 30_000, label: "owned Grimoire visit settles" });
    await assertOwnedGrimoirePanel(panel, fixture);
  } finally {
    await page.close();
  }
}
