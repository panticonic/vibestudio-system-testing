/** Presence of the actual public query value; truth and completeness require native-bound meaning review. */
export function hasRecordedFindings(value: unknown): boolean {
  if(value===null||typeof value!=="object"||Array.isArray(value))return false;
  const answer=(value as {answer?:unknown}).answer;
  return typeof answer==="string"&&Boolean(answer.trim());
}
