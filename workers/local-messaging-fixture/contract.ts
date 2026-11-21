import {createReceiverRpcMethods} from "@vibestudio/shared/rpcMethods";
import type {LocalMessagingProbeDO,LocalMessagingSenderDO,LocalMessagingChannelDO} from "./index.js";
type Receiver=Pick<LocalMessagingProbeDO,"configure"|"snapshot"|"leaveOwnedRoster"> & Pick<LocalMessagingSenderDO,"inspect"|"inspectDelivery"|"send"|"closeAdmission"> & Pick<LocalMessagingChannelDO,"joinFixtureDelivery">;
export const localMessagingFixtureMethods=createReceiverRpcMethods<Receiver>(["configure","snapshot","leaveOwnedRoster","inspect","inspectDelivery","send","closeAdmission","joinFixtureDelivery"]);

import type { OwnedMethodPeerDO } from "./owned-method-peer.js";
export const ownedMethodPeerMethods = createReceiverRpcMethods<
  Pick<OwnedMethodPeerDO, "configureMethodPeer" | "submitOwnedMethod" | "readOwnedExecutions" | "readOwnedRelationship" | "retireOwnedMembership">
>(["configureMethodPeer", "submitOwnedMethod", "readOwnedExecutions", "readOwnedRelationship", "retireOwnedMembership"]);
