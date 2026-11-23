import { isDeepStrictEqual } from "node:util";
import { stableSha256Hex } from "@vibestudio/content-addressing";
import { contextId, openPanel, fs, type PanelHandle } from "@workspace/runtime";
import type {
  BoardCard, BoardMigrationOutcome, BoardMigrationReceipt, LegacyBoard,
  MigrationApproval, MigrationBasis, MigrationSelection, MigrationView,
} from "@workspace-skills/open-user-goal/reviewBoardMigration/types";
import type { OpenBoardMigrationWorld } from "./open-goal-board-migration-worlds.js";

const encode = (value: unknown) => JSON.stringify(value);
const html = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
type Rendered = Omit<LegacyBoard, "revision"> & { cards: BoardCard[] };
const capture = `(() => {
  const source = document.querySelector("main[data-board]");
  const text = (node, selector) => node.querySelector(selector)?.textContent ?? "";
  return {
    id: source.dataset.board,
    title: text(source, "h1"),
    edition: text(source, "[data-edition]"),
    cards: Array.from(source.querySelectorAll("article"), card => ({
      id: card.dataset.card,
      title: text(card, "h2"),
      list: text(card, "[data-list]"),
      archived: card.dataset.archived === "true",
      summary: text(card, "[data-summary]"),
      checklist: Array.from(card.querySelectorAll("[data-check]"), item => item.textContent),
      attachments: Array.from(card.querySelectorAll("[data-attachment]"), item => item.textContent),
    })),
  };
})()`;

export function renderLegacyBoard(world: Rendered): string {
  const articles = world.cards.map(card =>
    `<article data-card="${html(card.id)}" data-archived="${card.archived}"><h2>${html(card.title)}</h2><p data-list>${html(card.list)}</p><p data-summary>${html(card.summary)}</p>` +
    card.checklist.map(item => `<p data-check>${html(item)}</p>`).join("") +
    card.attachments.map(item => `<p data-attachment>${html(item)}</p>`).join("") + "</article>").join("");
  const document = `<!doctype html><html><meta charset="utf-8"><main data-board="${html(world.id)}"><h1>${html(world.title)}</h1><p data-edition>${html(world.edition)}</p>${articles}</main></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(document)}`;
}

const identity = ({ id, title, edition, cards }: Rendered): LegacyBoard =>
  ({ id, title, edition, revision: stableSha256Hex(cards) });

export function admitBoardMigration(
  observed: MigrationView, basis: MigrationBasis, selection: MigrationSelection,
): BoardMigrationReceipt | null {
  const { approval, target, existing } = basis;
  const { board, cards } = observed;
  if (!approval || approval.boardId !== board.id || approval.revision !== board.revision ||
      approval.target !== target || selection.target !== target || !selection.cards.length)
    return null;
  const selectedIds = new Set(selection.cards.map(card => card.id));
  const current = cards.filter(card => selectedIds.has(card.id));
  if (selection.cards.some(card => !approval.authorizedCardIds.includes(card.id)) ||
      !isDeepStrictEqual(selection.cards, current) ||
      (existing !== null && !isDeepStrictEqual(existing, current)))
    return null;
  return { target, boardId: board.id, revision: board.revision, cards: current };
}

