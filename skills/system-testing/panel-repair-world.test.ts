// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { verifyPanelDraft } from "./panel-repair-oracle.js";
import {
  matchesPanelDraftChecks,
  panelRepairWorldSource,
  panelRepairWorlds,
  type DraftLoss,
} from "./panel-repair-world.js";

async function exercise(fault: DraftLoss | null) {
  const hostRequire = createRequire(join(process.cwd(), "package.json"));
  const esbuild = hostRequire.resolve("esbuild/bin/esbuild");
  const code = execFileSync(esbuild, ["--loader=tsx", "--format=cjs"], {
    input: panelRepairWorldSource(fault),
    encoding: "utf8",
  });
  const module = { exports: {} as { default: React.ComponentType } };
  new Function("module", "exports", "require", "React", code)(
    module,
    module.exports,
    (name: string) => {
      if (name !== "react")
        throw new Error(`Unexpected fixture import ${name}`);
      return React;
    },
    React,
  );
  const { container, getByRole, unmount } = render(
    React.createElement(module.exports.default),
  );
  const close = vi.fn(async () => undefined);
  function current(selector: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing fixture element ${selector}`);
    return element;
  }
  try {
    const session = {
      close,
      page: {
        getByRole(
          role: "button" | "textbox",
          options: { name: string; exact: boolean },
        ) {
          const element = () => getByRole(role, options);
          return {
            async inputValue() {
              return (element() as HTMLInputElement).value;
            },
            async click() {
              fireEvent.click(element());
            },
            async fill(value: string) {
              fireEvent.change(element(), { target: { value } });
            },
            async waitFor() {
              element();
            },
          };
        },
        locator(selector: string) {
          return {
            async waitFor() {
              current(selector);
            },
            async textContent() {
              return current(selector).textContent;
            },
          };
        },
      },
    };
    const result = await verifyPanelDraft({
      cdp: { session: async () => session },
    } as unknown as Parameters<typeof verifyPanelDraft>[0]);
    expect(close).toHaveBeenCalledOnce();
    return result;
  } finally {
    unmount();
  }
}

it.each(panelRepairWorlds)(
  "reproduces exactly the seeded failures for $id",
  async (world) => {
    const observed = await exercise(world.fault);
    expect(observed.passed).toBe(false);
    expect(
      matchesPanelDraftChecks(observed.checks, world.failedChecks),
      JSON.stringify(observed.checks),
    ).toBe(true);
  },
);

it("accepts the working editor and verifies every check independently", async () => {
  const observed = await exercise(null);
  expect(observed.passed).toBe(true);
  expect(matchesPanelDraftChecks(observed.checks, [])).toBe(true);
  expect(matchesPanelDraftChecks({}, [])).toBe(false);
});
