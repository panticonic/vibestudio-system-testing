import {installedPackageGoalContract} from "./open-goal-review-contracts.js";
import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {packageResultContributions} from "./operational-return-contributions.js";
import {type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome = bindObservedContentReview(["effects", "assignment", "observed", "plan", "repair", "authorization"], []);
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { sameEvidenceMembers } from "./semantic-evidence.js";
import { isDeepStrictEqual } from "node:util";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { WORKSPACE_PACKAGE_SCOPES, workspaceDependencyRefError } from "@vibestudio/workspace-contracts/sourceDirs";
import type { BuildUnitCatalogEntry, WorkspaceTestPlan } from "@vibestudio/service-schemas/build";
import { contextId, rpc, vcs, workers } from "@workspace/runtime";
import type { InstalledPackageWorld as World } from "./open-goal-installed-package-worlds.js";

type State = Awaited<ReturnType<typeof vcs.status>>["workingHead"];
type Runtime = WorkspaceTestPlan["runtime"];
type Suite = { name: string; runtime: Runtime; include: string[] };
type Manifest = {
  name: string; description?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>; exports?: Record<string, unknown>;
  vibestudio: { tests?: Suite[]; services?: { name: string; protocols?: string[]; durableObject?: { className: string } }[] };
};
type Scope = { source: string; field: World["field"]; key: string; workingRevision: string; workingDigest: string;
  baselineDigest: string; grant: World["grant"] };
type Assignment = { operationId: string; goal: string; target: string; source: string; field: World["field"]; key: string; scope: Scope };
type SuiteRequest = { operationId: string; goal: string; target: string; suite: string; file: null; testName: null; mode: "inspect" };
type Receiver = Awaited<ReturnType<typeof workers.resolveService>>;
type Ports = {
  contextId: string; vcs: typeof vcs;
  catalog(): Promise<BuildUnitCatalogEntry[]>;
  receiver(protocol: string): Promise<Receiver>;
  plan(target: string, ref: string, suite: string): Promise<WorkspaceTestPlan>;
};
type Decision = "preserve-current" | "hold-foreign-package" | "hold-review-scope" | "hold-authorization" | "restore-approved-field";
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
const revision = (ref: State) => JSON.stringify(ref);
const coedit = "Maintainer note: keep the previous records and local ownership evidence.";
const newEdit = "Maintainer note: a new review is required for my changed local work.";
const bins = ["dependencies", "devDependencies", "peerDependencies"] as const;

async function readManifest(client: typeof vcs, state: State, source: string) {
  const repo = await client.resolveRepository({ state, repoPath: source });
  const file = repo && await client.readFile({ state, repositoryId: repo.repositoryId,
    file: { kind: "path", path: "package.json" } });
  if (!repo || !file || file.repositoryId !== repo.repositoryId || file.content.kind !== "text" || file.path !== "package.json")
    throw new Error("Could not read the exact installed package manifest");
  return { repositoryId: repo.repositoryId, fileId: file.fileId, digest: file.contentHash, value: JSON.parse(file.content.text) as Manifest };
}
type ManifestRead = Awaited<ReturnType<typeof readManifest>>;

function currentValue(value: Manifest, key: string) {
  return {
    dependency: value.dependencies?.[key] ?? null, devDependency: value.devDependencies?.[key] ?? null,
    peerDependency: value.peerDependencies?.[key] ?? null, contractExport: value.exports?.[key] ?? null,
    suite: value.vibestudio.tests?.find(row => row.name === key) ?? null,
  };
}
function copyEntry<T>(to: Record<string, T>, from: Record<string, T> | undefined, key: string) {
  if (from && Object.hasOwn(from, key)) to[key] = structuredClone(from[key]!);
  else delete to[key];
}
function restoreValue(working: Manifest, baseline: Manifest, world: World): Manifest {
  const updated = structuredClone(working);
  if (world.field === "runtime-dependency") {
    for (const bin of bins) {
      if (!updated[bin] && !baseline[bin]?.[world.key]) continue;
      copyEntry(updated[bin] ??= {}, baseline[bin], world.key);
      if (!baseline[bin] && !Object.keys(updated[bin]).length) delete updated[bin];
    }
  } else if (world.field === "contract-export") {
    copyEntry(updated.exports ??= {}, baseline.exports, world.key);
  } else {
    const suite = baseline.vibestudio.tests?.find(row => row.name === world.key);
    if (!suite) throw new Error("The approved baseline has no such test suite");
    const tests = updated.vibestudio.tests ??= [];
    const index = tests.findIndex(row => row.name === world.key);
    if (index >= 0) tests[index] = structuredClone(suite);
    else tests.push(structuredClone(suite));
  }
  return updated;
}

function makeCandidate(baseline: Manifest, world: World): Manifest {
  const value = structuredClone(baseline);
  const dep = value.dependencies?.[world.key], suite = value.vibestudio.tests?.find(row => row.name === world.key);
  switch (world.issue) {
    case "current": break;
    case "wrong-name": value.name = "@workspace-workers/rebased-package"; break;
    case "broken-export":
      if (!value.exports || !Object.hasOwn(value.exports, world.key)) throw new Error("No baseline export");
      value.exports[world.key] = "./removed-contract.ts";
      break;
    case "wrong-runtime":
      if (!suite) throw new Error("No baseline suite");
      suite.runtime = world.source === "workers/images" ? "browser" : "workerd";
      break;
    case "competing-suite":
      if (!suite) throw new Error("No baseline suite");
      value.vibestudio.tests = [...value.vibestudio.tests!.filter(row => row.name !== world.key),
        { name: "support-checks", runtime: "workerd", include: ["support/*.test.ts"] }];
      break;
    case "development-only":
      if (!dep) throw new Error("No baseline dependency");
      (value.devDependencies ??= {})[world.key] = dep;
      delete value.dependencies![world.key];
      break;
    case "wrong-range":
      if (!dep) throw new Error("No baseline dependency");
      value.dependencies![world.key] = "^0.2.0";
      break;
    case "coedit-removal":
      value.description = coedit;
      // The same field is missing as in a plain removal, with an unrelated retained change.
    case "absent":
      if (world.field === "runtime-dependency") delete value.dependencies![world.key];
      else if (world.field === "contract-export") delete value.exports![world.key];
      else value.vibestudio.tests = value.vibestudio.tests!.filter(row => row.name !== world.key);
      break;
  }
  return value;
}
async function writeManifest(client: typeof vcs, contextId: string, state: State, basis: ManifestRead, value: Manifest, intentSummary: string) {
  const result = await client.edit({ contextId, expectedWorkingHead: state, commandId: "installed-package-" + crypto.randomUUID(),
    intentSummary, changes: [{ kind: "content-replace", repositoryId: basis.repositoryId, fileId: basis.fileId,
      content: { kind: "text", text: JSON.stringify(value, null, 2) + "\n" } }] });
  if (result.changeIds.length !== 1) throw new Error("Expected exactly one owned package change");
}

function withoutReviewedField(value: Manifest, world: World) {
  const rest = structuredClone(value);
  if (world.field === "runtime-dependency") {
    for (const bin of bins) {
      if (!rest[bin]) continue;
      delete rest[bin][world.key];
      if (!Object.keys(rest[bin]).length) delete rest[bin];
    }
  } else if (world.field === "contract-export") {
    if (rest.exports) delete rest.exports[world.key];
    if (rest.exports && !Object.keys(rest.exports).length) delete rest.exports;
  } else {
    rest.vibestudio.tests = rest.vibestudio.tests?.filter(row => row.name !== world.key) ?? [];
  }
  return rest;
}

export async function prepareInstalledPackage(input: { contextId: string; caseId: string }, world: World, ports: Ports = {
  contextId, vcs,
  catalog: () => rpc.call("main", mainRpcMethods["build.listUnits"], []),
  receiver: protocol => workers.resolveService(protocol, null),
  plan: (target, ref, suite) => rpc.call("main", mainRpcMethods["build.resolveTestSuite"], [target, ref, suite]),
}) {
  if (input.contextId !== ports.contextId || world.id !== input.caseId)
    throw new Error("Package integrity review belongs to another context");
  const { vcs: client, contextId: ownerContext } = ports;
  const initial = await client.status({ contextId: ownerContext });
  const published = { kind: "event", eventId: initial.mainEventId } as const;
  const [baseline, original, protectedNeighbor] = await Promise.all([
    readManifest(client, published, world.source),
    readManifest(client, initial.workingHead, world.source),
    readManifest(client, initial.workingHead, world.neighbor),
  ]);
  if (baseline.value.name !== world.name || original.repositoryId !== baseline.repositoryId)
    throw new Error("The assigned installed repository does not match its protected baseline");
  const packageCandidate = world.issue === "current" ? original.value : makeCandidate(original.value, world);
  if (world.issue !== "current")
    await writeManifest(client, ownerContext, initial.workingHead, original, packageCandidate, "Prepare the disposable package baseline review");
  const prepared = await client.status({ contextId: ownerContext });
  const before = await readManifest(client, prepared.workingHead, world.source);
  const operationId = crypto.randomUUID();
  const suiteRequest: SuiteRequest = { operationId: crypto.randomUUID(), goal: world.goal, target: world.source,
    suite: "native", file: null, testName: null, mode: "inspect" };
  const assignment: Assignment = { operationId, goal: world.goal, target: world.name, source: world.source,
    field: world.field, key: world.key, scope: {
      field: world.field, key: world.key, grant: world.grant,
      source: world.scope === "neighbor" ? world.neighbor : world.source,
      workingRevision: revision(world.scope === "old-working" ? initial.workingHead : prepared.workingHead),
      workingDigest: world.scope === "old-working" ? original.digest : before.digest,
      baselineDigest: world.scope === "old-baseline" ? "retired-manifest-" + crypto.randomUUID() : baseline.digest,
    } };

  async function observe() {
    const start = await client.status({ contextId: ownerContext });
    const [local, currentBaseline, index, route] = await Promise.all([
      readManifest(client, start.workingHead, world.source),
      readManifest(client, { kind: "event", eventId: start.mainEventId }, world.source),
      ports.catalog(),
      ports.receiver(world.protocol),
    ]);
    const end = await client.status({ contextId: ownerContext });
    if (end.mainEventId !== start.mainEventId || !isDeepStrictEqual(end.workingHead, start.workingHead))
      throw new Error("Package and deployed receiver evidence crossed working revisions");
    const candidates = index.filter(row => row.source === world.source);
    const unit = candidates.length === 1 ? candidates[0]! : null;
    const catalog = unit ? { source: unit.source, name: unit.name, kind: unit.kind } : null;
    const receiver = route ? { source: route.source, name: route.name, protocol: world.protocol,
      className: route.kind === "durable-object" ? route.className : null,
      targetId: route.kind === "durable-object" ? route.targetId : null } : null;
    const declaredRoutes = currentBaseline.value.vibestudio.services?.filter(service =>
      service.protocols?.includes(world.protocol)) ?? [];
    const declared = declaredRoutes.length === 1 ? declaredRoutes[0] : null;
    const declaredReceiverMatches = Boolean(catalog?.kind === "worker" && catalog.name === world.name &&
      receiver?.source === world.source && receiver.name === declared?.name && declared?.durableObject?.className === receiver.className &&
      receiver.targetId && route.protocols.includes(world.protocol) && local.repositoryId === currentBaseline.repositoryId);
    const { scope } = assignment;
    const workingRevision = revision(start.workingHead);
    const scopeMatches = scope.source === world.source && scope.field === world.field && scope.key === world.key &&
      scope.workingRevision === workingRevision &&
      scope.workingDigest === local.digest && scope.baselineDigest === currentBaseline.digest;
    const baselineValue = currentValue(currentBaseline.value, world.key);
    const workingValue = currentValue(local.value, world.key);
    const currentSuite = local.value.vibestudio.tests?.find(row => row.name === suiteRequest.suite);
    let suiteBlockedBy: string | null = null;
    for (const [dependency, spec] of Object.entries({
      ...local.value.peerDependencies,
      ...local.value.dependencies,
    })) {
      if (!WORKSPACE_PACKAGE_SCOPES.some(scope => dependency.startsWith(scope))) continue;
      suiteBlockedBy = workspaceDependencyRefError(dependency, spec);
      if (suiteBlockedBy) break;
    }
    const observation = {
      operationId, target: world.name, source: world.source, mainRevision: start.mainEventId, workingRevision,
      name: local.value.name, baselineName: currentBaseline.value.name, workingDigest: local.digest, baselineDigest: currentBaseline.digest,
      receiver, catalog, baselineValue, workingValue, declaredReceiverMatches, scopeMatches,
      targetFieldMatches: isDeepStrictEqual(workingValue, baselineValue),
      suiteBlockedBy,
      suiteRequest: declaredReceiverMatches && local.value.name === world.name && currentSuite && !suiteBlockedBy
        ? suiteRequest : null,
    };
    return { start, local, observation, currentSuite };
  }
  type Observation = Awaited<ReturnType<typeof observe>>["observation"];
  type Repair = { status: "restored" | "state-changed" | "not-authorized"; observation: Observation };
  type Plan = Pick<WorkspaceTestPlan, "target" | "suite" | "runtime" | "stateHash"> & { contextId: string };
  type Verification = { plan: Plan; decision: { route: { runtime: Runtime; nativeApproval: boolean; explanation: string }; next: "report-plan" };
    execution: null; result: null };
  type Outcome = { assignment: Assignment; observed: Observation; finding: { decision: Decision; reason: string };
    repair: Repair | null; verification: Verification | null };
  let discovered = false;
  let observed: Observation | undefined;
  let opening: Observation | undefined;
  let attempt: Repair | null = null;
  let resolved: Plan | null = null;
  let raced = false;
  const effects: Effect[] = [];
  const remember = <T>(service: string, method: string, args: unknown[], result: T): T => {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };
  function decisionFor(observation: Observation): Decision {
    if (observation.name !== observation.baselineName || observation.name !== assignment.target || !observation.declaredReceiverMatches)
      return "hold-foreign-package";
    if (observation.targetFieldMatches) return "preserve-current";
    if (!observation.scopeMatches) return "hold-review-scope";
    return assignment.scope.grant === "restore" ? "restore-approved-field" : "hold-authorization";
  }
  async function nativePlan(basis: Awaited<ReturnType<typeof observe>>): Promise<Plan | null> {
    const request = basis.observation.suiteRequest;
    if (!request) return null;
    const plan = await ports.plan(request.target, "ctx:" + ownerContext, request.suite);
    const after = await client.status({ contextId: ownerContext });
    if (plan.protocol !== "workspace-test-plan.v1" || plan.target !== request.target ||
        plan.suite !== request.suite || plan.runtime !== basis.currentSuite?.runtime || !plan.stateHash ||
        !isDeepStrictEqual(after.workingHead, basis.start.workingHead) || after.mainEventId !== basis.start.mainEventId)
      throw new Error("The native suite plan did not belong to the current package state");
    return { target: plan.target, suite: plan.suite, runtime: plan.runtime, stateHash: plan.stateHash, contextId: ownerContext };
  }

  const services = {
    installedPackageRead: {
      async discover() {
        if (discovered) return structuredClone(assignment);
        discovered = true;
        return remember("installedPackageRead", "discover", [], assignment);
      },
      async inspect(id: string) {
        if (id !== operationId) throw new Error("Inspect only the assigned installed package");
        observed = (await observe()).observation;
        opening ??= structuredClone(observed);
        return remember("installedPackageRead", "inspect", [id], observed);
      },
    },
    installedPackageChange: {
      async restore(id: string, head: string, digest: string) {
        if (id !== operationId || attempt)
          throw new Error("Restore only the assigned package from its actual observed revision");
        const current = await observe();
        observed ??= structuredClone(current.observation);
        opening ??= structuredClone(observed);
        const exact = observed.workingRevision === head && observed.workingDigest === digest;
        const record = (status: Repair["status"], observation: Observation) => {
          attempt = { status, observation };
          resolved = null;
          return remember("installedPackageChange", "restore", [id, head, digest], attempt);
        };
        if (!exact || decisionFor(observed) !== "restore-approved-field")
          return record("not-authorized", current.observation);
        if (world.race && !raced && current.observation.workingRevision === head && current.observation.workingDigest === digest) {
          raced = true;
          await writeManifest(client, ownerContext, current.start.workingHead, current.local,
            { ...current.local.value, description: newEdit }, "Keep another editor's new package notes before the older review arrives");
          return record("state-changed", (await observe()).observation);
        }
        if (current.observation.workingRevision !== head || current.observation.workingDigest !== digest ||
            current.observation.mainRevision !== observed.mainRevision)
          return record("state-changed", current.observation);
        if (decisionFor(current.observation) !== "restore-approved-field")
          return record("not-authorized", current.observation);
        try {
          const replacement = restoreValue(current.local.value, baseline.value, world);
          await writeManifest(client, ownerContext, current.start.workingHead, current.local, replacement,
            "Restore one explicitly approved installed package declaration");
        } catch (error) {
          const after = await observe();
          if (after.observation.workingRevision === head && after.observation.workingDigest === digest) throw error;
          return record("state-changed", after.observation);
        }
        return record("restored", (await observe()).observation);
      },
    },
    testSuitePlanRead: {
      async resolve(id: string) {
        const latest = attempt?.observation ?? observed;
        if (!latest?.suiteRequest || id !== latest.suiteRequest.operationId)
          throw new Error("Inspect only the current assigned package's declared verification plan");
        const current = await observe();
        if (!isDeepStrictEqual(current.observation, latest)) throw new Error("The package changed before verification plan inspection");
        resolved = await nativePlan(current);
        if (!resolved) throw new Error("The assigned native verification plan was lost");
        return remember("testSuitePlanRead", "resolve", [id], resolved);
      },
    },
  };

  function verificationMatches(value: Verification | null | undefined, plan: Plan | null) {
    if (!plan) return value === null;
    return Boolean(value && isDeepStrictEqual(value.plan, plan) && value.execution === null && value.result === null &&
      value.decision?.next === "report-plan" && value.decision.route?.runtime === plan.runtime &&
      value.decision.route.nativeApproval === (plan.runtime === "native") &&
      typeof value.decision.route.explanation === "string" && value.decision.route.explanation.trim().length > 0);
  }

  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=packageResultContributions;
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
    const envelope = value as Outcome | null;
    const outcome = envelope;
    const final = await observe();
    const [plan, neighbor, untouchedMain] = await Promise.all([
      nativePlan(final), readManifest(client, final.start.workingHead, world.neighbor), readManifest(client, published, world.source),
    ]);
    const decision = opening ? decisionFor(opening) : null;
    const actualAttempt = attempt?.status ?? null;
    let exactEffect: boolean;
    if (actualAttempt === "restored") {
      exactEffect = final.observation.targetFieldMatches && final.local.digest !== before.digest &&
        isDeepStrictEqual(withoutReviewedField(final.local.value, world), withoutReviewedField(before.value, world));
    } else if (actualAttempt === "state-changed") {
      exactEffect = final.local.digest !== before.digest && isDeepStrictEqual(final.local.value, { ...before.value, description: newEdit });
    } else {
      exactEffect = isDeepStrictEqual(final.start.workingHead, prepared.workingHead) && final.local.digest === before.digest;
    }
    const checks = {
      boundOwnedInstallation: opening?.operationId === operationId && opening.source === world.source &&
        opening.workingRevision === revision(prepared.workingHead) && opening.workingDigest === before.digest,
      usedExactPackageBaseline: opening?.baselineDigest === baseline.digest && opening.mainRevision === initial.mainEventId &&
        isDeepStrictEqual(opening.baselineValue, currentValue(baseline.value, world.key)) &&
        isDeepStrictEqual(opening.workingValue, currentValue(before.value, world.key)),
      honoredReviewAssignment: effects.every(row => ["discover","inspect","restore","resolve"].includes(row.method)),
      returnedPackageRepair: typeof value === "string" || outcome?.repair === undefined || isDeepStrictEqual(outcome.repair,attempt),
      returnedPackageVerification: typeof value === "string" || outcome?.verification === undefined || verificationMatches(outcome.verification,plan),
      returnedPackageFinding: typeof value === "string" && value.trim().length > 0,
      verifiedLocalManifestEffect: exactEffect &&
        (!attempt || isDeepStrictEqual(attempt.observation, final.observation)),
      exactStateVerificationPlan: resolved === null || isDeepStrictEqual(resolved, plan),
      preservedProtectedAndNeighbors: final.start.mainEventId === initial.mainEventId &&
        untouchedMain.digest === baseline.digest && neighbor.digest === protectedNeighbor.digest &&
        neighbor.repositoryId === protectedNeighbor.repositoryId,
    };
    return {
      outcomeContract:installedPackageGoalContract(world),
      incorrectReturnValues:[],
 caseId: world.id, contextId: ownerContext, goal: world.goal, passed: Object.values(checks).every(Boolean), checks,
      actualResult:value, effects: structuredClone(effects), assignment, observed, decision, repair: attempt, plan,
      authorization:{operationId,scope:assignment.scope,before:opening?{workingRevision:opening.workingRevision,workingDigest:opening.workingDigest,baselineDigest:opening.baselineDigest,scopeMatches:opening.scopeMatches}:null,action:attempt?{status:attempt.status}:null,after:{workingRevision:final.observation.workingRevision,workingDigest:final.observation.workingDigest,baselineDigest:final.observation.baselineDigest,scopeMatches:final.observation.scopeMatches}} };
  }

  async function qualify() {
    const assignment = await services.installedPackageRead.discover();
    const observed = await services.installedPackageRead.inspect(assignment.operationId);
    const decision = decisionFor(observed);
    const repair = decision === "restore-approved-field"
      ? await services.installedPackageChange.restore(observed.operationId, observed.workingRevision, observed.workingDigest)
      : null;
    const request = (repair?.observation ?? observed).suiteRequest;
    const plan = request && await services.testSuitePlanRead.resolve(request.operationId);
    const verification: Verification | null = plan ? { plan, decision: { next: "report-plan", route: {
      runtime: plan.runtime, nativeApproval: plan.runtime === "native", explanation: "The installed manifest designates this verification runner.",
    } }, execution: null, result: null } : null;
    const result = JSON.stringify({target:assignment.target,source:assignment.source,scopeMatchedBeforeAction:observed.scopeMatches,decision,action:repair?.status??null,verification:verification??null});
    const proof = await verify(result);
    let rejectedForeignNativeScope=false;
    try {await services.installedPackageRead.inspect("foreign-assignment");} catch {rejectedForeignNativeScope=true;}
    const rejectedMissingRequestedAnswer = !world.requestedReturnRequired || !(await verify(undefined)).outcomeDimensions.returnedValue.passed;
    const referenceNativeRestore = decision !== "restore-approved-field" || repair?.status === (world.race ? "state-changed" : "restored");
    const referenceNativePlan = !request || plan !== null;
    const checks = {...proof.checks,rejectedForeignNativeScope,rejectedMissingRequestedAnswer,referenceNativeRestore,referenceNativePlan};
    return assessNativeQualification({...proof,checks,passed:Object.values(checks).every(Boolean),result,
      outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,
        checks:[...proof.outcomeContract.effects.checks,"rejectedForeignNativeScope","rejectedMissingRequestedAnswer","referenceNativeRestore","referenceNativePlan"]}}});
  }

  return { services, verify, qualify };
}
