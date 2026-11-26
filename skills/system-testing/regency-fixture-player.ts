import type { PanelHandle } from "@workspace/runtime";
import { waitFor } from "@workspace/testkit";
import { deserializeRpcFailure } from "@vibestudio/rpc";
import { rpcFailureSchema } from "@vibestudio/service-schemas/rpcFailure";

export const regencyFixturePanel = "panels/regency-fixture-player";
export type RegencyFixtureIdentity = { panelId: string; realm: string };
/** Preserve the native execution's structured cause across the owned renderer receipt. */
export function regencyFixtureFailure(response: {
  error: string | null;
  failure?: unknown;
}): Error | null {
  if (response.error === null) return null;
  const cause =
    response.failure == null
      ? new Error(response.error)
      : deserializeRpcFailure(rpcFailureSchema.parse(response.failure));
  const error = new Error(
    `Native Regency fixture action failed: ${response.error}`,
    { cause },
  );
  return Object.assign(error, {
    errorData: (cause as Error & { errorData?: unknown }).errorData,
  });
}
type Command =
  | { kind: "seat"; channelId: string }
  | { kind: "advance"; id: string; months: number }
  | { kind: "cancel" };

export function regencyFixtureRealm(key: string): string {
  return `natlang-realm-${key}`;
}

export async function bindRegencyFixturePlayer(
  panel: Pick<PanelHandle, "id" | "observe" | "stateArgs" | "cdp">,
  contextId: string,
  fixture: RegencyFixtureIdentity,
) {
  if (
    !/^natlang-realm-[a-f0-9-]{36}$/u.test(fixture.realm) ||
    panel.id !== fixture.panelId
  )
    throw new Error(
      "Regency fixture requires its exact player panel and realm.",
    );
  async function assertScope() {
    const state = await panel.observe();
    if (
      state.kind !== "workspace" ||
      state.source !== regencyFixturePanel ||
      state.panelId !== fixture.panelId ||
      state.contextId !== contextId ||
      state.requestedRef !== `ctx:${contextId}` ||
      (await panel.stateArgs.get<{ realm?: string }>()).realm !== fixture.realm
    )
      throw new Error(
        "The Regency renderer is outside its owned fixture scope.",
      );
  }
  await assertScope();
  async function command(value: Command) {
    const ticket = crypto.randomUUID();
    await assertScope();
    const { page } = await panel.cdp.session();
    try {
      await page.waitForSelector("form[data-regency-fixture-player] textarea");
      await assertScope();
      const submitted = await page.evaluate<boolean>(`(() => {
        const form = document.querySelector("form[data-regency-fixture-player]");
        if (form?.dataset.regencyFixturePlayer !== ${JSON.stringify(fixture.realm)} || form.querySelector("button").disabled) return false;
        form.querySelector("textarea").value = ${JSON.stringify(JSON.stringify({ ...value, ticket }))};
        form.requestSubmit();
        return true;
      })()`);
      if (!submitted)
        throw new Error(
          "The owned Regency control did not accept its scoped request.",
        );
      const response = await waitFor(
        async () => {
          const result = await page.evaluate<{
            ticket: string;
            error: string | null;
            failure?: unknown;
          } | null>(
            'JSON.parse(document.querySelector("form[data-regency-fixture-player] output")?.textContent || "null")',
          );
          return result?.ticket === ticket ? result : undefined;
        },
        { timeoutMs: 45_000, label: `owned Regency ${value.kind} receipt` },
      );
      await assertScope();
      const failure = regencyFixtureFailure(response);
      if (failure) throw failure;
    } finally {
      await page.close();
    }
  }
  return {
    seat: ({ key, target }: { key: string; target: string }) => {
      if (target !== `do:workers/pubsub-channel:PubSubChannel:${key}`)
        throw new Error(
          "The retained Regency seat did not resolve to its exact owned channel",
        );
      return command({ kind: "seat", channelId: key });
    },
    advance: (id: string, months: number) =>
      command({ kind: "advance", id, months }),
    cancel: () => command({ kind: "cancel" }),
  };
}
