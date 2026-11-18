import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { VcsStateNodeRef } from "@vibestudio/service-schemas/vcs";
import { prepareWorkspaceIntegration } from "./vcs-integration-fixture.js";
import { verifyWorkspaceIntegration } from "./vcs-integration-oracle.js";
import { exerciseWorkspaceIntegration } from "./vcs-integration-qualification.js";

export { prepareWorkspaceIntegration, verifyWorkspaceIntegration, exerciseWorkspaceIntegration };
export type OwnedIntegrationWorld = Omit<Awaited<ReturnType<typeof prepareWorkspaceIntegration>>, "cleanup">;
export type IntegrationFixtureInput = {seed:string;values:{theme:string;locale:string}};
/** Internal harness contract; no reverse dependency on the worker package. */
export interface IntegrationFixtureReceiver {
  prepareWorkspaceIntegrationFixture(input:IntegrationFixtureInput):Promise<OwnedIntegrationWorld & {before:VcsStateNodeRef}>;
  verifyWorkspaceIntegrationFixture():ReturnType<typeof verifyWorkspaceIntegration>;
  qualifyWorkspaceIntegrationFixture(variant:"reference"|"negative"|"alias"):ReturnType<typeof exerciseWorkspaceIntegration>;
}
export const integrationFixtureRpcMethods = createReceiverRpcMethods<IntegrationFixtureReceiver>([
  "prepareWorkspaceIntegrationFixture", "verifyWorkspaceIntegrationFixture", "qualifyWorkspaceIntegrationFixture",
]);
