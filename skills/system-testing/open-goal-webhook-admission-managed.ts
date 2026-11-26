import {maxScratchArtifactBytes} from "@workspace-skills/scratch-handoff-bindings";
import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome = bindObservedContentReview(["assignment", "evidence", "binding", "effects"], ["handoffText"]);
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { sameEvidenceMembers } from "./semantic-evidence.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { webhookIngressSubscriptionSummarySchema } from "@vibestudio/service-schemas/webhookIngress";
import type { CreateWebhookIngressSubscriptionRequest, WebhookIngressSubscriptionSummary } from "@vibestudio/shared/webhooks/contracts";
import { contextId, fs, rpc, webhooks } from "@workspace/runtime";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type { WebhookAdmissionWorld as World } from "./open-goal-webhook-admission-worlds.js";

type Ports = {
  contextId: string;
  hooks: Pick<typeof webhooks, "createSubscription" | "listSubscriptions" | "revokeSubscription">;
  artifacts: {
    directory(): Promise<string>;
    write(path: string, value: string): Promise<void>;
    read(path: string, limit: number): Promise<Uint8Array>;
    entries(path: string): Promise<string[]>;
  };
};
type Decision = World["expected"];
type Receipt = { path: string; bytes: number; sha256: string };
type Witness = { contextId: string; registration: string; createdAt: number; updatedAt: number; digest: string };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
const archiveName = "registration.json";
const outputName = "admission-audit.json";
const limit = 18000;
const decoder = new TextDecoder("utf-8", { fatal: true });
const hash = sha256HexSyncText;
const encode = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

const intendedTarget = {
  source: "workers/system-test-runner", className: "SystemTestRunnerDO",
  objectKey: "webhook-admission-review", method: "inspectSystemTestRun",
};
const eventHeader = "x-local-event-id";
const replayWindow = 300000;
const requiredBody = 4096;
const status = 204;

function project(row: WebhookIngressSubscriptionSummary) {
  return {
    id: row.subscriptionId, label: row.label ?? "", target: row.target,
    createdAt: row.createdAt, updatedAt: row.updatedAt, revokedAt: row.revokedAt ?? null,
    delivery: row.delivery.mode, maxBodyBytes: row.maxBodyBytes, payload: row.payload.type,
    replayKind: row.replay?.key.type ?? null,
    replayField: row.replay?.key.type === "header" ? row.replay.key.name : null,
    replayWindow: row.replay?.ttlMs ?? null, successStatus: row.response.successStatus,
    malformed: row.response.malformedPayload, dispatch: row.response.dispatchError,
    verifierKind: row.verifier.type, hasSecret: row.verifier.hasSecret,
  };
}
type Row = ReturnType<typeof project>;
type Binding = { row: Row | null; hold: "hold-record" | "hold-scope" | "hold-revoked" | "hold-receipt" | null };
type Assessment = { disposition: Decision; reason: string };
type Observation = {
  witness: Witness | null; retainedDigest: string | null; rowDigest: string | null; active: Row[]; history: Row[];
};
const canonicalRows = (rows: WebhookIngressSubscriptionSummary[]) => rows.map(row => webhookIngressSubscriptionSummarySchema.parse(row))
  .sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId));

function livePorts(): Ports {
  return {
    contextId,
    hooks: webhooks,
    artifacts: {
      directory: () => fs.mkdtemp("owned-webhook-audit"),
      write: (path, value) => fs.writeFile(path, value),
      read: (path, bound) => readWorkspaceBytes(rpc, path, bound),
      entries: path => fs.readdir(path),
    },
  };
}

