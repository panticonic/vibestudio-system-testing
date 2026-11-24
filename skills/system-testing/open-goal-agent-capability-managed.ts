import {assessObservedApplicationOutcome,type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import {
  AGENTIC_PROTOCOL_VERSION, GENESIS_EVENT_HASH, agentToolFailureFromUnknown, computeEventHash,
  createInitialTrajectoryState, invocationCancelledPayload, invocationCompletedPayload, invocationFailedPayload,
  reduceTrajectory, trajectoryEventSchema,
  type AgenticEvent, type BranchId, type InvocationId, type TurnId,
} from "@workspace/agentic-protocol";
import { createMainRpcCaller } from "@vibestudio/service-schemas/mainRpc";
import { contextId, rpc, vcs } from "@workspace/runtime";
import { bindAgentCapabilityEval, consoleDigest, type RetainedRun } from "./open-goal-agent-capability-native.js";
import type { AgentCapabilityWorld as World } from "./open-goal-agent-capability-worlds.js";

type Native = ReturnType<typeof bindAgentCapabilityEval>;
type Card = { id: string; notebook: string; revision: string; title: string };
type RecordState = { revision: string; saved: boolean; ready: boolean; value: string };
type Grant = "continue" | "retry" | "read-only" | "withdrawn";
type Decision = "hold-ownership" | "hold-revision" | "inspect-only" | "recover-native-evidence" |
  "recover-existing-value" | "report-no-effect" | "hold-cancellation" | "hold-prerequisite" |
  "confirm-continuation" | "retry-exact-step";
type Assignment = { notebook: string; title: string; revision: string; goal: string; task: World["task"];
  approval: { notebook: string; revision: string; mode: Grant }; attempts: Card[] };
type Continuation = { kind: "confirmed-existing" | "retried-step"; original: string; runId: string;
  runDigest: string; resultDigest: string; valueDigest: string; revision: string };
type Step = { card: Card; native: RetainedRun; mode: World["mode"] };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
type Ports = { contextId: string; vcs: Pick<typeof vcs, "status">; native: Native };
const hash = sha256HexSyncText;
const notebookKey = "capabilityRecord";
const unrelated = ["retainedOwnerNote", "retainedWindow", "neighborPlan"].sort();
const scopeRecord = (value: RecordState) => `scope.${notebookKey} = ${JSON.stringify(JSON.stringify(value))};`;
const generated = ["latestRoute", "latestCount", "latestLabel"].sort();
const longOutput = "A".repeat(4095) + "🖨" + "Records unité » ".repeat(708) + "final approved entry";

function seed(revision: string, title: string, ready = false): RecordState {
  return { revision, saved: false, ready, value: title + " pending" };
}
function readyValue(value: RecordState, title: string): RecordState {
  return { ...value, saved: true, value: title + " retained at " + value.revision };
}
function codeFor(mode: World["mode"], basis: RecordState, title: string) {
  const marker = JSON.stringify(title + " progress observed");
  const save = scopeRecord(readyValue(basis, title));
  const fail = `throw new Error("The owned action stopped at its recorded checkpoint");`;
  switch (mode) {
    case "failed-empty": return `console.warn(${marker});\n${fail}`;
    case "failed-after-save": return `${save}\nconsole.warn(${marker});\n${fail}`;
    case "empty-console": return fail;
    case "retry-gate":
      return `const current = JSON.parse(scope.${notebookKey});\nif (current.revision !== ${JSON.stringify(basis.revision)} || !current.ready) { console.warn(${marker}); ${fail} }\n${scopeRecord(readyValue({ ...basis, ready: true }, title))}\nreturn { saved: true };`;
    case "large-output":
      return `scope.ownedLargeResult = ${JSON.stringify(longOutput)};\n${save}\nreturn scope.ownedLargeResult;`;
    case "large-console":
      return `console.log(${JSON.stringify(title + " first console checkpoint")});\nconsole.info("C".repeat(14000));\nconsole.warn(${JSON.stringify(title + " last console checkpoint")});\n${save}\nreturn { saved: true };`;
    case "scope-values":
      return `scope.latestRoute = "owned desk"; scope.latestCount = "3"; scope.latestLabel = ${JSON.stringify(title)};\n${save}\nreturn { saved: true };`;
    default: return `console.log(${marker});\n${save}\nreturn { saved: true };`;
  }
}
function readRecord(text: string): RecordState {
  const value = JSON.parse(text) as RecordState;
  if (typeof value.revision !== "string" || typeof value.saved !== "boolean" ||
      typeof value.ready !== "boolean" || typeof value.value !== "string")
    throw new Error("Invalid retained owned notebook revision");
  return value;
}

export async function replayAgentCapabilityEvidence(run: RetainedRun, completeEvents: boolean, admitted: boolean) {
  const result = run.receipt.result;
  const cancelled = result.failureKind === "cancelled";
  const invocationId = ("action:" + run.runId) as InvocationId;
  const failure = result.success ? null : agentToolFailureFromUnknown({ ...result.error, failureCode: result.failureCode }, {
    operation: "eval", stage: "settle", ...(cancelled ? { kind: "cancelled" as const } : {}),
    causal: { invocationId, receiptDigest: run.receipt.resultDigest },
  });
  // Project only exact observed native facts. This is a private interpretation
  // of the admitted action, not a new chat, published event or agent turn.
  const common = { actor: { kind: "system" as const, id: "owned-native-eval" }, causality: { invocationId },
    turnId: ("turn:" + run.runId) as TurnId, createdAt: "2026-11-20T00:00:00.000Z" };
  const observed: AgenticEvent[] = [];
  if (admitted) observed.push({ ...common, kind: "invocation.started",
    payload: { protocol: AGENTIC_PROTOCOL_VERSION, name: "eval",
      request: { runId: run.runId, runDigest: run.receipt.runDigest } } });
  if (completeEvents) {
    if (cancelled) observed.push({ ...common, kind: "invocation.cancelled", payload: invocationCancelledPayload("cancelled", "Native action cancelled") });
    else if (failure) observed.push({ ...common, kind: "invocation.failed",
      payload: invocationFailedPayload(result.failureKind === "infrastructure" ? "infrastructure_error" : "tool_error", failure.message,
        { failure, terminalReasonCode: failure.code }) });
    else observed.push({ ...common, kind: "invocation.completed",
      payload: invocationCompletedPayload({ result: { resultDigest: run.receipt.resultDigest } }) });
  }
  let state = createInitialTrajectoryState();
  let previous = GENESIS_EVENT_HASH;
  const branchId = "native-action-readback" as BranchId;
  for (const [seq, event] of observed.entries()) {
    const eventHash = await computeEventHash({ branchId, prevEventHash: previous, seq, event });
    state = reduceTrajectory(state, trajectoryEventSchema.parse({ ...event, eventId: run.runId + ":" + seq, trajectoryId: run.runId,
      branchId, seq, prevEventHash: previous, eventHash }));
    previous = eventHash;
  }
  return { failure: failure ? { code: failure.code, kind: failure.kind, retry: failure.retry.policy } : null,
    invocationStatus: state.invocations[invocationId]?.status ?? "unestablished" };
}

export async function prepareAgentCapability(input: { contextId: string; caseId: string }, world: World, ports: Ports = {
  contextId, vcs, native: bindAgentCapabilityEval(createMainRpcCaller(rpc)),
}) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) throw new Error("The retained action does not belong to this agent workspace");
  const { native } = ports;
  const initial = await ports.vcs.status({ contextId: ports.contextId });
  const notebook = "notebook-" + crypto.randomUUID(), foreign = "notebook-" + crypto.randomUUID();
  const currentRevision = "revised-draft", formerRevision = "earlier-draft";
  const currentScope = native.allocateScope(), priorScope = native.allocateScope(), foreignScope = native.allocateScope();
  async function step(scope: string, owner: string, revision: string, mode: World["mode"]) {
    const value = seed(revision, world.title);
    const setup = unrelated.map((key, index) => `scope[${JSON.stringify(key)}] = ${JSON.stringify(key + "-" + owner + "-" + index)};`).join("\n");
    const initialized = await native.run(scope, scopeRecord(value) + "\n" + setup);
    if (!initialized.receipt.result.success) throw new Error("Could not establish the owned notebook edition");
    const run = await native.run(scope, codeFor(mode, value, world.title), mode === "cancelled");
    if (run.receipt.result.success === ["failed-empty", "failed-after-save", "empty-console", "retry-gate", "cancelled"].includes(mode))
      throw new Error("The owned native eval failed to reproduce its authored capability state");
    return { card: { id: crypto.randomUUID(), notebook: owner, revision, title: world.title }, native: run, mode };
  }
  async function cleanup(error: unknown): Promise<never> {
    try { await native.close(); }
    catch (cleanupFailure) { throw new AggregateError([error, cleanupFailure], "Native capability seed and finite notebook cleanup failed"); }
    throw error;
  }
  let current: Step, prior: Step, other: Step;
  try {
    prior = await step(priorScope, notebook, formerRevision, world.priorMode);
    current = await step(currentScope, notebook, currentRevision, world.mode);
    other = await step(foreignScope, foreign, currentRevision, "returned");
    if (world.amended || world.mode === "retry-gate" && !world.unready) {
      const value = readRecord(await native.text(currentScope, notebookKey));
      const next = world.amended ? seed("later-unreviewed-edition", world.title) : { ...value, ready: true };
      if (!(await native.run(currentScope, scopeRecord(next))).receipt.result.success) throw new Error("Could not materialize the owned review's current scope");
    }
  } catch (error) {
    return cleanup(error);
  }

  const steps = [current, prior, other].sort((a, b) => a.card.id.localeCompare(b.card.id));
  const grant: Grant = world.approval === "read-only" || world.approval === "withdrawn" ? world.approval : world.task === "audit" ? "read-only" : world.task;
  const assignment: Assignment = { notebook, title: world.title, revision: currentRevision, goal: world.goal, task: world.task,
    approval: { notebook: world.approval === "other-notebook" ? foreign : notebook,
      revision: world.approval === "older-revision" ? formerRevision : currentRevision, mode: grant },
    attempts: steps.map(row => row.card) };

  async function scopeBytes(step: Step) {
    const named = [...unrelated, ...(step.mode === "scope-values" ? generated : []),
      ...(step.mode === "large-output" ? ["ownedLargeResult"] : []), notebookKey];
    return Object.fromEntries(await Promise.all(named.map(async key => [key, await native.text(step.native.scopeKey, key)])));
  }
  const originalValues = await Promise.all([current, prior, other].map(scopeBytes)).catch(cleanup);
  async function inspect(step: Step) {
    const receipt = await native.observe(step.native);
    if (!isDeepStrictEqual(receipt, step.native.receipt)) throw new Error("The immutable native action receipt changed");
    const page = await native.events(step.native);
    const states = page.events.filter(event => event.kind === "state").map(event => (event.payload as { status?: string } | null)?.status);
    const admitted = states.includes("accepted");
    const cancelled = receipt.result.failureKind === "cancelled";
    const terminal = cancelled ? "cancelled" : receipt.result.success ? "returned" : "failed";
    const completeEvents = page.complete && (cancelled ? states.includes("cancelled-before-admission") && !admitted :
      admitted && states.includes("running") && states.includes(receipt.result.success ? "succeeded" : "failed"));
    const settled = await replayAgentCapabilityEvidence(step.native, completeEvents, admitted);
    const chunks = page.events.filter(event => event.kind === "console").map(event => (event.payload as { text?: string } | null)?.text ?? "");
    const console = { ...consoleDigest(receipt.result.console),
      complete: completeEvents && (chunks.join("") === receipt.result.console ||
        receipt.result.console.length > 12000 && chunks.some(chunk => chunk.includes("$lastLargeConsole"))) };
    const values = await scopeBytes(step);
    const value = readRecord(values[notebookKey]!);
    const saved = value.saved && value.revision === step.card.revision &&
      value.value === readyValue(value, step.card.title).value;
    const valueEvidence = step.mode === "large-output" ? values.ownedLargeResult! : values[notebookKey]!;
    if (step.mode === "large-output" && valueEvidence !== longOutput) throw new Error("The large return readback does not match the exact notebook result");
    return { attempt: step.card, runId: step.native.runId, runDigest: receipt.runDigest, resultDigest: receipt.resultDigest, terminal,
      admitted, completeEvents, lastSequence: page.events.at(-1)?.sequence ?? 0, ...settled, console,
      notebook: { revision: value.revision, saved, ready: value.ready, settledDigest: hash(valueEvidence),
        siblingKeys: [...unrelated, ...(step.mode === "scope-values" ? generated : [])].sort() },
      exactRetry: step.mode === "retry-gate" && admitted && terminal === "failed" && !saved };
  }

  type Evidence = Awaited<ReturnType<typeof inspect>>;
  type Outcome = { assignment: Assignment; evidence: { current: Evidence; prior: Evidence };
    finding: { decision: Decision; reason: string }; continuation: Continuation | null };
  function decisionFor(evidence: Evidence): Decision {
    if (assignment.approval.notebook !== evidence.attempt.notebook) return "hold-ownership";
    if (assignment.approval.revision !== evidence.attempt.revision || evidence.notebook.revision !== evidence.attempt.revision) return "hold-revision";
    if (!evidence.completeEvents) return "recover-native-evidence";
    if (assignment.task === "audit") return evidence.notebook.saved ? "recover-existing-value" :
      evidence.terminal === "cancelled" ? "hold-cancellation" : "report-no-effect";
    if (assignment.approval.mode !== assignment.task) return "inspect-only";
    if (evidence.terminal === "cancelled") return "hold-cancellation";
    if (evidence.notebook.saved) return assignment.task === "continue" ? "confirm-continuation" : "recover-existing-value";
    if (!evidence.exactRetry || assignment.task !== "retry") return "report-no-effect";
    return evidence.notebook.ready ? "retry-exact-step" : "hold-prerequisite";
  }
  let discovered = false;
  const viewed = new Map<string, Evidence>();
  const effects: Effect[] = [];
  let continued: { native: RetainedRun; receipt: Continuation; decision: Decision } | null = null;
  let applying = false;
  const capture = <T>(service: string, method: string, args: unknown[], result: T): T => {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };
  const services = {
    agentCapabilityEvidence: {
      async discover() {
        if (discovered) return structuredClone(assignment);
        discovered = true;
        return capture("agentCapabilityEvidence", "discover", [], assignment);
      },
      async inspect(id: string) {
        const step = steps.find(candidate => candidate.card.id === id);
        if (!step) throw new Error("Use only an owned notebook attempt");
        if (viewed.has(id)) return structuredClone(viewed.get(id)!);
        const evidence = await inspect(step);
        viewed.set(id, evidence);
        return capture("agentCapabilityEvidence", "inspect", [id], evidence);
      },
    },
    agentCapabilityContinue: {
      async apply(id: string, resultDigest: string, revision: string, decision: Decision) {
        if (applying || continued) throw new Error("Only one owned continuation may be attempted");
        applying = true;
        try {
          const previouslyObserved = viewed.get(id);
          const exact = id === current.card.id && previouslyObserved && viewed.has(prior.card.id) &&
            previouslyObserved.resultDigest === resultDigest && previouslyObserved.notebook.revision === revision;
          if (!exact || !["confirm-continuation", "retry-exact-step"].includes(decision))
            throw new Error("Continue only from the approved and previously observed native action");
          const fresh = await inspect(current);
          if (!isDeepStrictEqual(fresh, previouslyObserved) || decisionFor(fresh) !== decision)
            return capture("agentCapabilityContinue", "apply", [id, resultDigest, revision, decision], null);
          const code = decision === "retry-exact-step" ? current.native.code :
            `const retained = JSON.parse(scope.${notebookKey});\nreturn { revision: retained.revision, saved: retained.saved };`;
          const resumed = await native.run(currentScope, code);
          if (!resumed.receipt.result.success) throw new Error("The authorized local continuation did not settle successfully");
          const after = await inspect(current);
          const receipt: Continuation = {
            kind: decision === "retry-exact-step" ? "retried-step" : "confirmed-existing", original: current.native.runId, runId: resumed.runId,
            runDigest: resumed.receipt.runDigest, resultDigest: resumed.receipt.resultDigest, valueDigest: after.notebook.settledDigest,
            revision: after.notebook.revision,
          };
          continued = { native: resumed, receipt, decision };
          return capture("agentCapabilityContinue", "apply", [id, resultDigest, revision, decision], receipt);
        } finally {
          applying = false;
        }
      },
    },
  };

  
  async function verify(input: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(input,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["respectedRecoveryDecision"],"rootPath":["finding"],"producerSourceSuffix":"recoverAgentCapability/decideContinuation.nl","producerPath":[]}];
    const contributions=authored.filter(binding=>{
      let current:unknown=input;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,input,invocation,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(input: unknown, invocation?: InvocationObservations) {
    const report = input as Outcome | null;
    const outcome = report;
    const observed = viewed.get(current.card.id);
    const earlier = await inspect(prior);
    const currentView = await inspect(current);
    const after = await Promise.all([current, prior, other].map(scopeBytes));
    const head = await ports.vcs.status({ contextId: ports.contextId });
    const decision = observed && decisionFor(observed);
    const mayContinue = decision === "confirm-continuation" || decision === "retry-exact-step";
    const keys = Object.keys(originalValues[0]!).filter(key => key !== notebookKey);
    let exactEffect = !mayContinue && continued === null && isDeepStrictEqual(after[0], originalValues[0]);
    if (mayContinue && continued) {
      const receipt = await native.observe(continued.native);
      const expected = decision === "retry-exact-step"
        ? JSON.stringify(readyValue(readRecord(originalValues[0]![notebookKey]!), world.title))
        : originalValues[0]![notebookKey]!;
      exactEffect = after[0]![notebookKey] === expected && continued.receipt.runId !== current.native.runId &&
        continued.receipt.original === current.native.runId && continued.receipt.runDigest === receipt.runDigest &&
        continued.receipt.resultDigest === receipt.resultDigest && continued.receipt.valueDigest === currentView.notebook.settledDigest &&
        continued.receipt.revision === currentView.notebook.revision && receipt.result.success &&
        (decision === "retry-exact-step" ? continued.native.code === current.native.code :
          isDeepStrictEqual(receipt.result.returnValue, { revision: currentView.notebook.revision, saved: true }));
    }
    const checks = {
      selectedExactOwnedAttempts: viewed.size === 2 && !!observed && viewed.has(prior.card.id)&&isDeepStrictEqual(viewed.get(current.card.id),observed),
      verifiedNativeAdmissionAndFailure: observed?.runDigest === currentView.runDigest && observed?.resultDigest === currentView.resultDigest &&
        observed?.completeEvents === currentView.completeEvents && observed?.invocationStatus === currentView.invocationStatus &&
        isDeepStrictEqual(viewed.get(prior.card.id), earlier),
      verifiedConsoleAndNotebookEvidence: isDeepStrictEqual(observed?.console, currentView.console) &&
        observed?.notebook.revision === readRecord(originalValues[0]![notebookKey]!).revision &&
        observed?.notebook.settledDigest === hash(originalValues[0]![current.mode === "large-output" ? "ownedLargeResult" : notebookKey]!),
      respectedRecoveryDecision: isDeepStrictEqual(outcome?.continuation,continued?.receipt??null)&&outcome?.finding?.decision === decision && typeof outcome.finding.reason === "string" &&
        outcome.finding.reason.trim().length > 0 && outcome.finding.reason.length <= 1200,
      verifiedExactContinuation: exactEffect &&
        effects.filter(effect => effect.service === "agentCapabilityContinue").length === (mayContinue ? 1 : 0),
      preservedOtherState: keys.every(key => after[0]![key] === originalValues[0]![key]) && isDeepStrictEqual(after.slice(1), originalValues.slice(1)) &&
        initial.mainEventId === head.mainEventId && isDeepStrictEqual(initial.workingHead, head.workingHead),
    };
    return {
      outcomeContract:{
        effects:{checks:["selectedExactOwnedAttempts", "verifiedNativeAdmissionAndFailure", "verifiedConsoleAndNotebookEvidence", "verifiedExactContinuation", "preservedOtherState"],rationale:"Native observations, captured writes, persisted bytes and protected state establish these facts independently of the public result."},
        returnedValue:{checks:["respectedRecoveryDecision"],required:!mayContinue,rationale:"The requested analysis is application data; a redundant result copy is optional once the requested native artifact or operation exists."},
        incidentalValues:{checks:[],rationale:"Known incorrect emitted application values are masked using their actual invocation definition."}},
      incorrectReturnValues:[],
 caseId: world.id, contextId: ports.contextId, goal: world.goal, passed: Object.values(checks).every(Boolean), checks,
      effects: structuredClone(effects), assignment, evidence: { current: observed, prior: earlier }, decision, continuation: continued?.receipt ?? null };
  }
  async function qualify() {
    const assignment = await services.agentCapabilityEvidence.discover();
    const a = await services.agentCapabilityEvidence.inspect(current.card.id);
    const b = await services.agentCapabilityEvidence.inspect(prior.card.id);
    const decision = decisionFor(a);
    const continuation = decision === "confirm-continuation" || decision === "retry-exact-step"
      ? await services.agentCapabilityContinue.apply(a.attempt.id, a.resultDigest, a.notebook.revision, decision) : null;
    const result = {finding:{decision,reason:"Use the exact admitted action and current durable notebook evidence."},continuation};
    const proof = await verify(result);
    const rejectedInventedApplicationValue = !(await verify({...result,finding:{decision:"invented",reason:"invented"}})).outcomeDimensions.returnedValue.passed;
    const checks = {...proof.checks,rejectedInventedApplicationValue};
    return {...proof,checks,passed:Object.values(checks).every(Boolean),result,
      outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,
        checks:[...proof.outcomeContract.effects.checks,"rejectedInventedApplicationValue"]}}};
  }
  return { services, verify, qualify, close: native.close };
}
