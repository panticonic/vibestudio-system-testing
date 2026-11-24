import {assessSemanticOutcome} from "@workspace/application-outcomes/semantic-outcome-contract";
import { expect, it, vi } from "vitest";
import { preparePhoneFirstRun } from "./open-goal-phone-first-run-managed.js";
import { openPhoneFirstRunWorlds } from "./open-goal-phone-first-run-worlds.js";

vi.mock("@vibestudio/shared/mobileWorkspaceReadiness", () => ({}));
vi.mock("@vibestudio/service-schemas/phoneProvisioning", () => ({
  PhoneProviderSchema: { array: () => ({ parse: (value: unknown) => value }) },
}));
vi.mock("@vibestudio/workspace/configParser", () => ({ parseWorkspaceSystemEpochEnvelope: () => ({}) }));
vi.mock("@vibestudio/workspace/templateManifest", () => ({
  parseTemplateManifestContent: () => ({ top: { runtimeExtensions: { "react-native": ["extensions/react-native"] } } }),
}));
vi.mock("@vibestudio/workspace-contracts/clients", () => ({
  CURRENT_HOST_ABI: { "react-native": "test-abi" },
  isClientRuntime: (runtime: string) => runtime === "react-native",
}));

it("accepts repeated identical native read observations without admitting a pairing attempt", async () => {
  const world = openPhoneFirstRunWorlds.find(({ id }) => id === "phone-first-run-radio-paired-no-visible-session")!;
  const prepared = await preparePhoneFirstRun({ contextId: "owned", caseId: world.id }, world, {
    contextId: "owned",
    vcs: {
      status: async () => ({ mainEventId: "commit", workingHead: { kind: "event", eventId: "commit" } }),
      resolveRepository: async ({ repoPath }: { repoPath: string }) => ({ repoPath, repositoryId: repoPath }),
      readFile: async ({ repositoryId }: { repositoryId: string }) => ({
        content: {
          kind: "text",
          text: repositoryId === "clients/mobile-browser" ? JSON.stringify({
            vibestudio: { client: { id: "browser", runtime: "react-native", hostAbi: "test-abi" } },
          }) : JSON.stringify({ name: "@workspace-extensions/react-native" }),
        },
        contentHash: repositoryId,
      }),
    },
    workspacePhoneReadiness: () => ({ state: "opening" }),
    eligiblePhoneDesktops: () => [],
    bindPhoneSetup: async (_assignment: { paired: { deviceId: string } }) => ({
      request: { goal: world.goal, operationId: "operation" },
      services: { phoneSetupRead: {
        start: async () => ({ pairedDeviceId: _assignment.paired.deviceId, receipt: "setup" }),
        readiness: async () => ({ state: "opening", receipt: "ready" }),
      } },
    }),
  } as never);
  const prior = await prepared.qualify();
  expect(assessSemanticOutcome(prior).passed).toBe(true);
  expect(prior.passed).toBe(true);
  await prepared.services.phoneSetupRead.start("operation");
  await prepared.services.phoneSetupRead.readiness("setup");
  expect((await prepared.verify(prior.report)).passed).toBe(true);
  await expect(prepared.services.phoneFirstRun.inspect(prior.assignment.id)).resolves.toEqual(prior.assignment);
  expect((await prepared.verify(prior.report)).passed).toBe(true);
  await expect(prepared.services.phoneSetupPair.provision()).rejects.toThrow("no preparation, installation or pairing authority");
  expect((await prepared.verify(prior.report)).passed).toBe(false);
});
