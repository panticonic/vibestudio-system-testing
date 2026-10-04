/** Self-contained, read-only source observation; no generated-app internals. */
export async function captureTrelloSource(): Promise<{
  title: string;
  lists: Array<{ id: string; name: string }>;
  cards: Array<{ name: string; idList: string }>;
  archivedCards: number;
  checklists: number;
  attachments: number;
}> {
  const response = await fetch(
    new URL(location.href).pathname.replace(/\/$/, "") + ".json",
    { credentials: "include" },
  );
  if (!response.ok)
    throw new Error("Source Trello export returned HTTP " + response.status);
  const board = await response.json();
  if (!Array.isArray(board.cards) || !Array.isArray(board.lists))
    throw new Error("Source Trello export lacks cards/lists");
  const activeLists = new Set(
    board.lists.filter((l: any) => !l.closed).map((l: any) => l.id),
  );
  return {
    title: board.name,
    lists: board.lists
      .filter((l: any) => !l.closed)
      .map((l: any) => ({ id: l.id, name: l.name })),
    cards: board.cards
      .filter((c: any) => !c.closed && activeLists.has(c.idList))
      .map((c: any) => ({ name: c.name, idList: c.idList })),
    archivedCards: board.cards.filter((c: any) => c.closed).length,
    checklists: board.checklists?.length ?? 0,
    attachments: board.cards.reduce(
      (n: number, c: any) => n + (c.attachments?.length ?? 0),
      0,
    ),
  };
}
