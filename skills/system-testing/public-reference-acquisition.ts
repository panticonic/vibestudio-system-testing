/** Existing RPC failures retain application errorData and causes across receivers. */
export function publicReferenceAcquisitionFailure(
  message: string,
  evidence: Record<string, unknown>,
  cause?: unknown,
): Error {
  return Object.assign(new Error(message, cause === undefined ? undefined : {cause}), {
    errorData: {publicReferenceAcquisition: evidence},
  });
}
