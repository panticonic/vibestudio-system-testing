import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { NotificationStateFixtureDO } from "./index.js";

export type FixtureLane = { id: string; label: string; generation: number };
export type FixtureSeed = {
  id: string;
  title: string;
  revision?: number;
  at?: number;
  account?: "assigned" | "neighbor";
  read?: boolean;
  kind?: string;
  channel?: string;
};
export type FixtureConfiguration = {
  desk: string;
  initial: FixtureSeed[];
  change?:
    | { put: FixtureSeed }
    | { remove: string; account?: "assigned" | "neighbor" };
  transition?: "rotate" | "switch" | "retire";
};
export const notificationStateFixtureMethods = createReceiverRpcMethods<
  Pick<
    NotificationStateFixtureDO,
    "configure" | "read" | "refresh" | "acknowledge" | "audit"
  >
>(["configure", "read", "refresh", "acknowledge", "audit"]);
