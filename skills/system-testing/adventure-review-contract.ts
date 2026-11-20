import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

type Opening = { contextId: string; caseId: string; journey: string };
export type AdventureReviewInput = Opening & {
  before: unknown;
  panel: {
    location: string;
    asset: string;
    tick: number;
  };
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
type TransitionFrame = {
  location: string;
  asset: string;
  tick: number;
  narration: string;
  light: string;
};
export type ProgrammedAdventureInput = {
  contextId: string;
  journey: string;
  before: unknown;
  frames: Record<"before" | "after" | "repaint" | "reload", TransitionFrame>;
};
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
  captureProgrammedAdventure(
    input: ProgrammedAdventureInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
}
export const managedAdventureMethods =
  createReceiverRpcMethods<ManagedAdventureReceiver>([
    "inspectManagedAdventureOpening",
    "runManagedAdventureTeacher",
    "qualifyManagedAdventure",
    "captureProgrammedAdventure",
  ]);
