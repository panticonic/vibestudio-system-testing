import { expect, it } from "vitest";
import { sameEvidenceMembers, includesEvidence } from "./semantic-evidence.js";
it("requires all exact evidence while accepting another observation order and repeats",()=>{
  const a={name:"a",version:"one"},b={name:"b",version:"two"};
  expect(sameEvidenceMembers([b,a,b],[a,b])).toBe(true);
  expect(sameEvidenceMembers([a],[a,b])).toBe(false);
  expect(sameEvidenceMembers([a,{...b,version:"invented"}],[a,b])).toBe(false);
  expect(sameEvidenceMembers([a,b,{name:"foreign"}],[a,b])).toBe(false);
});

it("joins the requested current native value without constraining other observations",()=>{
  const current={id:"owned",revision:"current",value:"answer"};
  expect(includesEvidence([{id:"other-owned"},current,current],current)).toBe(true);
  expect(includesEvidence([{...current,revision:"stale"}],current)).toBe(false);
  expect(includesEvidence([{...current,id:"foreign"}],current)).toBe(false);
  expect(includesEvidence([{...current,value:"invented"}],current)).toBe(false);
});
