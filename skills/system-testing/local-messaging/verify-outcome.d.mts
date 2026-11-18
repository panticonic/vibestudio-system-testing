/** Raw independent fixture evidence; invalid/incomplete input is rejected by the exact verifier. */
export function verifyOutcome(input: unknown): { passed: true; status: "held" | "delivered"; messageIds: string[]; recipientIds?: string[] };