export async function prepareOpenBoardMigration(
  input: { caseId: string; goal: string; contextId: string },
  world: OpenBoardMigrationWorld,
) {
  if (contextId !== input.contextId || world.id !== input.caseId || world.goal !== input.goal)
    throw new Error("Use the exact owned migration workspace");
  const directory = await fs.mkdtemp("board-migration");
  const destination = `${directory}/retained.json`;
  const approvalFile = `${directory}/approval.json`;
  const neighbor = `${directory}/neighbor.txt`;
  const neighborText = "Keep the independent workspace item unchanged.";
  const sources = world.sources.map(source => ({ ...source, id: crypto.randomUUID() }));
  const expected = sources[world.selected]!;
  const expectedId = identity(expected);
  const expectedCards = expected.cards.filter(card => world.requested.includes(card.id));
  const expectedSelection = { target: world.target, cards: expectedCards };
  const initial: BoardMigrationReceipt | null = world.existing === "empty" ? null : {
    target: world.target, boardId: expectedId.id, revision: expectedId.revision,
    cards: world.existing === "same" ? expectedCards : expectedCards.map(card => ({
      ...card, summary: card.summary + " Independent working edit.",
    })),
  };
  const approval: MigrationApproval = world.approval === "missing" ? null : {
    boardId: world.approval === "other-source" ? sources[0]!.id : expectedId.id,
    revision: world.approval === "stale" ? "superseded-revision" : expectedId.revision,
    target: world.target,
    authorizedCardIds: world.approval === "partial" ? world.requested.slice(0, 1) : world.requested,
  };
  await fs.writeFile(approvalFile, encode(approval));
  await fs.writeFile(neighbor, neighborText);
  if (initial) await fs.writeFile(destination, encode(initial));
  const handles = new Map<string, PanelHandle>();
  const observations: { view: MigrationView; panelId: string; generation: unknown }[] = [];
  const available = sources.map(identity);
  let basis: MigrationBasis | undefined;
  let writing = false;
  let writes = 0;

  async function observe(id: string) {
    const source = sources.find(item => item.id === id);
    if (!source) throw new Error("The board is outside the owned migration scope");
    const url = renderLegacyBoard(source);
    const panelSource = `browser:${url}`;
    let panel = handles.get(id);
    if (!panel) {
      panel = await openPanel(url, { contextId: input.contextId, parentId: null, title: source.title, focus: false });
      handles.set(id, panel);
    }
    const before = await panel.observe();
    const session = await panel.cdp.session();
    try {
      await session.page.waitForSelector("main[data-board] h1");
      const rendered = await session.page.evaluate<Rendered>(capture);
      const after = await panel.observe();
      const generation = session.receipt?.generation;
      if (before.kind !== "browser" || after.kind !== "browser" || before.source !== panelSource ||
          after.source !== panelSource || generation?.panelId !== panel.id ||
          after.panelId !== panel.id || rendered.id !== id)
        throw new Error("CDP observation did not belong to the selected board");
      return { view: { board: identity(rendered), cards: rendered.cards }, panelId: panel.id, generation };
    } finally {
      await session.close();
    }
  }

  async function readDestination(): Promise<BoardMigrationReceipt | null> {
    return await fs.exists(destination) ? JSON.parse(await fs.readFile(destination, "utf8") as string) : null;
  }
  async function readBasis(): Promise<MigrationBasis> {
    return {
      target: world.target, existing: (await readDestination())?.cards ?? null,
      approval: JSON.parse(await fs.readFile(approvalFile, "utf8") as string),
    };
  }

  const boardMigration = {
    async listSources() { return structuredClone(available); },
    async inspect(id: string) {
      const observed = await observe(id);
      observations.push(observed);
      return structuredClone(observed.view);
    },
    async readTarget() { basis = await readBasis(); return structuredClone(basis); },
    async retain(boardId: string, revision: string, selection: MigrationSelection) {
      const previous = observations.findLast(observation => observation.view.board.id === boardId && observation.view.board.revision === revision);
      if (!previous || !basis || writing || previous.view.board.id !== boardId ||
          previous.view.board.revision !== revision || world.disposition === "audit")
        return null;
      writing = true;
      try {
        const source = await observe(boardId);
        const current = await readBasis();
        if (!isDeepStrictEqual(source.view, previous.view) ||
            !isDeepStrictEqual(source.generation, previous.generation) ||
            !isDeepStrictEqual(current, basis)) return null;
        const receipt = admitBoardMigration(source.view, current, selection);
        if (!receipt) return null;
        const existing = await readDestination();
        if (existing) return isDeepStrictEqual(existing, receipt) ? existing : null;
        const text = encode(receipt);
        const handle = await fs.open(destination, "wx");
        try {
          const { bytesWritten } = await handle.write(text);
          if (bytesWritten !== new TextEncoder().encode(text).byteLength)
            throw new Error("Incomplete migration receipt");
        } catch (error) {
          await handle.close();
          await fs.unlink(destination);
          throw error;
        }
        await handle.close();
        writes++;
        const written = await readDestination();
        if (!isDeepStrictEqual(written, receipt)) throw new Error("Migration receipt did not persist");
        return written;
      } finally {
        writing = false;
      }
    },
  };

  async function verify(value: unknown) {
    const report = value as { status?: string; skill?: string; outcome?: BoardMigrationOutcome } | null;
    const outcome = report?.outcome;
    const final = await readDestination();
    const repeated = await observe(expectedId.id);
    const receipt = world.disposition === "retained" || world.disposition === "existing" ? {
      ...expectedSelection, boardId: expectedId.id, revision: expectedId.revision,
    } : null;
    const checks = {
      exactRenderedMigrationBoard: observations.some(observation => isDeepStrictEqual(observation, repeated)) && isDeepStrictEqual(repeated.view.cards, expected.cards),
      exactMigrationAuthority: Boolean(basis && isDeepStrictEqual(basis.approval, approval) &&
        basis.target === world.target && isDeepStrictEqual(basis.existing, initial?.cards ?? null)),
      matchedMigrationCardScope: isDeepStrictEqual(outcome?.board, expectedId) &&
        isDeepStrictEqual(outcome?.selection, expectedSelection),
      independentMigrationReadback: isDeepStrictEqual(final, receipt ?? initial) &&
        isDeepStrictEqual(outcome?.receipt, receipt) && (world.disposition === "retained" ? writes > 0 : writes === 0),
      preservedMigrationNeighbors: await fs.readFile(neighbor, "utf8") === neighborText &&
        isDeepStrictEqual(JSON.parse(await fs.readFile(approvalFile, "utf8") as string), approval),
      matchedWorkspaceMigrationDisposition: report?.status === "workspace-skill-reviewed" &&
        report.skill === "boardMigration" && outcome?.disposition === world.disposition && Boolean(outcome.reason.trim()),
    };
    return { ...input, checks, passed: Object.values(checks).every(Boolean), available,
      rendered: repeated.view, basis, final, outcome };
  }

  async function qualify() {
    await boardMigration.listSources();
    const rejectsForeignBoard = await boardMigration.inspect("foreign-board").then(() => false, () => true);
    const { board } = await boardMigration.inspect(expectedId.id);
    await boardMigration.readTarget();
    const rejectsStaleMigration = await boardMigration.retain(board.id, "old-revision", expectedSelection) === null;
    const attempted = await boardMigration.retain(board.id, board.revision, expectedSelection);
    const blocked = world.disposition === "held" || world.disposition === "audit";
    const rejectsUnapprovedMigration = !blocked || attempted === null;
    const receipt = blocked ? null : attempted;
    const report = { status: "workspace-skill-reviewed", skill: "boardMigration", outcome: {
      board, selection: expectedSelection, disposition: world.disposition, receipt,
      reason: "The rendered source, retained approval and target readback were independently compared.",
    } };
    const proof = await verify(report);
    const rejectsRetargetedResult = !(await verify({ ...report, outcome: {
      ...report.outcome, selection: { ...expectedSelection, target: "other-target" },
    } })).passed;
    const checks = { ...proof.checks, rejectsForeignBoard, rejectsStaleMigration, rejectsUnapprovedMigration, rejectsRetargetedResult };
    return { ...proof, checks, passed: Object.values(checks).every(Boolean) };
  }
  async function close() {
    const outcomes = await Promise.allSettled([...handles.values()].map(handle => handle.archive()));
    await fs.rm(directory, { recursive: true, force: true });
    const failure = outcomes.find(outcome => outcome.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  return { services: { boardMigration }, verify, qualify, close };
}
