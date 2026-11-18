import { z } from "zod";
import { contentProjectRequestSchema } from "@workspace/natlang-services";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type { verifyContentProject } from "./content-project-oracle.js";
export const contentProjectInputSchema=z.object({contextId:z.string().min(1),name:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),title:z.string().min(1),request:contentProjectRequestSchema}).strict();
export const contentProjectTeacherInputSchema=contentProjectInputSchema.extend({executorModel:z.string().regex(/^[^:]+:.+$/u)});
export type ContentProjectInput=z.infer<typeof contentProjectInputSchema>;
export type ContentProjectTeacherInput=z.infer<typeof contentProjectTeacherInputSchema>;
export type ContentProjectVerification=Awaited<ReturnType<typeof verifyContentProject>>;
export interface ContentProjectResult {teacher:PanelTeacherResult;world:{kind:"content-project";contextId:string;repoPath:string;before:string;after:string;request:ContentProjectInput["request"]};verification:ContentProjectVerification;}
export interface ContentProjectReceiver {
  runContentProjectTeacher(input:ContentProjectTeacherInput):Promise<ContentProjectResult>;
  runContentProjectReference(input:ContentProjectInput,variant:"reference"|"negative"):Promise<ContentProjectVerification>;
}
export const contentProjectRpcMethods=createReceiverRpcMethods<ContentProjectReceiver>(["runContentProjectTeacher","runContentProjectReference"]);