export async function prepareWebhookAdmission(input: { contextId: string; caseId: string }, world: World, ports: Ports = livePorts()) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("Webhook admission belongs to another context or case");
  const { contextId: owner, hooks, artifacts } = ports;
  const retainedRows = () => hooks.listSubscriptions({ includeRevoked: true }).then(canonicalRows);
  const activeRows = () => hooks.listSubscriptions().then(canonicalRows);
  const before = await retainedRows();
  const directory = await artifacts.directory();
  const archivedPath = directory.replace(/\/$/u, "") + "/" + archiveName;
  const outputPath = directory.replace(/\/$/u, "") + "/" + outputName;
  const localLabel = world.label + " " + crypto.randomUUID().slice(0, 8);
  const created = new Set<string>();
  const retired = new Set<string>();
  const effects: Effect[] = [];
  async function register(variant: World["current"]) {
    const request: CreateWebhookIngressSubscriptionRequest = {
      label: localLabel,
      target: { ...intendedTarget,
        objectKey: variant === "receiver-instance" ? "old-webhook-review" : intendedTarget.objectKey,
        method: variant === "receiver-method" ? "getSystemTestRunResult" : intendedTarget.method,
      },
      delivery: { mode: "direct" },
      maxBodyBytes: variant === "small-body" ? 1024 : requiredBody,
      payload: { type: variant === "raw" ? "raw" : "json" },
      verifier: { type: "oidc-jwt", issuer: "https://local-fixture.invalid", audience: "workspace-audit-fixture",
        jwksUrl: "https://local-fixture.invalid/keys" },
      ...(variant === "no-replay" ? {} : { replay: {
        key: variant === "replay-hash" ? { type: "body-sha256" } : { type: "header", name: eventHeader },
        ttlMs: variant === "short-replay" ? 1500 : replayWindow,
      } }),
      response: { successStatus: variant === "status-202" ? 202 : status,
        malformedPayload: variant === "malformed-ack" ? "ack" : "reject",
        dispatchError: variant === "dispatch-ack" ? "ack" : "retry" },
    };
    const raw = await hooks.createSubscription(request);
    // The assigned fixture alone owns this newly issued row.
    created.add(raw.subscriptionId);
    const summary = webhookIngressSubscriptionSummarySchema.parse(raw);
    if (summary.delivery.mode !== "direct" || summary.verifier.type !== "oidc-jwt" || summary.verifier.hasSecret)
      throw new Error("Expected a secretless native direct fixture registration");
    return project(summary);
  }
  async function retire(id: string) {
    if (!created.has(id) || retired.has(id)) return;
    await hooks.revokeSubscription(id);
    retired.add(id);
  }
  async function close() {
    const cleanup = await Promise.allSettled([...created].map(retire));
    const errors = cleanup.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    const remaining = await retainedRows();
    if ([...created].some(id => remaining.find(row => row.subscriptionId === id)?.revokedAt == null))
      errors.push(new Error("An owned local webhook fixture registered without a cleanup tombstone"));
    if (errors.length) throw new AggregateError(errors, "Complete all owned local webhook audit cleanup");
  }
  let current: Row | null, prior: Row | null, witness: Witness | null, retainedDigest: string | null;
  let baseline: WebhookIngressSubscriptionSummary[];
  try {
    current = world.current === "missing" ? null : await register(world.current);
    prior = world.retained === "prior" ? await register("matching") : null;
    if (prior) await retire(prior.id);
    if (current && world.current === "revoked") await retire(current.id);
    if (world.retainSibling) await register("receiver-instance");
    const selected = prior ?? current;
    witness = world.retained === "absent" ? null : {
      contextId: world.retained === "foreign" ? "outside-owned-context" : owner,
      registration: selected?.id ?? crypto.randomUUID(),
      createdAt: selected?.createdAt ?? 10,
      updatedAt: world.retained === "altered" ? (selected?.updatedAt ?? 0) - 1 : selected?.updatedAt ?? 11,
      digest: selected ? hash(encode(selected)) : hash("Previous retained registration no longer present"),
    };
    retainedDigest = witness ? hash(encode(witness)) : null;
    if (witness) await artifacts.write(archivedPath, encode(witness));
    baseline = await retainedRows();
    const independent = baseline.filter(row => !created.has(row.subscriptionId));
    if (!isDeepStrictEqual(independent, before))
      throw new Error("Webhook fixture setup crossed an unrelated subscription scope");
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Webhook fixture setup and cleanup failed"); }
    throw error;
  }
  const assignment = { id: crypto.randomUUID(), contextId: owner, goal: world.goal, label: localLabel,
    registration: witness?.registration ?? current?.id ?? crypto.randomUUID(), mayStage: world.mayStage,
    requirement: world.requirement, target: intendedTarget, minBody: requiredBody,
    replayField: eventHeader, minReplayWindow: replayWindow, successStatus: status };
  type Outcome = {
    assignment: typeof assignment; evidence: Observation; binding: Binding; assessment: Assessment; handoff: Receipt | null;
  };
  let discovered = false, pending = false;
  let observed: Observation | null = null;
  let handoff: Receipt | null = null;
  function record<T>(service: string, method: string, args: unknown[], result: T) {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  }
  async function observe() {
    const [active, historic] = await Promise.all([activeRows(), retainedRows()]);
    const scopedActive = active.filter(row => created.has(row.subscriptionId)).map(project);
    const scopedHistory = historic.filter(row => created.has(row.subscriptionId)).map(project);
    if (!isDeepStrictEqual(scopedActive, scopedHistory.filter(row => row.revokedAt === null)))
      throw new Error("Current owner-visible facts crossed an activation change");
    const retained = retainedDigest ? decoder.decode(await artifacts.read(archivedPath, limit)) : null;
    const activeMatch = scopedActive.find(row => row.id === assignment.registration);
    return { active: scopedActive, history: scopedHistory,
      witness: retained ? JSON.parse(retained) as Witness : null,
      retainedDigest: retained ? hash(retained) : null, rowDigest: activeMatch ? hash(encode(activeMatch)) : null };
  }
  function match(evidence: Observation): Binding {
    const hold = (kind: Binding["hold"]) => ({ row: null, hold: kind });
    if (!evidence.witness || !evidence.retainedDigest || evidence.witness.registration !== assignment.registration)
      return hold("hold-receipt");
    if (evidence.witness.contextId !== owner) return hold("hold-scope");
    if (evidence.history.some(row => row.id === assignment.registration && row.revokedAt !== null)) return hold("hold-revoked");
    const row = evidence.active.find(row => row.id === assignment.registration);
    if (!row) return hold("hold-record");
    if (row.createdAt !== evidence.witness.createdAt || row.updatedAt !== evidence.witness.updatedAt ||
        evidence.rowDigest !== evidence.witness.digest || evidence.retainedDigest !== retainedDigest)
      return hold("hold-receipt");
    return { row, hold: null };
  }
  function assess(binding: Binding): Decision {
    if (binding.hold) return binding.hold;
    const row = binding.row;
    if (!row) return "hold-record";
    if (row.delivery !== "direct" || row.verifierKind !== "oidc-jwt" || row.hasSecret ||
        !isDeepStrictEqual(row.target, assignment.target)) return "hold-target";
    const includes = (name: World["requirement"]) => assignment.requirement === "full" || assignment.requirement === name;
    if (includes("payload") && row.payload !== "json") return "hold-payload";
    if (includes("body-limit") && row.maxBodyBytes < assignment.minBody) return "hold-body-limit";
    if ((includes("replay-key") || includes("replay-window")) &&
        (row.replayKind !== "header" || row.replayField !== assignment.replayField)) return "hold-replay-key";
    if (includes("replay-window") && (row.replayWindow ?? 0) < assignment.minReplayWindow) return "hold-replay-window";
    if (includes("retry") && row.dispatch !== "retry") return "hold-retry";
    if (includes("malformed") && row.malformed !== "reject") return "hold-malformed";
    if (includes("status") && row.successStatus !== assignment.successStatus) return "hold-status";
    return assignment.mayStage ? "stage-audit" : "report-only";
  }
  function audit(row: Row) {
    const kind = assignment.requirement;
    const wants = (test: World["requirement"]) => kind === "full" || test === kind;
    return encode({ protocol: "vibestudio-webhook-admission-audit.v1", contextId: owner, registration: row.id,
      target: row.target, nativeCreatedAt: row.createdAt, nativeUpdatedAt: row.updatedAt,
      retainedDigest, requirement: kind, metadata: {
        ...(wants("payload") ? { payload: row.payload } : {}),
        ...(wants("body-limit") ? { maxBodyBytes: row.maxBodyBytes } : {}),
        ...(wants("replay-key") || wants("replay-window") ? { replayField: row.replayField, replayKind: row.replayKind } : {}),
        ...(wants("replay-window") ? { replayWindow: row.replayWindow } : {}),
        ...(wants("retry") ? { dispatch: row.dispatch } : {}),
        ...(wants("malformed") ? { malformed: row.malformed } : {}),
        ...(wants("status") ? { successStatus: row.successStatus } : {}),
      } });
  }

  const services = {
    webhookAdmissionEvidence: {
      async discover() {
        if (discovered) return structuredClone(assignment);
        discovered = true;
        return record("webhookAdmissionEvidence", "discover", [], assignment);
      },
      async inspect(id: string) {
        if (id !== assignment.id) throw new Error("Read only the exact assigned webhook registration");
        if (observed) return structuredClone(observed);
        if (pending) throw new Error("The webhook observation is already in progress");
        pending = true;
        try { observed = await observe(); return record("webhookAdmissionEvidence", "inspect", [id], observed); }
        finally { pending = false; }
      },
    },
    webhookAdmissionHandoff: {
      async stage(id: string, digest: string | null, row: Row | null, disposition: Decision) {
        if (!observed || pending || handoff || id !== assignment.id || !row || digest !== retainedDigest ||
            disposition !== "stage-audit" || assess(match(observed)) !== disposition || !isDeepStrictEqual(row, match(observed).row))
          throw new Error("Expected the exact authorized redacted admission audit");
        pending = true;
        try {
          if (!isDeepStrictEqual(observed, await observe()))
            throw new Error("The original native admission evidence changed before handoff");
          const text = audit(row);
          if(new TextEncoder().encode(text).byteLength>maxScratchArtifactBytes)return null;
          await artifacts.write(outputPath, text);
          const stored = await artifacts.read(outputPath, maxScratchArtifactBytes);
          if (decoder.decode(stored) !== text) throw new Error("Private admission audit failed byte readback");
          handoff = { path: outputPath, bytes: stored.length, sha256: hash(text) };
          return record("webhookAdmissionHandoff", "stage", [id, digest, row, disposition], handoff);
        } finally { pending = false; }
      },
    },
  };
  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["matchedAdmissionDisposition"],"rootPath":["assessment"],"producerSourceSuffix":"reviewWebhookAdmission/assessWebhookAdmission.nl","producerPath":[]}];
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
async function verifyNativeApplication(value: unknown, invocation?: InvocationObservations) {
    const report = value as Outcome | null;
    const out = report;
    const final = await observe(), finalRows = await retainedRows();
    const wantStage = world.expected === "stage-audit";
    const hold = ["hold-record", "hold-scope", "hold-revoked", "hold-receipt"].includes(world.expected);
    const expectedBinding = hold ? { row: null, hold: world.expected } :
      { row: final.active.find(row => row.id === assignment.registration), hold: null };
    const leafNames = (await artifacts.entries(directory)).sort();
    const wantedNames = [...(witness ? [archiveName] : []), ...(wantStage ? [outputName] : [])].sort();
    const expectedNote = wantStage && expectedBinding.row ? audit(expectedBinding.row) : null;
    const actual = leafNames.includes(outputName) ? await artifacts.read(outputPath, maxScratchArtifactBytes) : null;
    const checks = {
      matchedOwnedRegistrationReceipt: isDeepStrictEqual(final.witness, witness) &&
        final.retainedDigest === retainedDigest,
      exactNativeActiveAndTombstone: isDeepStrictEqual(observed, final),
      exactCurrentBinding: isDeepStrictEqual(match(final), expectedBinding),
      matchedAdmissionDisposition: isDeepStrictEqual(out?.handoff,handoff)&&out?.assessment?.disposition === world.expected && typeof out.assessment.reason === "string" &&
        out.assessment.reason.trim().length > 0,
      verifiedScopedPrivateAudit: isDeepStrictEqual(leafNames, wantedNames) &&
        (expectedNote ? actual && decoder.decode(actual) === expectedNote && handoff?.path === outputPath &&
          handoff.bytes === actual.length && handoff.sha256 === hash(expectedNote) : handoff === null && actual === null),
      preservedNativeRegistryAndRedaction: isDeepStrictEqual(baseline, finalRows) &&
        final.history.every(row => !row.hasSecret && row.verifierKind === "oidc-jwt") &&
        sameEvidenceMembers(effects.map(effect => effect.method), wantStage ? ["discover", "inspect", "stage"] : ["discover", "inspect"]),
    };
    return {
      outcomeContract:{
        effects:{checks:["matchedOwnedRegistrationReceipt", "exactNativeActiveAndTombstone", "exactCurrentBinding", "verifiedScopedPrivateAudit", "preservedNativeRegistryAndRedaction"],rationale:"Native observations, captured writes, persisted bytes and protected state establish these facts independently of the public result."},
        returnedValue:{checks:["matchedAdmissionDisposition"],required:!wantStage,rationale:"The requested analysis is application data; a redundant result copy is optional once the requested native artifact or operation exists."},
        incidentalValues:{checks:[],rationale:"Known incorrect emitted application values are masked using their actual invocation definition."}},
      incorrectReturnValues:[],
 caseId: world.id, contextId: owner, goal: world.goal, assignment, evidence: final, binding: expectedBinding,
      assessment: out?.assessment, handoff, handoffText: actual ? decoder.decode(actual) : null, effects: structuredClone(effects), checks,
      passed: Object.values(checks).every(Boolean) };
  }
  async function qualify() {
    await services.webhookAdmissionEvidence.discover();
    const evidence = await services.webhookAdmissionEvidence.inspect(assignment.id);
    const binding = match(evidence);
    const assessment = { disposition: assess(binding), reason: "Review the scoped registration, its retained receipt and declared metadata." };
    const handoff = assessment.disposition === "stage-audit" ?
      await services.webhookAdmissionHandoff.stage(assignment.id, evidence.retainedDigest, binding.row, assessment.disposition) : null;
    const result = {assessment,handoff};
    const proof = await verify(result);
    const rejectedInventedApplicationValue = !(await verify({...result,assessment:{...assessment,disposition:"invented"}})).outcomeDimensions.returnedValue.passed;
    const checks = {...proof.checks,rejectedInventedApplicationValue};
    return assessNativeQualification({...proof,checks,passed:Object.values(checks).every(Boolean),result,
      outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,
        checks:[...proof.outcomeContract.effects.checks,"rejectedInventedApplicationValue"]}}});
  }
  return { services, qualify, verify, close };
}
