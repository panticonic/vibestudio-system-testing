import type { AgentExecutionTestAuthorityRule } from "@vibestudio/shared/authority/testPolicy";

/** Host-resident test authority is inherited by fixture contexts and native RPCs.
 * Denials precede every case/baseline grant; no provider credential is inspected.
 */
export function nativeReferenceAuthority(nativeReference: boolean, rules: readonly AgentExecutionTestAuthorityRule[]): AgentExecutionTestAuthorityRule[] {
  if (!nativeReference) return [...rules];
  return [
    ...["model.use", "internal-model-runtime.use"].flatMap(capability =>
      (["gated", "critical"] as const).map(tier => ({
        ruleId: `native-reference-deny-${capability}-${tier}`,
        capability: {kind: "exact" as const, key: capability},
        resource: {kind: "prefix" as const, prefix: ""},
        tier, decision: "deny" as const,
      }))),
    ...rules,
  ];
}
