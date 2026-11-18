import { z } from "zod";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type { createOwnedOperations, verifyOwnedOperations } from "@workspace/natlang-services";
export const ownedOperationsInputSchema = z.object({ contextId: z.string().min(1), caseId: z.enum(["incident-payment-and-ledger", "release-audit-continuation"]), executorModel: z.string().regex(/^[^:]+:.+$/u) }).strict();
export type OwnedOperationsInput = z.infer<typeof ownedOperationsInputSchema>;
export type OwnedOperationsAudit = ReturnType<ReturnType<typeof createOwnedOperations>["audit"]>;
export type OwnedOperationsVerification = ReturnType<typeof verifyOwnedOperations>;
export type OwnedOperationsResult = { teacher: PanelTeacherResult & { trainingEligible: boolean; captureErrors: string[]; executionError: unknown }; world: { kind: "owned-operations"; contextId: string; caseId: string; request: unknown }; verification: OwnedOperationsVerification; audit: OwnedOperationsAudit; cleanupErrors: string[] };
export interface OwnedOperationsReceiver { runOwnedOperationsTeacher(input: OwnedOperationsInput): Promise<OwnedOperationsResult>; }
export const ownedOperationsRpcMethods = createReceiverRpcMethods<OwnedOperationsReceiver>(["runOwnedOperationsTeacher"]);
