import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
// Persisted checkpoint assessments are actor-authored claims, not native semantic truth.
// Keep the exact candidate evidence layout until nested provenance roles are representable.
const assessNativeGoal=bindObservedContentReview(["docket","effects","audit","nativeFacts"],["dossierReadback"],{legacyCandidateLayout:true});
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText, stableSha256Hex } from "@vibestudio/content-addressing";
import { createOwnedOperations, verifyOwnedOperationCustody, verifyOwnedOperations } from "@workspace/natlang-services";
import { operationsDocketEvidenceSchema, operationsDossierMethods } from "@workspace/natlang-services/ownedOperationsContracts";
import { contextId, fs, rpc, runtime, vcs } from "@workspace/runtime";
import type { z } from "zod";
import type { OpenGoalDomainVerification } from "./open-goal-managed.js";
import type { OperationsGoalWorld } from "./open-goal-owned-operations-worlds.js";
import { readCompleteWorkspaceBytes } from "./workspaceByteReadback.js";

type Evidence = z.infer<typeof operationsDocketEvidenceSchema>;
type Docket = Evidence["docket"];
type Report = z.infer<typeof operationsDossierMethods.retain.args>[2];
type Receipt = z.infer<typeof operationsDossierMethods.retain.returns>;
type Effects = { list: Docket[][]; reads: Evidence[]; dossiers: { result: Receipt; record: string; report: Report }[] };

const text = new TextDecoder("utf-8", { fatal: true });

