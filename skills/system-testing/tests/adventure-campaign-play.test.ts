import { expect, it, vi } from "vitest";
import type { TestExecutionResult } from "../types.js";

vi.mock("@workspace/runtime", () => ({ blobstore: {} }));

import { validateAdventureCampaignPlay } from "./adventure-campaign-play.js";

const screenshot = (name: string) => ({
  name,
  digest: "sha256:" + name,
  mimeType: "image/png" as const,
  width: 1440,
  height: 1000,
});

const frame = (
  input: Partial<{
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
  }> = {}
) => ({
  key: "adventure-test-dead-letter",
  title: "The Dead Letter Office",
  location: "landing",
  journal: "The story begins.",
  ready: true,
  enabled: true,
  loaded: true,
  asset: "asset-cover",
  tick: 0,
  revision: 0,
  pending: "",
  error: "",
  overflow: false,
  ...input,
});

function successExecution() {
  const before = frame();
  const after = frame({
    location: "customs",
    journal: "Elin answers through the rain.",
    asset: "asset-generated",
    tick: 1,
    revision: 1,
  });
  return {
    messages: [],
    duration: 1,
    cleanupErrors: [] as string[],
    diagnostics: {
      adventureCampaign: {
        initial: [
          frame(),
          frame({
            key: "adventure-test-missing-country",
            title: "The Embassy of a Missing Country",
            location: "vestibule",
            asset: "asset-embassy",
          }),
          frame({
            key: "adventure-test-wandering-house",
            title: "The House That Crosses the World",
            location: "lobby",
            asset: "asset-house",
          }),
        ] as const,
        before,
        after,
        reloaded: { ...after },
        sideGames: [
          frame({
            key: "adventure-test-missing-country",
            title: "The Embassy of a Missing Country",
            location: "registry",
            journal: "Registrar Vesper accepts the passport.",
            asset: "asset-embassy-action",
            tick: 1,
            revision: 1,
          }),
          frame({
            key: "adventure-test-wandering-house",
            title: "The House That Crosses the World",
            location: "outside",
            journal: "The house settles above the orchard.",
            asset: "asset-house-action",
            tick: 1,
            revision: 1,
          }),
        ],
        screenshots: [
          screenshot("dead-letter-desktop"),
          screenshot("dead-letter-mobile"),
          screenshot("missing-country-desktop"),
          screenshot("missing-country-mobile"),
          screenshot("wandering-house-desktop"),
          screenshot("wandering-house-mobile"),
          screenshot("dead-letter-after"),
        ],
        sourceUnchanged: true,
        cleanupComplete: true,
      },
    },
  } satisfies TestExecutionResult;
}

it("accepts three real openings, a completed action, generated art, reload recovery, screenshots, and cleanup", () => {
  expect(validateAdventureCampaignPlay(successExecution())).toMatchObject({ passed: true });
});

it("rejects reusing the cover asset as generated art", () => {
  const execution = successExecution();
  execution.diagnostics.adventureCampaign.after.asset =
    execution.diagnostics.adventureCampaign.before.asset;
  expect(validateAdventureCampaignPlay(execution)).toMatchObject({ passed: false });
});

it("rejects an action that leaves the player in the wrong location", () => {
  const execution = successExecution();
  execution.diagnostics.adventureCampaign.after.location = "landing";
  expect(validateAdventureCampaignPlay(execution)).toMatchObject({ passed: false });
});

it("rejects a frame captured before pending work completes", () => {
  const execution = successExecution();
  execution.diagnostics.adventureCampaign.after.pending = "artist";
  expect(validateAdventureCampaignPlay(execution)).toMatchObject({ passed: false });
});

it("rejects missing side campaign actions", () => {
  const execution = successExecution();
  execution.diagnostics.adventureCampaign.sideGames = [];
  expect(validateAdventureCampaignPlay(execution)).toMatchObject({ passed: false });
});

it("rejects a side campaign whose tick did not advance", () => {
  const execution = successExecution();
  const sideGame = execution.diagnostics.adventureCampaign.sideGames[0];
  if (!sideGame) throw new Error("Success fixture must contain a side campaign");
  sideGame.tick = 0;
  expect(validateAdventureCampaignPlay(execution)).toMatchObject({ passed: false });
});

it("rejects reloads that lose the generated asset", () => {
  const execution = successExecution();
  execution.diagnostics.adventureCampaign.reloaded.asset = "asset-old";
  expect(validateAdventureCampaignPlay(execution)).toMatchObject({ passed: false });
});

it("rejects narrow viewport overflow", () => {
  const execution = successExecution();
  execution.diagnostics.adventureCampaign.initial[1].overflow = true;
  expect(validateAdventureCampaignPlay(execution)).toMatchObject({ passed: false });
});

it("rejects incomplete screenshot capture", () => {
  const execution = successExecution();
  execution.diagnostics.adventureCampaign.screenshots.pop();
  expect(validateAdventureCampaignPlay(execution)).toMatchObject({ passed: false });
});

it("rejects cleanup errors even when the campaign evidence is complete", () => {
  const execution = successExecution();
  execution.cleanupErrors = ["archive panel failed"];
  expect(validateAdventureCampaignPlay(execution)).toMatchObject({ passed: false });
});

it("rejects a missing generated asset even when a fallback image decodes", () => {
  const execution = successExecution();
  execution.diagnostics.adventureCampaign.after.asset = "";
  execution.diagnostics.adventureCampaign.reloaded.asset = "";
  expect(validateAdventureCampaignPlay(execution)).toMatchObject({ passed: false });
});
