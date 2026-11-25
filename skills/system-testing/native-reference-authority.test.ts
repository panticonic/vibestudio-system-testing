import {describe,it,expect} from "vitest";
import {nativeReferenceAuthority} from "./native-reference-authority.js";

describe("native reference authority", () => {
 it("denies inference before existing grants while preserving non-model credentials", () => {
  const original = [{ruleId:"baseline",capability:{kind:"prefix" as const,prefix:""},resource:{kind:"prefix" as const,prefix:""},tier:"gated" as const,decision:"once" as const}];
  const policy=nativeReferenceAuthority(true,original);
  for(const capability of ["model.use","internal-model-runtime.use"])
   for(const tier of ["gated","critical"])
    expect(policy.find(rule => (rule.capability.kind==="prefix" || rule.capability.key===capability) && rule.tier===tier)?.decision).toBe("deny");
  expect(policy.at(-1)).toBe(original[0]);expect(original).toHaveLength(1);
  expect(policy.filter(rule=>rule.capability.kind==="exact"&&rule.capability.key==="credential.use")).toHaveLength(0);
 });
 it("preserves ordinary paid test authority and isolates invocation arrays", () => {
  const rules: Parameters<typeof nativeReferenceAuthority>[1]=[];expect(nativeReferenceAuthority(false,rules)).toEqual(rules);expect(nativeReferenceAuthority(false,rules)).not.toBe(rules);
 });
});
