import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
export type ImageFixtureStep = "ok" | "unavailable" | "wrong-format";
export type ImageFixtureSeed = { originals: Record<"png" | "jpeg" | "webp",string>; steps: ImageFixtureStep[] };
export type ImageFixtureReceipt = { index:number; session:string; format:string; prompt:string; referenceDigests:string[]; outcome:ImageFixtureStep };
export interface ImageJobFixtureControl {
  configure(input: ImageFixtureSeed): Promise<void>;
  readFixtureTransport(): Promise<ImageFixtureReceipt[]>;
}
export const imageJobFixtureMethods = createReceiverRpcMethods<ImageJobFixtureControl>(["configure","readFixtureTransport"]);
