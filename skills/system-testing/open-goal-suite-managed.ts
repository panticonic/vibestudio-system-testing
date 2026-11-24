import {assessObservedApplicationOutcome,type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { rpc } from "@workspace/runtime";
import { bindSuiteReview } from "@workspace-skills/native-suite-review-bindings";
import type { SuiteGoalWorld, SuiteSelection } from "./open-goal-suite-worlds.js";

type Bound = ReturnType<typeof bindSuiteReview>;
type Plan = Awaited<ReturnType<Bound["services"]["testSuitePlanRead"]["resolve"]>>;
type Execution = Awaited<ReturnType<Bound["services"]["testSuiteVerificationRun"]["run"]>>;
type Review = { plan: Plan; decision: { route: { runtime: string; nativeApproval: boolean }; next: string };
  execution: Execution | null; result: { outcome: string } | null };
type Report = { status: string; selection: SuiteSelection; review: Review };

export function prepareOpenGoalSuite({ contextId, caseId }: { contextId: string; caseId: string }, world: SuiteGoalWorld) {
  const { goal, expected, execution } = world;
  const ref = `ctx:${contextId}`;
  const resolve = (target: string, suite: string) =>
    rpc.call("main", mainRpcMethods["build.resolveTestSuite"], [target, ref, suite]);

  let routes: (Omit<Awaited<ReturnType<typeof resolve>>, "protocol"> & { id: string; purpose: string })[] = [];
  let selected: SuiteSelection | undefined;
  let binding: Bound | undefined;
  let seenPlan: Plan | undefined;
  let executed: Execution | undefined;
  let runAttempts = 0;
  const services: Bound["services"] & {
    goalSuite: {
      discover(): Promise<typeof routes>;
      prepare(choice: SuiteSelection): Promise<Bound["request"] | null>;
    };
  } = {
    goalSuite: {
      async discover() {
        routes = await Promise.all(world.routes.map(async ({ id, purpose, target, suite }) => {
          const plan = await resolve(target, suite);
          return { id, purpose, target: plan.target, suite: plan.suite, runtime: plan.runtime, stateHash: plan.stateHash };
        }));
        return structuredClone(routes);
      },
      async prepare(choice) {
        const route = routes.find(row => row.id === choice?.routeId);
        if (!route || binding || !["inspect", "verify"].includes(choice.mode) ||
            (choice.mode === "verify" &&
              !(execution?.routeId === route.id && execution.file === choice.file &&
                execution.runtime === route.runtime)) ||
            (choice.mode === "inspect" && (choice.file !== null || choice.testName !== null))) return null;
        const current = await resolve(route.target, route.suite);
        if (current.stateHash !== route.stateHash || current.runtime !== route.runtime) return null;
        binding = bindSuiteReview({ goal, target: route.target, suite: route.suite, mode: choice.mode,
          file: choice.file, testName: choice.testName });
        selected = structuredClone(choice);
        return structuredClone(binding.request);
      },
    },
    testSuitePlanRead: {
      async resolve(id) {
        if (!binding) throw new Error("Select a discovered suite before resolving it");
        const plan = await binding.services.testSuitePlanRead.resolve(id);
        seenPlan = structuredClone(plan);
        return plan;
      },
    },
    testSuiteVerificationRun: {
      async run(id, hash) {
        runAttempts++;
        if (!binding) throw new Error("Select an authorized suite before running it");
        const result = await binding.services.testSuiteVerificationRun.run(id, hash);
        executed = structuredClone(result);
        return result;
      },
    },
  };

  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["returnedSuiteReview","identifiedApproval"],"rootPath":["review"],"producerSourceSuffix":"reviewTestSuite.nl","producerPath":[]}];
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
    const report = value as Report | null;
    const review = report?.review;
    const expectedRoute = world.routes.find(route => route.id === expected.choice.routeId)!;
    const current = await resolve(expectedRoute.target, expectedRoute.suite);
    const verifyMode = expected.choice.mode === "verify";
    const checks = {
      discoveredSuites: routes.length > 1 && routes.some(route => route.id === expectedRoute.id &&
        route.stateHash === current.stateHash && route.runtime === current.runtime),
      selectedAuthorizedSuite: isDeepStrictEqual(selected, expected.choice),
      currentSuitePlan: Boolean(seenPlan && seenPlan.contextId === contextId && seenPlan.stateHash === current.stateHash &&
        seenPlan.target === current.target && seenPlan.suite === current.suite ),
      returnedSuiteReview: report?.status==="suite-reviewed"&&review?.decision?.next===(verifyMode?"run-assignment":"report-plan")&&isDeepStrictEqual(review?.plan,seenPlan)&&isDeepStrictEqual(review?.execution,executed??null)&&
        (verifyMode?review?.result?.outcome===(expected.status==="no-tests"?"no-match":"verified"):review?.result===null),
      identifiedApproval: review?.decision?.route?.runtime === expected.runtime &&
        review.decision.route.nativeApproval === (expected.runtime === "native"),
      checkedSuiteReceipt: verifyMode ? runAttempts === 1 && Boolean(executed?.current &&
        executed.status === expected.status && executed.receipt?.contextId === contextId &&
        executed.receipt.operation === "test" && executed.receipt.runtime === expected.runtime &&
        executed.receipt.ref === ref && executed.receipt.target === current.target &&
        executed.receipt.suite === current.suite && executed.receipt.stateHash === current.stateHash &&
        /^[a-f0-9]{64}$/u.test(executed.reportDigest ?? "") && /^[a-f0-9]{64}$/u.test(executed.executionDigest ?? "") &&
        executed.artifactKey && executed.failed === 0 &&
        (expected.status === "no-tests" ? executed.passed === 0 : (executed.passed ?? 0) > 0))
        : runAttempts === 0,
    };
    return {
      outcomeContract:{effects:{checks:["discoveredSuites", "selectedAuthorizedSuite", "currentSuitePlan", "checkedSuiteReceipt"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["returnedSuiteReview", "identifiedApproval"],required:true,rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],
 goal, contextId, caseId, passed: Object.values(checks).every(Boolean), checks, routes,
      selected, plan: seenPlan, execution: executed, runAttempts };
  }

  async function qualify() {
    await services.goalSuite.discover();
    const request = await services.goalSuite.prepare(expected.choice);
    if (!request) throw new Error("The authorized reference suite was not prepared");
    const plan = await services.testSuitePlanRead.resolve(request.operationId);
    const verifyMode = expected.choice.mode === "verify";
    const execution = verifyMode ? await services.testSuiteVerificationRun.run(request.operationId, plan.stateHash) : null;
    return verify({ status: "suite-reviewed", review: {
      plan, decision: { route: { runtime: plan.runtime, nativeApproval: plan.runtime === "native" },
        next: verifyMode ? "run-assignment" : "report-plan" },
      execution, result: execution ? { outcome: execution.status === "no-tests" ? "no-match" : "verified" } : null,
    } });
  }
  return { goal, services, verify, qualify };
}
