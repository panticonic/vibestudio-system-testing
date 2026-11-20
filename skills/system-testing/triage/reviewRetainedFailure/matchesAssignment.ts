import type {
  RetainedFailurePacket,
  RetainedFailureRequest,
} from "../types.js";

export default function matchesAssignment(
  request: RetainedFailureRequest,
  packet: RetainedFailurePacket | null,
): boolean {
  return (
    packet !== null &&
    packet.runId === request.runId &&
    packet.failure.name === request.testName
  );
}
