import { expect, it } from "vitest";
import { sameEvidenceMembers } from "./semantic-evidence.js";
it("requires all exact evidence while accepting another observation order and repeats",()=>{
  const a={name:"a",version:"one"},b={name:"b",version:"two"};
  expect(sameEvidenceMembers([b,a,b],[a,b])).toBe(true);
  expect(sameEvidenceMembers([a],[a,b])).toBe(false);
  expect(sameEvidenceMembers([a,{...b,version:"invented"}],[a,b])).toBe(false);
  expect(sameEvidenceMembers([a,b,{name:"foreign"}],[a,b])).toBe(false);
});
