import {sha256HexSyncText} from "@vibestudio/content-addressing";
/** Independent requirements of an authored task, separate from its execution trace. */
export type SemanticOutcomeContract = {
  effects: { checks: readonly string[]; rationale: string };
  returnedValue: { checks: readonly string[]; required: boolean; rationale: string };
  incidentalValues?: { checks: readonly string[]; rationale: string };
};

type Verification = {
  passed: boolean;
  checks: Record<string, boolean>;
  [name: string]: unknown;
};

export function assessSemanticOutcome<T extends Verification>(
  verification: T,
  contract?: SemanticOutcomeContract,
): T & { outcomeContract: SemanticOutcomeContract; outcomeDimensions: {
  effects: { passed: boolean; checks: Record<string, boolean> };
  returnedValue: { required: boolean; passed: boolean; checks: Record<string, boolean> };
  incidentalValues?: { passed: boolean; checks: Record<string, boolean>; incorrectReturns: {definition:{name:string;source:string};required:boolean;valueJson:string;sha256:string}[] };
} } {
  // Existing application oracles remain strict until their authored contract
  // identifies independent state checks and any incidental response convention.
  const declared: SemanticOutcomeContract = contract ?? (verification.outcomeContract as SemanticOutcomeContract | undefined) ?? {
    effects: { checks: Object.keys(verification.checks), rationale: "The domain verifier binds the actual application evidence and required returned values." },
    returnedValue: { checks: [], required: true, rationale: "The domain result is part of this task's existing application contract." },
  };
  // Domain verifiers and their callers may both assess the same outcome.
  // Preserve the original observations when required checks are projected out.
  const observedChecks = (verification.observedChecks ?? verification.checks) as Record<string, boolean>;
  if (!observedChecks || typeof observedChecks !== "object" ||
      Object.values(observedChecks).some(value => typeof value !== "boolean") ||
      Object.entries(verification.checks).some(([name, value]) => observedChecks[name] !== value))
    throw new Error("The outcome projection must preserve its original observations");
  const names = [...declared.effects.checks, ...declared.returnedValue.checks, ...(declared.incidentalValues?.checks ?? [])];
  if (new Set(names).size !== names.length || names.length !== Object.keys(observedChecks).length ||
      names.some(name => !Object.hasOwn(observedChecks, name)) ||
      !declared.effects.rationale.trim() || !declared.returnedValue.rationale.trim())
    throw new Error("The outcome contract must account for every independent application check once");
  const select = (names: readonly string[]) => Object.fromEntries(names.map(name => [name, observedChecks[name]!]));
  const effects = select(declared.effects.checks);
  const returnedValue = select(declared.returnedValue.checks);
  const incidental = select(declared.incidentalValues?.checks ?? []);
  const effectsPassed = Object.values(effects).every(value => value === true);
  const returnPassed = Object.values(returnedValue).every(value => value === true);
  const required = { ...effects, ...(declared.returnedValue.required ? returnedValue : {}) };
  return {
    ...verification,
    observedChecks,
    checks: required,
    passed: effectsPassed && (!declared.returnedValue.required || returnPassed),
    outcomeContract: declared,
    outcomeDimensions: {
      effects: { passed: effectsPassed, checks: effects },
      returnedValue: { required: declared.returnedValue.required, passed: returnPassed, checks: returnedValue },
      ...(declared.incidentalValues ? {incidentalValues:{passed:Object.values(incidental).every(value=>value===true),checks:incidental,incorrectReturns:((verification.incorrectReturnValues as {definition:{name:string;source:string};required?:boolean;value:unknown}[]|undefined) ?? []).map(item=>{const valueJson=JSON.stringify(item.value);return {definition:item.definition,required:item.required!==false,valueJson,sha256:sha256HexSyncText(valueJson)};})}} : {}),
    },
  };
}
