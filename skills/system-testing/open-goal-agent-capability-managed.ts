import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome = bindObservedContentReview(["effects", "assignment", "evidence", "decision", "continuation", "notebookState", "retainedValueReads"],[],{nonAuthoritativeKeys:["decision"]});
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
type RetainedValue = import("@workspace-skills/open-user-goal/recoverAgentCapability/contract").RetainedNotebookValue;
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
  const retainedValueReads: {id:string;resultDigest:string;revision:string;returned:boolean;values:RetainedValue[]|null;refusal?:string}[] = [];
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
        const evidence = await inspect(step);
        // Preserve the original observed action basis for mutation verification,
        // while returning truthful fresh scope observations on later reads.
        if (!viewed.has(id)) viewed.set(id, evidence);
        return capture("agentCapabilityEvidence", "inspect", [id], evidence);
      },
      async readRetainedValues(id:string,resultDigest:string,revision:string):Promise<RetainedValue[]|null> {
        const step=steps.find(candidate=>candidate.card.id===id);
        const observed=viewed.get(id);
        if(!step||step.card.notebook!==assignment.notebook||!observed){
          retainedValueReads.push({id,resultDigest,revision,returned:false,values:null,refusal:"foreign-or-uninspected-action"});
          throw new Error("Inspect the exact owned notebook action before reading its retained values");
        }
        const record=(values:RetainedValue[]|null)=>{
          retainedValueReads.push(structuredClone({id,resultDigest,revision,returned:true,values}));
          return capture("agentCapabilityEvidence","readRetainedValues",[id,resultDigest,revision],values);
        };
        if(observed.resultDigest!==resultDigest||step.card.revision!==revision)return record(null);
        const fresh=await inspect(step);
        if(fresh.resultDigest!==resultDigest||fresh.notebook.revision!==revision)return record(null);
        // Only this action's published value keys are admitted. Protected
        // neighboring scope keys and the opaque scope capability stay private.
        const keys=[notebookKey,...(step.mode==="large-output"?["ownedLargeResult"]:[]),...(step.mode==="scope-values"?generated:[])];
        const afterContinuation=step===current?continued?.receipt.runId??null:null;
        const values=await Promise.all(keys.map(async key=>{
          const content=await native.text(step.native.scopeKey,key);
          return {attempt:structuredClone(step.card),runId:step.native.runId,revision,key,content,digest:hash(content),
            observedAfterContinuation:afterContinuation};
        }));
        // Reject a value read spanning a revision/action change instead of
        // silently rebasing its caller's original inspected authority.
        if(!isDeepStrictEqual(fresh,await inspect(step))||(step===current?continued?.receipt.runId??null:null)!==afterContinuation)return record(null);
        const primary=values.find(value=>value.key===(step.mode==="large-output"?"ownedLargeResult":notebookKey));
        if(!primary||primary.digest!==fresh.notebook.settledDigest)throw new Error("Retained value bytes differ from the inspected native notebook digest");
        return record(values);
      },
    },
    agentCapabilityContinue: {
      async apply(id: string, resultDigest: string, revision: string, decision: Decision) {
        if (applying || continued) throw new Error("Only one owned continuation may be attempted");
        applying = true;
        try {
          const previouslyObserved = viewed.get(id);
          const exact = id === current.card.id && previouslyObserved &&
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
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,input,invocation,[]);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(input: unknown, invocation?: InvocationObservations) {
    const report = input as {explanation?:unknown;continuation?:unknown;retainedValues?:unknown} | null;
    const outcome = report;
    const observed = viewed.get(current.card.id);
    const earlier = await inspect(prior);
    const currentView = await inspect(current);
    const after = await Promise.all([current, prior, other].map(scopeBytes));
    const head = await ports.vcs.status({ contextId: ports.contextId });
    const decision = observed && decisionFor(observed);
    const mayContinue = decision === "confirm-continuation" || decision === "retry-exact-step";
    const keys = Object.keys(originalValues[0]!).filter(key => key !== notebookKey);
    let exactEffect = continued === null && isDeepStrictEqual(after[0], originalValues[0]);
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
      selectedExactOwnedAttempts: !!observed&&isDeepStrictEqual(observed.attempt,current.card),
      verifiedNativeAdmissionAndFailure: observed?.runDigest === currentView.runDigest && observed?.resultDigest === currentView.resultDigest &&
        observed?.completeEvents === currentView.completeEvents && observed?.invocationStatus === currentView.invocationStatus &&
        (!viewed.has(prior.card.id)||isDeepStrictEqual(viewed.get(prior.card.id), earlier)),
      verifiedConsoleAndNotebookEvidence: isDeepStrictEqual(observed?.console, currentView.console) &&
        observed?.notebook.revision === readRecord(originalValues[0]![notebookKey]!).revision &&
        observed?.notebook.settledDigest === hash(originalValues[0]![current.mode === "large-output" ? "ownedLargeResult" : notebookKey]!),
      respectedRecoveryDecision: typeof outcome?.explanation==="string"&&!!outcome.explanation.trim(),
      authenticReturnedContinuation:outcome?.continuation===null||outcome?.continuation===undefined||isDeepStrictEqual(outcome.continuation,continued?.receipt??null),
      authenticReturnedValues:outcome?.retainedValues===undefined||Array.isArray(outcome.retainedValues)&&outcome.retainedValues.every(value=>
        retainedValueReads.some(read=>read.values?.some(actual=>isDeepStrictEqual(value,actual)))),
      verifiedRetainedValueReads:retainedValueReads.every(read=>read.values===null||read.values.every(value=>{
        const index=[current,prior,other].findIndex(step=>step.card.id===read.id);
        if(index<0||[current,prior,other][index]!.card.notebook!==assignment.notebook||value.digest!==hash(value.content)||
          value.revision!==read.revision||value.runId!==[current,prior,other][index]!.native.runId)return false;
        return value.observedAfterContinuation===null?value.content===originalValues[index]![value.key]:
          index===0&&value.observedAfterContinuation===continued?.receipt.runId&&value.content===after[index]![value.key];
      })),
      verifiedExactContinuation: exactEffect&&(!continued||mayContinue),
      preservedOtherState: keys.every(key => after[0]![key] === originalValues[0]![key]) && isDeepStrictEqual(after.slice(1), originalValues.slice(1)) &&
        initial.mainEventId === head.mainEventId && isDeepStrictEqual(initial.workingHead, head.workingHead),
    };
    return {
      outcomeContract:{
        effects:{checks:["selectedExactOwnedAttempts", "verifiedNativeAdmissionAndFailure", "verifiedConsoleAndNotebookEvidence", "verifiedRetainedValueReads", "verifiedExactContinuation", "preservedOtherState"],rationale:"Native observations, captured writes, persisted bytes and protected state establish these facts independently of the public result."},
        returnedValue:{checks:["respectedRecoveryDecision"],required:world.requestedReturnRequired,rationale:"The requested analysis is application data; a redundant result copy is optional once the requested native artifact or operation exists."},
        incidentalValues:{checks:["authenticReturnedContinuation","authenticReturnedValues"],rationale:"Known incorrect emitted application values are masked using their actual invocation definition."}},
      incorrectReturnValues:[],
 caseId: world.id, contextId: ports.contextId, goal: world.goal, passed: Object.values(checks).every(Boolean), checks,
      effects: structuredClone(effects), assignment, evidence: { current: observed, prior: earlier }, decision, continuation: continued?.receipt ?? null, retainedValueReads:structuredClone(retainedValueReads), notebookState:{before:readRecord(originalValues[0]![notebookKey]!),after:readRecord(after[0]![notebookKey]!),currentAction:currentView} };
  }
  async function qualify() {
    const assignment = await services.agentCapabilityEvidence.discover();
    const a = await services.agentCapabilityEvidence.inspect(current.card.id);
    const b = await services.agentCapabilityEvidence.inspect(prior.card.id);
    // Exercise the SAME admitted read port as the teacher. Hidden verifier
    // scopeBytes must not stand in for an unavailable application capability.
    const retainedValues=await services.agentCapabilityEvidence.readRetainedValues(a.attempt.id,a.resultDigest,a.notebook.revision);
    const decision = decisionFor(a);
    const continuation = decision === "confirm-continuation" || decision === "retry-exact-step"
      ? await services.agentCapabilityContinue.apply(a.attempt.id, a.resultDigest, a.notebook.revision, decision) : null;
    const result = {explanation:"Use the exact admitted action and current durable notebook evidence.",continuation,...(retainedValues===null?{}:{retainedValues})};
    const proof = await verify(result);
    const rejectedInventedApplicationValue = !(await verify({...result,explanation:""})).outcomeDimensions.returnedValue.passed;
    const referenceRetainedValueAdmission=a.notebook.revision===a.attempt.revision?retainedValues!==null&&retainedValues.length>0:retainedValues===null;
    const checks = {...proof.checks,rejectedInventedApplicationValue,referenceRetainedValueAdmission};
    return assessNativeQualification({...proof,checks,passed:Object.values(checks).every(Boolean),report:result,
      outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,
        checks:[...proof.outcomeContract.effects.checks,"rejectedInventedApplicationValue","referenceRetainedValueAdmission"]}}});
  }
  return { services, verify, qualify, close: native.close };
}
