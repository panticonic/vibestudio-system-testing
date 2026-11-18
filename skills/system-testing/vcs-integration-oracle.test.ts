import { expect, it } from "vitest";
import {
  verifyWorkspaceIntegration,
  type IntegrationOracleFixture,
} from "./vcs-integration-oracle.js";

const source = { kind: "event" as const, eventId: "incoming" };
const head = { kind: "event" as const, eventId: "candidate" };
const expected = { options: { previews: true, style: "shadow" } };
const fixture: IntegrationOracleFixture = {
  contextId: "task",
  source,
  repositoryId: "repo",
  mainEventId: "protected",
  commonSeedEvent: { kind: "event", eventId: "seed" },
  files: ["routes", "limits"].map((id) => ({
    fileId: id,
    path: `settings/${id}.json`,
    sourceChangeIds: [`incoming:${id}`],
    expected,
  })),
};

function client(
  options: { wrongHistory?: boolean; extraField?: boolean } = {},
) {
  return {
    async status() {
      return { workingHead: head, mainEventId: "protected" };
    },
    async readFile(input: { file: { fileId: string } }) {
      const fileId = input.file.fileId;
      return {
        repositoryId: "repo",
        fileId,
        path: `settings/${fileId}.json`,
        content: {
          kind: "text",
          text:
            options.extraField && fileId === "limits"
              ? '{"options":{"style":"shadow","previews":true,"__proto__":{"replacement":true}}}'
              : '{"options":{"style":"shadow","previews":true}}',
        },
      };
    },
    async compare() {
      return {
        resolution: {
          complete: true,
          concluded: true,
          remainingCoordinateCount: 0,
        },
        coordinates: [{ decisionId: "merged" }],
        nextCursor: null,
      };
    },
    async inspect() {
      return {
        node: {
          kind: "decision",
          value: {
            sourceState: source,
            entries: fixture.files.map((file) => ({
              coordinate: { kind: "file", id: file.fileId },
              resolution: "composed",
              accountedSourceChangeIds:
                options.wrongHistory && file.fileId === "limits"
                  ? ["incoming:routes"]
                  : file.sourceChangeIds,
            })),
          },
        },
      };
    },
  } as unknown as Parameters<typeof verifyWorkspaceIntegration>[0];
}

it("checks the exact content and attributable integration history for every file", async () => {
  const accepted = await verifyWorkspaceIntegration(client(), fixture);
  expect(accepted.passed).toBe(true);
  expect(accepted.verificationPaths).toEqual([
    "settings/routes.json",
    "settings/limits.json",
  ]);

  const missingDecision = await verifyWorkspaceIntegration(
    client({ wrongHistory: true }),
    fixture,
  );
  expect(missingDecision.passed).toBe(false);
  expect(missingDecision.reasons).toEqual([
    "No reachable composed/current decision accounts for settings/limits.json",
  ]);

  const extra = await verifyWorkspaceIntegration(
    client({ extraField: true }),
    fixture,
  );
  expect(extra.passed).toBe(false);
  expect(extra.reasons).toEqual([
    "Required or preserved fields differ: settings/limits.json",
  ]);
});
