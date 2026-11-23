import type { InvocationObservations } from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { contextId, fs } from "@workspace/runtime";
import type { TendrilReport, TendrilRequest } from "@workspace-skills/tendrils/workflow/types";
import { prepareManagedTendril } from "./tendril-managed.js";
import { tendrilCandidateBuild } from "./tendril-worlds.js";
import type { LiveTendrilBoardWorld } from "./open-goal-live-tendril-board-worlds.js";

type Card = { id: string; title: string; edition: "current" | "archive" };
const fields = [
  { key: "label", shape: "text" }, { key: "minutes", shape: "nonnegative integer" },
  { key: "phase", shape: "local phase" }, { key: "confirmed", shape: "boolean" },
];
const controls = [
  { name: "startReview", key: "phase", value: "review" },
  { name: "returnToIntake", key: "phase", value: "intake" },
  { name: "acknowledge", key: "confirmed", value: true },
  { name: "clearReview", key: "confirmed", value: false },
  { name: "clearTimer", key: "minutes", value: 0 },
];
const headings = {
  "review-layout": "Review handoff",
  "incident-layout": "Incident handoff",
  "broken-boot": "Unreleased handoff",
} satisfies Record<keyof typeof tendrilCandidateBuild, string>;
export async function prepareOpenLiveTendrilBoard(
  input: { contextId: string; caseId: string; goal: string; channelId: string },
  world: LiveTendrilBoardWorld,
) {
  if (contextId !== input.contextId || world.id !== input.caseId || world.goal !== input.goal ||
      !input.channelId.startsWith("natlang-tendril-"))
    throw new Error("The Tendril board belongs to a different local presentation scope");
  const prepared = prepareManagedTendril(input, world.fixture);
  const card: Card = { id: crypto.randomUUID(), title: world.title, edition: "current" };
  const prior: Card = { id: crypto.randomUUID(), title: `${world.title} archive`, edition: "archive" };
  const authorized = new Set(world.fixture.request.steps.flatMap(step => step.kind === "update" ? [step.candidate] : []));
  const ticket = {
    card, platform: "headless",
    fields, controls,
    layouts: (Object.keys(tendrilCandidateBuild) as (keyof typeof tendrilCandidateBuild)[]).flatMap(candidate =>
      authorized.has(candidate) ? [{ candidate, build: tendrilCandidateBuild[candidate], heading: headings[candidate] }] : []),
  };
  const directory = await fs.mkdtemp("tendril-presentation-ticket");
  const path = `${directory}/current.json`;
  const serialized = JSON.stringify(ticket);
  await fs.writeFile(path, serialized);
  let selected: typeof ticket | null = null;
  const tendrilBoardDocket = {
    async list() { return [prior, card]; },
    async read(id: string) {
      if (id !== card.id) throw new Error("Use the current owned presentation ticket");
      const text = await fs.readFile(path, "utf8");
      if (text !== serialized) throw new Error("The board presentation authority changed");
      selected = JSON.parse(text) as typeof ticket;
      return selected;
    },
  };
  async function verify(value: unknown, invocation?: InvocationObservations) {
    const report = value as {
      card?: Card; plan?: TendrilRequest; actual?: TendrilReport; reason?: string;
    } | null;
    const outcome = report;
    const native = prepared.verify(outcome?.actual ?? null);
    const checks = {
      exactCurrentTendrilTicket: isDeepStrictEqual(selected, ticket) &&
        await fs.readFile(path, "utf8") === serialized,
      exactPlannedTendrilEffects: isDeepStrictEqual(selected,ticket),
      ownedTendrilPresentation: native.checks.presentation && native.checks.baseline,
      independentlyObservedRenderedAndStored: native.checks.exactEffects,
      verifiedTendrilBuildHistory: native.checks.nativeBuilds ?? true,
      matchedTendrilGoalReport: native.checks.report&&typeof outcome?.reason === "string" && outcome.reason.trim().length > 0,
    };
    return {
      outcomeContract:{effects:{checks:["exactCurrentTendrilTicket", "exactPlannedTendrilEffects", "ownedTendrilPresentation", "independentlyObservedRenderedAndStored", "verifiedTendrilBuildHistory"],rationale:"Independent native state, admission, captured operations and durable readback establish these facts."},
        returnedValue:{checks:["matchedTendrilGoalReport"],required:world.fixture.request.steps.every(step=>step.kind==="read"),rationale:"A requested query answer is required; a redundant result copy is optional after its requested native effect is established."},
        incidentalValues:{checks:[],rationale:"Known incorrect emitted application values use actual invocation definitions for masking."}},
      incorrectReturnValues:value!==undefined&&!(checks.matchedTendrilGoalReport)?[{required:world.fixture.request.steps.every(step=>step.kind==="read"),definition:invocation?.calls.find(call=>call.parentCallId===null)?.definition??{name:"workOnLiveTendrilBoard",source:"workOnLiveTendrilBoard.nl"},value}]:[],
 contextId: input.contextId, caseId: input.caseId, goal: input.goal, checks,
      passed: Object.values(checks).every(Boolean), native, available: [prior, card], ticket, outcome };
  }
  async function qualify() {
    await tendrilBoardDocket.list();
    const rejectedArchive = await tendrilBoardDocket.read(prior.id).then(() => false, () => true);
    await tendrilBoardDocket.read(card.id);
    const actual = await prepared.reference();
    const report = {
      actual, reason: "The native rendered board and durable state support the disposition.",
    };
    const result = await verify(report);
    const changed = structuredClone(report);
    if (changed.actual.presentation)
      changed.actual.presentation.slotId = "retired-board";
    const rejectedForeignTendrilBoard = rejectedArchive && !(await verify(changed)).passed;
    return { ...result,outcomeContract:{...result.outcomeContract,effects:{...result.outcomeContract.effects,checks:[...result.outcomeContract.effects.checks,"rejectedForeignTendrilBoard"]}}, passed: result.passed && rejectedForeignTendrilBoard,
      checks: { ...result.checks, rejectedForeignTendrilBoard } };
  }
  return { services: { ...prepared.services, tendrilBoardDocket }, verify, qualify, close: prepared.close };
}
