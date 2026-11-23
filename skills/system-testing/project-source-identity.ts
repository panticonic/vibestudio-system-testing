type Reference = {source:string;digest:string;fact:string};
/** Authorization binds exact source coordinates, not the order used to serialize their set. */
export function sameProjectSourceSelection(left: readonly Reference[] | undefined, right: readonly Reference[]): boolean {
  if (!Array.isArray(left)) return false;
  const key = (row: Reference) => JSON.stringify([row.source,row.digest,row.fact]);
  if (left.some(row=>!row||typeof row.source!=="string"||typeof row.digest!=="string"||typeof row.fact!=="string")) return false;
  const actual = new Set(left.map(key)), expected = new Set(right.map(key));
  return actual.size===expected.size && [...actual].every(item=>expected.has(item));
}
