export function requireAssignedWorld<World extends { id: string }>(
  worlds: readonly World[],
  caseId: string,
  message: string,
): World {
  const assigned = worlds.find(({ id }) => id === caseId);
  if (!assigned) throw new Error(message);
  return assigned;
}
