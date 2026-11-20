import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

type Opening = { contextId: string; caseId: string; journey: string };
export type AdventureReviewInput = Opening & {
  before: unknown;
  panel: {
    location: string;
    asset: string;
    tick: number;
    importDenied: boolean;
  };
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedAdventureReceiver {
  inspectManagedAdventureOpening(input: Opening): Promise<unknown>;
  runManagedAdventureTeacher(
    input: AdventureReviewInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedAdventure(input: AdventureReviewInput): Promise<{
    verification: Verification;
    rejectedAlteredEvidence: boolean;
  }>;
}
export const managedAdventureMethods =
  createReceiverRpcMethods<ManagedAdventureReceiver>([
    "inspectManagedAdventureOpening",
    "runManagedAdventureTeacher",
    "qualifyManagedAdventure",
  ]);
