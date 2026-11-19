import {z} from "zod";
import {createReceiverRpcMethods} from "@vibestudio/shared/rpcMethods";
import {localMessagingWorlds} from "./worlds.js";
export const localMessagingInputSchema=z.object({contextId:z.string().min(1),caseId:z.enum(localMessagingWorlds.map(world=>world.id) as [string,...string[]]),executorModel:z.string().regex(/^[^:]+:.+$/u)}).strict();
export const localMessagingQualificationSchema = localMessagingInputSchema.omit({ executorModel: true });
export type LocalMessagingQualification = z.infer<typeof localMessagingQualificationSchema>;
export type LocalMessagingInput=z.infer<typeof localMessagingInputSchema>;
export type LocalMessagingResult={teacher:{trainingEligible:boolean;calls:unknown[];report:unknown;captureErrors:string[];executionError:unknown}|null;world:{kind:"local-messaging";contextId:string;caseId:string};verification:{passed:boolean};evidence:unknown;cleanupErrors:string[]};
export interface LocalMessagingReceiver {
  runLocalMessagingTeacher(input: LocalMessagingInput): Promise<LocalMessagingResult>;
  qualifyLocalMessaging(input: LocalMessagingQualification): Promise<LocalMessagingResult>;
}
export const localMessagingRpcMethods=createReceiverRpcMethods<LocalMessagingReceiver>(["runLocalMessagingTeacher", "qualifyLocalMessaging"]);
