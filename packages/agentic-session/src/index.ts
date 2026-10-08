// =============================================================================
// @workspace/agentic-session — Headless agentic session convenience
// =============================================================================

// --- HeadlessSession ---
export { HeadlessSession } from "./headless-session.js";
export type {
  HeadlessSessionConfig,
  HeadlessWithAgentConfig,
  ObservedUiFeedback,
  SessionSnapshot,
} from "./headless-session.js";

// --- Channel Helpers ---
export {
  getRecommendedChannelConfig,
  subscribeHeadlessAgent,
} from "./channel.js";
export type { SubscribeHeadlessAgentOptions } from "./channel.js";

// --- Re-export Pi-native types from agentic-core for convenience ---
export type {
  ChatMessage,
  ChatParticipantMetadata,
  ConnectionConfig,
  ChatMethodResult,
} from "@workspace/agentic-core";
