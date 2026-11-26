import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome=bindObservedContentReview(["discoveries","observations","readbacks","edits","candidateChecks","commits","race","independent"],[]);
import type {ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import {
  createRolloutEngine, readRepositorySource, repairReference, seedRolloutUnits,
  type Build, type Check, type Edit, type Engine, type OwnedUnit, type RolloutPhase, type RolloutPorts,
} from "./open-goal-unit-rollout-runtime.js";
import type { OpenUnitRolloutWorld } from "./open-goal-unit-rollout-worlds.js";

type Observation = { unit: View; revision: string; editablePaths: string[]; build: Build };
type View = Pick<OwnedUnit, "id" | "title" | "kind" | "mayEdit" | "mayRunChecks" | "mayCommit">;
type Apply = { status: "changed" | "applied"; revision: string };
type Commit = { status: "changed"; revision: string } | {
  status: "committed"; revision: string; verifiedRevision: string; eventId: string;
};
type Report = {
  status: OpenUnitRolloutWorld["expected"]["status"]; unitId: string | null; revision: string | null;
  check: Check | null; release: Commit | null; reason: string;
};
type Race = { stage: "apply" | "commit"; before: string; after: string; changeIds: string[]; text: string };
const revisionOf = (value: unknown) => JSON.stringify(value);
const digest = (text: string) => sha256HexSyncText(text);

export async function prepareOpenUnitRollout(
  input: { contextId: string; caseId: string; qualification?: boolean },
  world: OpenUnitRolloutWorld, ports: RolloutPorts,
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("Unit rollout does not belong to this owned context");
  const { contextId, vcs } = ports;
  const phase: RolloutPhase = async (name, run) => {
    if (!input.qualification) return run();
    const started = Date.now();
    const log = (event: "started" | "finished" | "failed") => console.info("[open-unit-rollout]", {
      caseId: input.caseId, contextId, phase: name, event, elapsedMs: Date.now() - started,
    });
    log("started");
    try {
      const result = await run();
      log("finished");
      return result;
    } catch (error) {
      log("failed");
      throw error;
    }
  };
  const before = await phase("fixture.initial-head", () => vcs.status({ contextId }));
  const units = await seedRolloutUnits(ports, world, before.workingHead, phase);
  const chosen = units.find(({ title }) => title === world.title);
  if (!chosen) throw new Error("A rollout goal has no installed target");
  const target: OwnedUnit = chosen;
  const engines = new Map<string, Engine>();
  const engine = (unit: OwnedUnit) => {
    let prepared = engines.get(unit.id);
    if (!prepared) { prepared = createRolloutEngine(ports, unit); engines.set(unit.id, prepared); }
    return prepared;
  };
  const state: { race: Race | null; commit: Extract<Commit, { status: "committed" }> | null } = { race: null, commit: null };
  const tail = () => vcs.status({ contextId });
  const baseline = await phase("fixture.baseline-head", tail);
  const baselineEngine = createRolloutEngine(ports, target);
  let seededBuild: Awaited<ReturnType<Engine["observe"]>>;
  let seededCheck: Check | null = null;
  try {
    seededBuild = await phase("initial.build", () => baselineEngine.observe());
    const initial = world.fixture.kind === "worker" ? world.fixture.initialBuild : "ok";
    if (seededBuild.revision !== revisionOf(baseline.workingHead) || seededBuild.build.status !== initial)
      throw new Error("Seeded source does not reproduce the intended native compiler state");
    const expectedCheck = world.fixture.kind === "worker" ? world.fixture.initialCheck : "failed";
    if (expectedCheck) {
      seededCheck = await phase("initial.check", () => baselineEngine.check(seededBuild.revision));
      if (seededCheck.check?.status !== expectedCheck)
        throw new Error("Seeded source does not reproduce the intended native test outcome");
    }
  } finally { await phase("initial.cleanup", async () => baselineEngine.close?.()); }
  let changing = false;
  const observations: Observation[] = [];
  const edits: { id: string; from: string; proposal: Edit[]; result: Apply }[] = [];
  const checks: { id: string; observed: Check }[] = [];
  const readbacks: { id: string; revision: string; paths: string[]; sources: Awaited<ReturnType<Engine["read"]>> }[] = [];
  const commits: { id: string; from: string; result: Commit }[] = [];
  const discoveries: View[][] = [];
  const targetEntry = (unit: OwnedUnit) => `${unit.source}/${unit.entry}`;
  function view(unit: OwnedUnit): View {
    const { id, title, kind, mayEdit, mayRunChecks, mayCommit } = unit;
    return { id, title, kind, mayEdit, mayRunChecks,
      mayCommit: mayCommit && !(unit === target && state.race && world.race?.retireGrant) };
  }
  function resolve(id: string) {
    const unit = units.find(candidate => candidate.id === id);
    if (!unit) throw new Error("Select an owned rollout unit");
    return unit;
  }
  function hasBasis(unit: OwnedUnit, revision: string) {
    return observations.some(value => value.unit.id === unit.id && value.revision === revision) ||
      edits.some(({ id, result }) => id === unit.id && result.status === "applied" && result.revision === revision);
  }
  function selected(id: string, revision: string) {
    const unit = resolve(id);
    if (changing || !hasBasis(unit, revision)) throw new Error("Use the exact observed source revision for this unit");
    return unit;
  }
  async function injectRace(unit: OwnedUnit, stage: Race["stage"]) {
    const race = world.race;
    if (unit !== target || !race || state.race || race.stage !== stage) return false;
    const head = (await tail()).workingHead;
    const file = await readRepositorySource(ports, unit, head, unit.entry);
    const text = `\n// ${race.text}\n`;
    const out = await vcs.edit({ contextId, commandId: crypto.randomUUID(), expectedWorkingHead: head,
      changes: [{ kind: "text-edit", repositoryId: unit.repositoryId, fileId: file.id,
        edits: [{ start: file.text.length, end: file.text.length, text }] }],
    });
    const actual = await readRepositorySource(ports, unit, out.workingHead, unit.entry);
    if (!out.changeIds.length || actual.text !== file.text + text)
      throw new Error("The coedit could not be bound to an actual working source change");
    state.race = { stage, before: revisionOf(head), after: revisionOf(out.workingHead), changeIds: out.changeIds, text: race.text };
    return true;
  }
  const services = {
    unitRolloutCatalog: { async discover() {
      const catalog = units.map(view);
      discoveries.push(catalog);
      return structuredClone(catalog);
    } },
    unitRolloutObserve: {
      async inspect(id: string): Promise<Observation> {
        const unit = resolve(id);
        if (changing || state.commit) throw new Error("Observe the live candidate before local commit");
        const native = await phase("candidate.observe", () => engine(unit).observe());
        const result = { unit: view(unit), editablePaths: [targetEntry(unit)], ...native };
        observations.push(result);
        return structuredClone(result);
      },
      async read(id: string, revision: string, paths: string[]) {
        const unit = selected(id, revision);
        if (paths.length !== 1 || paths[0] !== targetEntry(unit) || state.commit)
          throw new Error("Read only the exact production source selected for diagnosis");
        const sources = await engine(unit).read(revision, paths);
        readbacks.push({ id, revision, paths: [...paths], sources: structuredClone(sources) });
        return sources;
      },
    },
    unitRolloutEdit: {
      async apply(id: string, revision: string, proposal: Edit[]): Promise<Apply> {
        const unit = selected(id, revision);
        if (!view(unit).mayEdit || state.commit || proposal.length !== 1 || proposal[0]?.path !== targetEntry(unit) ||
            typeof proposal[0].after !== "string" ||
            proposal[0].after === proposal[0].before || !readbacks.some(read => read.id === id && read.revision === revision))
          throw new Error("Apply only a justified owned production edit after reading the same current source");
        changing = true;
        try {
          const coedit = await injectRace(unit, "apply");
          let result: Apply;
          try { result = { status: "applied", ...await engine(unit).apply(revision, proposal) }; }
          catch (error) {
            const current = revisionOf((await tail()).workingHead);
            if (current === revision || (!coedit && !/revision changed|source text changed|stale/iu.test(String(error)))) throw error;
            result = { status: "changed", revision: current };
          }
          if (coedit && result.status !== "changed") throw new Error("Native CAS incorrectly accepted a stale repair");
          edits.push({ id, from: revision, proposal: structuredClone(proposal), result });
          return result;
        } finally { changing = false; }
      },
    },
    unitRolloutVerify: {
      async check(id: string, revision: string) {
        const unit = selected(id, revision);
        if (!view(unit).mayRunChecks || state.commit) throw new Error("Only run the current authorized complete unit check");
        const observed = await phase("candidate.check", () => engine(unit).check(revision));
        checks.push({ id, observed });
        return structuredClone(observed);
      },
    },
    unitRolloutCommit: {
      async commit(id: string, revision: string): Promise<Commit> {
        const unit = selected(id, revision);
        if (state.commit || !view(unit).mayCommit || !checks.some(({ id: checked, observed }) => checked === id &&
          observed.revision === revision && observed.build.status === "ok" && observed.check?.status === "passed" && observed.check.receipt))
          throw new Error("Local rollout requires an explicitly granted and successfully checked exact working revision");
        changing = true;
        try {
          await injectRace(unit, "commit");
          const status = await tail();
          if (revisionOf(status.workingHead) !== revision || !view(unit).mayCommit) {
            const changed = { status: "changed" as const, revision: revisionOf(status.workingHead) };
            commits.push({ id, from: revision, result: changed });
            return changed;
          }
          const actual = await vcs.commit({ contextId, commandId: crypto.randomUUID(), expectedWorkingHead: status.workingHead,
            message: `Reviewed local rollout of ${unit.title}` });
          if (actual.contextId !== contextId || actual.event.kind !== "event" || !actual.committedApplicationIds.length)
            throw new Error("Local rollout did not retain a new owned commit event");
          const committed = { status: "committed" as const, verifiedRevision: revision, revision: revisionOf(actual.event), eventId: actual.event.eventId };
          commits.push({ id, from: revision, result: committed });
          state.commit = committed;
          return committed;
        } finally { changing = false; }
      },
    },
  };

  
  async function verify(value: unknown,invocation?: InvocationObservations,negatives?: { foreign: boolean; protectedPolicy: boolean }) {
    const proof=await verifyNativeApplication(value,invocation,negatives);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["matchedRolloutOutcome"],"rootPath":["reason"],"producerSourceSuffix":"repairWorkspaceUnit/decideNext.nl","producerPath":["reason"]}];
    const contributions=authored.filter(binding=>{
      let current:unknown=value;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,value,invocation,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(value: unknown, invocation?: InvocationObservations, negatives?: { foreign: boolean; protectedPolicy: boolean }) {
    const envelope = value as Report | null;
    const report = envelope;
    const current = await tail();
    const finalRevision = revisionOf(current.workingHead);
    const independent = createRolloutEngine(ports, target);
    let finalObservation: Awaited<ReturnType<Engine["observe"]>>;
    let verified: Check | null = null;
    try {
      finalObservation = await phase("independent.build", () => independent.observe());
      if (world.expected.check) verified = await phase("independent.check", () => independent.check(finalRevision));
    } finally { await phase("independent.cleanup", async () => independent.close?.()); }
    const source = await readRepositorySource(ports, target, current.workingHead, target.entry);
    const protectedChecks = await Promise.all(units.flatMap(unit => Object.entries(unit.files)
      .filter(([path]) => unit !== target || path !== unit.entry)
      .map(async ([path, original]) => ({ unit: unit.id, path, matches: (await readRepositorySource(ports, unit, current.workingHead, path)).text === original }))));
    const declaredCount = world.fixture.kind === "worker" ? world.fixture.assertions.length + 1 : 5;
    const counted = world.expected.check ? verified?.check && verified.check.status === world.expected.check &&
      verified.check.count === declaredCount && verified.check.runtime === (target.kind === "worker" ? "workerd" : "browser") &&
      typeof verified.check.receipt === "string" && Boolean(verified.check.receipt) : verified === null;
    const activeCheck = world.expected.check ? checks.find(({ id, observed }) => id === target.id &&
      observed.revision === (state.commit?.verifiedRevision ?? finalRevision))?.observed : null;
    const reason = typeof report?.reason === "string" ? report.reason.toLowerCase() : null;
    const repaired = edits.some(({ id, result }) => id === target.id && result.status === "applied");
    const actualCommit = current.committed.kind === "event" ? current.committed.eventId : null;
    const raceOk = world.race ? Boolean(state.race && source.text.includes(`// ${world.race.text}`) &&
      state.race.after !== state.race.before) : state.race === null;
    const acceptance = {
      discoveredExactRolloutUnit: observations.some(({ unit }) => unit.id === target.id),
      attestedInitialNativeState: observations.some(observation => observation.revision === seededBuild.revision &&
        observation.build.status === seededBuild.build.status && observation.build.stateHash === seededBuild.build.stateHash),
      exactObservedRepair: repaired === world.expected.repair && (world.expected.repair ? source.text !== target.files[target.entry]
        : source.text === target.files[target.entry]),
      preservedFixturePolicy: protectedChecks.every(item => item.matches) && before.mainEventId === current.mainEventId,
      preservedConcurrentRolloutEdit: raceOk,
      independentNativeRolloutCheck: Boolean(counted && finalObservation.revision === finalRevision &&
        (world.expected.check ? activeCheck?.check?.status === world.expected.check && activeCheck.build.stateHash === finalObservation.build.stateHash
          : checks.length === 0)),
      exactLocalRolloutEvent: world.expected.release ? Boolean(state.commit && actualCommit === state.commit.eventId && current.clean) : state.commit === null && isDeepStrictEqual(current.committed, baseline.committed),
      matchedRolloutOutcome: isDeepStrictEqual(report?.release,state.commit)&&report?.unitId === target.id &&
        report.revision === finalRevision &&
        (report.status === "held" || report.status === "committed" && state.commit !== null ||
          report.status === "repaired" && repaired && finalObservation.build.status === "ok" ||
          report.status === "verified" && verified?.check?.status === "passed") &&
        Boolean(reason?.trim()),
      ...(negatives ? { rejectedForeignRolloutUnit: negatives.foreign, rejectedProtectedSourceEdit: negatives.protectedPolicy } : {}),
    };
    return {
      outcomeContract:{effects:{checks:[...["discoveredExactRolloutUnit", "attestedInitialNativeState", "exactObservedRepair", "preservedFixturePolicy", "preservedConcurrentRolloutEdit", "independentNativeRolloutCheck", "exactLocalRolloutEvent"],...(negatives?["rejectedForeignRolloutUnit", "rejectedProtectedSourceEdit"]:[])],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["matchedRolloutOutcome"],required:world.requestedReturnRequired,rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],

      contextId, caseId: input.caseId, goal: world.goal, checks: acceptance, passed: Object.values(acceptance).every(Boolean),
      discoveries, observations, readbacks, edits, candidateChecks: checks, commits, race: state.race,
      independent: { build: finalObservation, check: verified, initial: seededBuild, initialCheck: seededCheck, protectedChecks,
        main: current.mainEventId, sourceDigest: digest(source.text) },
    };
  }

  async function close() {
    const settled = await Promise.allSettled([...engines.values()].map(port => port.close?.()));
    const errors = settled.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "Owned rollout renderer cleanup failed");
  }
  return {
    goal: world.goal, services, verify, close,
    async qualify() {
      await services.unitRolloutCatalog.discover();
      let foreign = false, protectedPolicy = false;
      try { await services.unitRolloutObserve.inspect(crypto.randomUUID()); } catch { foreign = true; }
      const id = target.id;
      let observed = await services.unitRolloutObserve.inspect(id);
      let result: Check | null = null;
      try { await services.unitRolloutEdit.apply(id, observed.revision, [{ path: `${target.source}/package.json`, before: "", after: "ignored" }]); }
      catch { protectedPolicy = true; }
      // The independent seed check attests the initial failure. The reference only needs
      // a candidate receipt before editing when the original suite outcome is the goal.
      if (seededCheck && target.mayRunChecks && !world.expected.repair)
        result = await services.unitRolloutVerify.check(id, observed.revision);
      if (world.expected.repair) {
        const replacement = repairReference(world);
        if (replacement === null) throw new Error("Repair reference source is unavailable");
        for (let attempt = 0; attempt < 2; attempt++) {
          const [source] = await services.unitRolloutObserve.read(id, observed.revision, observed.editablePaths);
          if (!source) throw new Error("Reference repair could not read the production source");
          const content = state.race ? `${replacement}\n// ${state.race.text}\n` : replacement;
          const applied = await phase("candidate.apply", () => services.unitRolloutEdit.apply(id, observed.revision,
            [{ path: source.path, before: source.text, after: content }]));
          if (applied.status === "changed") { observed = await services.unitRolloutObserve.inspect(id); continue; }
          result = await services.unitRolloutVerify.check(id, applied.revision);
          break;
        }
      }
      let release: Extract<Commit, { status: "committed" }> | null = null;
      if (target.mayCommit && result?.check?.status === "passed") {
        const verifiedRevision = result.revision;
        const first = await phase("candidate.commit", () => services.unitRolloutCommit.commit(id, verifiedRevision));
        if (first.status === "committed") release = first;
        else {
          observed = await services.unitRolloutObserve.inspect(id);
          result = await services.unitRolloutVerify.check(id, observed.revision);
          if (observed.unit.mayCommit) {
            const second = await services.unitRolloutCommit.commit(id, observed.revision);
            if (second.status === "committed") release = second;
          }
        }
      }
      const reason = (world.expected.mentions ?? []).map(([word]) => word).join("; ") || "The exact current unit report is retained";
      return verify({
        status: world.expected.status, unitId: id, revision: revisionOf((await tail()).workingHead), release, reason,
      }, undefined, { foreign, protectedPolicy });
    },
  };
}
