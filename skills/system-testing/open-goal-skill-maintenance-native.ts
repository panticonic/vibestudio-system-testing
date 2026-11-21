import { isDeepStrictEqual } from "node:util";
import {
  createEvalExecutor,
  type EvalCall,
  type EvalResultReceipt,
} from "@vibestudio/service-schemas/eval";
import type { ProgramDescription } from "@workspace/natlang/describe-types";

export type Clause = { path: string; parameters: string[]; returns: string };
export type Criterion = {
  expected: Clause[];
  absent: string[];
  requiredSelectors: string[] | null;
};
export type Finding = {
  path: string;
  revision: string;
  satisfied: boolean;
  failures: string[];
};
export type NativeSkillCheck = {
  runId: string;
  runDigest: string;
  resultDigest: string;
} & Finding &
  Criterion;

export function measureSkillContract(
  description: ProgramDescription,
  path: string,
  revision: string,
  criterion: Criterion,
): Finding {
  const failures: string[] = [];
  for (const clause of criterion.expected) {
    const actual = description.functions.find(
      ({ source }) => source === clause.path,
    );
    if (!actual) failures.push(`missing:${clause.path}`);
    else {
      if (JSON.stringify(actual.params) !== JSON.stringify(clause.parameters))
        failures.push(`parameters:${clause.path}`);
      if (actual.returns !== clause.returns)
        failures.push(`return:${clause.path}`);
    }
  }
  for (const name of criterion.absent)
    if (description.functions.some(({ source }) => source === name))
      failures.push(`obsolete:${name}`);
  if (
    criterion.requiredSelectors !== null &&
    JSON.stringify(
      [...(description.serviceScopes.notificationState ?? [])].sort(),
    ) !== JSON.stringify([...criterion.requiredSelectors].sort())
  )
    failures.push("service-selectors:notificationState");
  return { path, revision, satisfied: failures.length === 0, failures };
}

type Scope = { scopeKey: string; receipt: EvalResultReceipt };
export function ownedSkillMaintenanceNative(call: EvalCall, contextId: string) {
  const execute = createEvalExecutor(call);
  const scopes = new Set<string>();
  async function observe(path: string, revision: string, criterion: Criterion) {
    const scopeKey = "open-skill-maintenance-" + crypto.randomUUID();
    const runId = "skill-contract-" + crypto.randomUUID();
    const options = JSON.stringify([path, revision, criterion]);
    // This finite witness evaluates the actual installed compiler description.
    // The caller cannot provide source code for the cell.
    const code = `
import {contextId as actual} from "@workspace/runtime";
if (actual !== ${JSON.stringify(contextId)}) throw new Error("Skill contract probe left its owned context");
const [path, revision, criterion] = ${options};
const measure = ${measureSkillContract.toString()};
try {
  return measure(await natlang.describe(path), path, revision, criterion);
} catch (error) {
  return {path, revision, satisfied:false, failures:["compiler:" + String(error)]};
}
`;
    scopes.add(scopeKey);
    const result = await execute({
      runId,
      scope: { key: scopeKey, lifecycle: "finite" },
      timeoutMs: 30000,
      authority: { effects: "read-only", approvals: "pregranted-only" },
      source: { kind: "inline", syntax: "typescript", code },
    });
    const route = { scopeKey, runId };
    const receipt = await call("eval.receipt", [route]);
    const value = receipt?.result.returnValue as Finding | undefined;
    if (
      !result.success ||
      !receipt ||
      !receipt.result.success ||
      receipt.runId !== runId ||
      !isDeepStrictEqual(receipt.result.returnValue, result.returnValue) ||
      value?.path !== path ||
      value.revision !== revision ||
      typeof value.satisfied !== "boolean" ||
      !Array.isArray(value.failures)
    )
      throw new Error(
        "The exact native skill contract witness was not retained",
      );
    return {
      check: {
        ...criterion,
        ...value,
        runId,
        runDigest: receipt.runDigest,
        resultDigest: receipt.resultDigest,
      },
      retained: { scopeKey, receipt },
    };
  }
  async function retained({ scopeKey, receipt }: Scope) {
    return isDeepStrictEqual(
      await call("eval.receipt", [{ scopeKey, runId: receipt.runId }]),
      receipt,
    );
  }
  async function close() {
    const results = await Promise.allSettled(
      [...scopes].map((scopeKey) => call("eval.dispose", [{ scopeKey }])),
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length)
      throw new AggregateError(errors, "Owned skill witness cleanup failed");
  }
  return { observe, retained, close };
}
