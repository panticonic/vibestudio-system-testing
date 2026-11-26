/** Validate supplied native references and the public value shape, not a private answer copy. */
export function recordedFindingsBindNativeReferences(value: unknown, affected: readonly string[], withdrawn: readonly string[]): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row=value as Record<string,unknown>;
  const strings=(input:unknown):input is string[]=>Array.isArray(input)&&input.every(item=>typeof item==="string");
  return ["supported","caution","missing","ambiguous"].includes(row.disposition as string)&&
    (row.originalRationale===null||typeof row.originalRationale==="string")&&
    strings(row.affected)&&row.affected.every(path=>affected.includes(path))&&
    strings(row.withdrawn)&&row.withdrawn.every(path=>withdrawn.includes(path))&&
    strings(row.reasons);
}
