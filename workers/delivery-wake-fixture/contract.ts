import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { ServerLogEvent } from "@workspace/pubsub";

export type RecipientAddress = { recipient: string; revision: number; after: number; through: number };
export type WakeSeed = { key: string; recipient: string; peer: string; events: ServerLogEvent[]; omit: number | null; seedThrough: number | null };
export type MailboxRow = { deliveryId: string; event: string; sequence: number; recipient: string; revision: number; state: string };
export type WakeProjection = {
  cursor: number; recipient: { id: string; revision: number; active: boolean; attached: boolean } | null;
  pending: RecipientAddress | null; history: ServerLogEvent[]; rows: MailboxRow[];
  contextIds: string[]; contextCopies: number;
  receipts: { messageId: string; participantId: string; state: string }[];
};
export type WakeApplied = { inserted: number; duplicateReplay: number; native: WakeProjection };
export interface DeliveryWakeReceiver {
  seed(input: WakeSeed): Promise<void>;
  inspect(input: { key: string }): Promise<WakeProjection>;
  recover(input: RecipientAddress & { key: string }): Promise<WakeApplied>;
}
export const deliveryWakeMethods = createReceiverRpcMethods<DeliveryWakeReceiver>(["seed", "inspect", "recover"]);
