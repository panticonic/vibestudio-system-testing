import { describe, expect, it } from "vitest";
import {
  validateDeterministicRun,
  validateDeterministicSummary,
} from "./deterministic-validator.js";
import { panelAutomationResourcesForSuite, PANEL_AUTOMATION_RESOURCE } from "./panel-authority.js";

describe("deterministic system-test validation", () => {
  it("parses the final fenced summary without consuming earlier invocation JSON", () => {
    const result = validateDeterministicSummary([
      { content: '{"code":"return summarize(result)","total":"not the summary"}' },
      {
        content: [
          "```json",
          '{"total":1,"passed":1,"failed":0,"errored":0,"skipped":0,"duration":12,"failures":[]}',
          "```",
        ].join("\n"),
      },
    ]);

    expect(result).toMatchObject({ passed: true });
  });

  it("validates harness-owned summary evidence without an agent transcript", () => {
    expect(
      validateDeterministicRun({
        messages: [],
        duration: 4,
        diagnostics: {
          deterministicSummary: { total: 2, passed: 2, failed: 0, errored: 0 },
        },
      })
    ).toMatchObject({ passed: true });
  });

  it("serializes every panel-control suite on the shared automation resource", () => {
    expect(
      [true, true, true, true].map((usesPanelAutomation) =>
        panelAutomationResourcesForSuite({ usesPanelAutomation })
      )
    ).toEqual([
      [PANEL_AUTOMATION_RESOURCE],
      [PANEL_AUTOMATION_RESOURCE],
      [PANEL_AUTOMATION_RESOURCE],
      [PANEL_AUTOMATION_RESOURCE],
    ]);
    expect(panelAutomationResourcesForSuite({ usesPanelAutomation: false })).toBeUndefined();
  });
});
