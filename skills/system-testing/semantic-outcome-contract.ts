/** Independent requirements of an authored task, separate from its execution trace. */
export type SemanticOutcomeContract = {
  effects: { checks: readonly string[]; rationale: string };
  returnedValue: { checks: readonly string[]; required: boolean; rationale: string };
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
} } {
  // Existing application oracles remain strict until their authored contract
  // identifies independent state checks and any incidental response convention.
  const declared = contract ?? (verification.outcomeContract as SemanticOutcomeContract | undefined) ?? {
    effects: { checks: Object.keys(verification.checks), rationale: "The domain verifier binds the actual application evidence and required returned values." },
    returnedValue: { checks: [], required: true, rationale: "The domain result is part of this task's existing application contract." },
  };
  const names = [...declared.effects.checks, ...declared.returnedValue.checks];
  if (new Set(names).size !== names.length || names.length !== Object.keys(verification.checks).length ||
      names.some(name => !Object.hasOwn(verification.checks, name)) ||
      !declared.effects.rationale.trim() || !declared.returnedValue.rationale.trim())
    throw new Error("The outcome contract must account for every independent application check once");
  const select = (names: readonly string[]) => Object.fromEntries(names.map(name => [name, verification.checks[name]!]));
  const effects = select(declared.effects.checks);
  const returnedValue = select(declared.returnedValue.checks);
  const effectsPassed = Object.values(effects).every(value => value === true);
  const returnPassed = Object.values(returnedValue).every(value => value === true);
  const required = { ...effects, ...(declared.returnedValue.required ? returnedValue : {}) };
  return {
    ...verification,
    checks: required,
    passed: effectsPassed && (!declared.returnedValue.required || returnPassed),
    outcomeContract: declared,
    outcomeDimensions: {
      effects: { passed: effectsPassed, checks: effects },
      returnedValue: { required: declared.returnedValue.required, passed: returnPassed, checks: returnedValue },
    },
  };
}

/** Transitional adapters for existing oracles. These values never enter model context.
 * Delete each case when its domain verifier directly consumes its application type. */
export function applicationVerifierValue(entry: { resultType: string; skill?: string }, actual: unknown): unknown {
  const value = actual as Record<string, unknown> | null;
  switch (entry.resultType) {
    case "ResearchGoalReport": return { status: value?.status, research: actual };
    case "ResearchRevision": return { ...(value?.revision as object | null ?? {}),
      status: (value?.revision as {status?:string}|null)?.status ?? (value?.research as {status?:string}|null)?.status, research: value?.research };
    case "UnitHandoffReport":
    case "WorkspaceEditReport":
    case "BrowserGoalReport":
    case "WorkspaceSuiteReport": return actual;
    case "WorkspaceAnswer": return actual;
    default: return entry.skill
      ? { status: "workspace-skill-reviewed", skill: entry.skill, outcome: actual }
      : actual;
  }
}