export async function prepareOpenOwnedOperations(input: { contextId: string; caseId: string; goal: string }, world: OperationsGoalWorld, {readbackMaxBytes}:{readbackMaxBytes?:number}={}) {
  if (contextId !== input.contextId || world.id !== input.caseId || world.goal !== input.goal)
    throw new Error("The owned operations docket belongs to another goal or context");
  const initialHead = (await vcs.status({ contextId })).workingHead;
  const directory = await fs.mkdtemp("owned-operations-docket");
  const paths = new Map<string, string>();
  const reads: Effects["reads"] = [], list: Effects["list"] = [], dossiers: Effects["dossiers"] = [];
  const owned = createOwnedOperations({ runtime, rpc });

  async function seed(edition: Docket["edition"], title: string, retainWhenReady: boolean, authority: Evidence["authority"]) {
    const id = crypto.randomUUID();
    const body = {
      authority,
      retainWhenReady,
      rationale: authority === "review-only"
        ? "The current owner permits reviewing the docket. Its checkpoint operation and dossier writes have not been authorized."
        : "The current owner authorizes an isolated local role exercise and its cleanup.",
      request: world.request,
    };
    const docket = { id, title, edition, kind: world.request.kind, revision: stableSha256Hex(body) };
    const path = `${directory}/${id}.json`;
    await fs.writeFile(path, JSON.stringify({ docket, ...body }));
    paths.set(id, path);
    return docket;
  }

  const current = await seed("current", world.title, world.retainWhenReady, world.authority);
  const retired = await seed("retired", `${world.title} (previous shift)`, false, "review-only");
  function decode(bytes: Uint8Array, id: string) {
    const parsed = operationsDocketEvidenceSchema.parse(JSON.parse(text.decode(bytes)));
    const { docket, ...body } = parsed;
    if (docket.id !== id || docket.revision !== stableSha256Hex(body))
      throw new Error("The retained docket identity or body revision changed");
    return parsed;
  }
  async function read(id: string) {
    const path = paths.get(id);
    if (!path) throw new Error("Use a docket issued inside the owned workspace");
    return decode(await readCompleteWorkspaceBytes(rpc, path,{maxBytes:readbackMaxBytes}), id);
  }
  async function select(id: string, revision: string) {
    const evidence = await read(id);
    if (evidence.docket.edition !== "current" || evidence.docket.revision !== revision)
      throw new Error("Use the current exact owned docket revision");
    return evidence;
  }
  function boundOperation(report: Report | null, audit: ReturnType<typeof owned.audit>, request: Evidence["request"]) {
    if(!report)return true;
    const parsed=operationsDossierMethods.retain.args.safeParse(["","",report]);
    if(!parsed.success || report.kind!==request.kind)return false;
    const sourceIds=request.kind==="incident-handoff"?request.signals.map(row=>row.id):request.after.map(row=>row.id);
    return report.handles.every(handle=>audit.opened.some(row=>isDeepStrictEqual(row.handle,handle))) &&
      report.cleanup.retiredIds.every(id=>audit.retiredIds.includes(id)) &&
      report.cleanup.destroyedContextIds.every(id=>audit.destroyedContextIds.includes(id)) &&
      report.handoff.evidenceIds.every(id=>sourceIds.includes(id));
  }
  let retaining: { report: Report; promise: Promise<Receipt> } | undefined;
  const services = {
    operationsDocket: {
      async list() {
        const result = await Promise.all([retired, current].map(async row => (await read(row.id)).docket));
        list.push(result);
        return result;
      },
      async read(id: string, revision: string) {
        const evidence = await select(id, revision);
        reads.push(evidence);
        return evidence;
      },
    },
    ownedOperations: {
      ...owned.service,
      async append(handle:Parameters<typeof owned.service.append>[0],revision:number,assessment:Parameters<typeof owned.service.append>[2]) {
        const basis=await select(current.id,current.revision);
        const sourceIds=basis.request.kind==="incident-handoff"?basis.request.signals.map(row=>row.id):[...basis.request.before,...basis.request.after].map(row=>row.id);
        if(!assessment.evidenceIds.every(id=>sourceIds.includes(id)))
          throw new Error("Checkpoint evidence references must belong to the actual owned docket");
        return owned.service.append(handle,revision,assessment);
      },
      async open(role: Parameters<typeof owned.service.open>[0]) {
        const basis = await select(current.id, current.revision);
        const correctRole = basis.request.kind === "release-continuation" ? role === "release" : role !== "release";
        if (basis.authority !== "local-exercise" || !correctRole)
          throw new Error("The current docket does not authorize this role exercise");
        return owned.service.open(role);
      },
    },
    operationsDossier: {
      async retain(id: string, revision: string, value: Report) {
        const report = operationsDossierMethods.retain.args.parse([id, revision, value])[2];
        const basis = await select(id, revision);
        if(basis.authority!=="local-exercise" || !basis.retainWhenReady)
          throw new Error("The current docket does not authorize a private dossier");
        await owned.close();
        const audit = owned.audit();
        const retained = audit.snapshots.find(row => row.phase === "before-cleanup" && row.handle.role === "release" &&
          report.handles.some(handle=>isDeepStrictEqual(handle,row.handle)) && row.value.checkpoints.at(-1)?.assessment.decision==="ready");
        const newest = retained?.value.checkpoints.at(-1)?.assessment;
        const exactCurrent = basis.request.kind === "release-continuation" &&
          basis.request.after.length > 0 && basis.request.after.every(gate => gate.state === "approved") &&
          newest?.decision === "ready" && newest.evidenceIds.every(id=>basis.request.kind==="release-continuation"&&basis.request.after.some(gate=>gate.id===id));
        const verified = verifyOwnedOperationCustody(audit).passed && boundOperation(report,audit,basis.request) && report.handoff.decision===newest?.decision;
        if (basis.authority !== "local-exercise" || !basis.retainWhenReady ||
            report.kind !== "release-continuation" || !exactCurrent || !verified)
          throw new Error("The current release evidence and scoped retention authority do not permit a private dossier");
        if (retaining) {
          if (!isDeepStrictEqual(retaining.report, report)) throw new Error("This docket already has an exact retained dossier");
          return retaining.promise;
        }
        const record = JSON.stringify({ docket: basis.docket, checkpoints: retained!.value.checkpoints, handoff: report.handoff });
        const path = `${directory}/private-readiness.json`;
        const promise = (async () => {
          await fs.writeFile(path, record);
          const result = { path, digest: sha256HexSyncText(record) };
          dossiers.push({ result, record, report });
          return result;
        })();
        retaining = { report, promise };
        return promise;
      },
    },
  };

  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    const assessed=await assessNativeGoal(proof,proof.outcomeContract,value,invocation,
      [{checks:["returnedOperationsFinding"],rootPath:[],producerSourceSuffix:"coordinateOwnedOperations.nl",producerPath:[]},
       {checks:["returnedOperationsFinding"],rootPath:[],producerSourceSuffix:"coordinateOwnedOperations/explainOperationsFinding.nl",producerPath:[]}]);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(value: unknown, invocation?: InvocationObservations): Promise<OpenGoalDomainVerification & {
    docket: Docket; effects: Effects; audit: ReturnType<typeof owned.audit>; outcome: unknown; artifact: Receipt | null; dossierReadback:string|null;
  }> {
    const outcome = value;
    const reread = await read(current.id);
    const retiredReread = await read(retired.id);
    await owned.close();
    const audit = owned.audit();
    const held = world.authority === "review-only";
    const staged = dossiers[0] ?? null;
    const independentBytes = staged ? text.decode(await readCompleteWorkspaceBytes(rpc, staged.result.path,{maxBytes:readbackMaxBytes})) : null;
    const checks = {
      exactCurrentOwnedDocket: list.every(rows => isDeepStrictEqual(rows, [retiredReread.docket, reread.docket])) &&
        reads.some(observed => isDeepStrictEqual(observed, reread)),
      returnedOperationsFinding: typeof value==="string" && Boolean(value.trim()) || (!world.requestedReturnRequired && value===null),
      preservedAuthorization: (held ? audit.opened.length===0 && audit.snapshots.length===0 : true) &&
        verifyOwnedOperationCustody(audit).passed,
      actualPrivateDossierReadback: staged
        ? dossiers.length === 1 && independentBytes === staged.record &&
          sha256HexSyncText(independentBytes) === staged.result.digest
        : dossiers.length === 0 && !(await fs.exists(`${directory}/private-readiness.json`)),
      preservedWorkspaceHead: isDeepStrictEqual(initialHead, (await vcs.status({ contextId })).workingHead) &&
        isDeepStrictEqual(retiredReread.docket, retired) && isDeepStrictEqual(reread.request, world.request),
    };
    return {
      outcomeContract:{effects:{checks:["exactCurrentOwnedDocket", "preservedAuthorization", "actualPrivateDossierReadback", "preservedWorkspaceHead"],rationale:"Independent native state, admission, captured operations and durable readback establish these facts."},
        returnedValue:{checks:["returnedOperationsFinding"],required:world.requestedReturnRequired,trainingEvidence:"format-only",rationale:"A requested query answer is required; a redundant result copy is optional after its requested native effect is established."},
        incidentalValues:{checks:[],rationale:"Known incorrect emitted application values use actual invocation definitions for masking."}},
      incorrectReturnValues:[],

      contextId: input.contextId, caseId: input.caseId, goal: input.goal,
      passed: Object.values(checks).every(Boolean), checks, docket: current, effects: { list, reads, dossiers },
      audit, outcome, dossierReadback:independentBytes, artifact: staged?.result ?? null,
      nativeFacts:{currentDocket:reread,actorObserved:{listed:list.length>0,read:reads.some(row=>isDeepStrictEqual(row,reread))},
        retiredDocket:retiredReread.docket,workspaceBefore:initialHead,workspaceAfter:(await vcs.status({contextId})).workingHead,
        artifact:staged?{receipt:staged.result,report:staged.report,readback:independentBytes}:null,
        protocol:"Docket read evidence is distinct from Native checkpoint execution. Audit records actual issued workers, checkpoints/restarts and retired ownership, never an inferred action from permission. Persisting an authored assessment authenticates what was stored, not whether its interpretation is correct; actual docket inputs govern that semantic question. Independent artifact readback is not a teacher reread. The absence of a file is an observed fact, not proof that a conditional request was satisfied: mandatory goal review judges that obligation from the literal goal and actual observations."},
    };
  }

  async function qualify() {
    await services.operationsDocket.list();
    let deniedRetiredEdition = false;
    try {
      await services.operationsDocket.read(retired.id, retired.revision);
    } catch (error) {
      deniedRetiredEdition = error instanceof Error && error.message === "Use the current exact owned docket revision";
    }
    const evidence = await services.operationsDocket.read(current.id, current.revision);
    let operation: Report | null = null;
    let dossier: Receipt | null = null;
    if (evidence.authority === "local-exercise") {
      const handles: Report["handles"] = [];
      const persisted: Awaited<ReturnType<typeof services.ownedOperations.read>>["checkpoints"] = [];
      for (const [role, wanted] of Object.entries(world.expected.roles)) {
        if (role !== "impact" && role !== "recovery" && role !== "release") throw new Error("Unknown test-owned role");
        const handle = await services.ownedOperations.open(role);
        handles.push(handle);
        const first = await services.ownedOperations.append(handle, 0, {
          role, evidenceIds: wanted.evidenceIds, decision: wanted.decisions?.[0] ?? wanted.decision!,
          reason: "Independent assessment based on the exact role evidence.",
        });
        if (role === "release") {
          const resumed = await services.ownedOperations.restart(handle);
          if (!isDeepStrictEqual(first, resumed)) throw new Error("The owned release lost its first checkpoint");
          await services.ownedOperations.append(handle, resumed.revision, {
            role, evidenceIds: wanted.evidenceIds, decision: wanted.decisions![1]!,
            reason: "Independent assessment based on the current gate evidence.",
          });
        }
        persisted.push((await services.ownedOperations.read(handle)).checkpoints.at(-1)!);
      }
      const cleanup = await services.ownedOperations.close();
      operation = {
        kind: evidence.request.kind, handles, cleanup,
        handoff: {
          decision: persisted.every(row => row.assessment.decision === "ready") ? "ready" : "blocked",
          evidenceIds: [...new Set(persisted.flatMap(row => row.assessment.evidenceIds))],
          summary: "Local operational handoff derived from the retained assessments.",
        },
      };
      if (world.requestedArtifact==="if-ready" && evidence.retainWhenReady && operation.handoff.decision === "ready")
        dossier = await services.operationsDossier.retain(current.id, current.revision, operation);
    }
    const outcome=world.requestedReturnRequired?JSON.stringify({authority:evidence.authority,operation,dossier}):null;
    const result = await verify(outcome);
    const referencePerformedOwnedExercise=evidence.authority==="review-only"?result.audit.opened.length===0:
      !!operation&&verifyOwnedOperations(result.audit,world.expected,operation).passed;
    const referencePerformedRequestedArtifact=world.requestedArtifact!=="if-ready"||evidence.authority!=="local-exercise"||
      evidence.request.kind!=="release-continuation"||!evidence.request.after.every(row=>row.state==="approved")||!!result.artifact;
    const referenceChecks={deniedRetiredEdition,referencePerformedOwnedExercise,referencePerformedRequestedArtifact};
    return assessNativeQualification({
      ...result,outcomeContract:{...result.outcomeContract,effects:{...result.outcomeContract.effects,checks:[...result.outcomeContract.effects.checks,...Object.keys(referenceChecks)]}}, passed: result.passed && Object.values(referenceChecks).every(Boolean),
      checks: { ...result.checks, ...referenceChecks },
    });
  }
  return { services, verify, qualify, close: owned.close };
}
