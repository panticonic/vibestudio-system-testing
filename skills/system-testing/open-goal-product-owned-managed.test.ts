import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prepareGoogleRunbook, prepareNewsEditionReview } from "./open-goal-product-owned-managed.js";
import {googleRunbookWorlds} from "./open-goal-product-owned-worlds.js";

vi.mock("@workspace/runtime", () => ({ contextId: "owned", fs: {}, vcs: {} }));
vi.mock("@vibestudio/content-addressing", () => ({
  sha256HexSyncText: (text: string) => createHash("sha256").update(text).digest("hex"),
}));
vi.mock("@workspace-skills/scratch-handoff-bindings", () => ({ bindScratchHandoff: () => ({}) }));
vi.mock("@workspace-skills/visualize/render", () => ({ renderComponent: () => ({}) }));
vi.mock("./open-goal-news-evidence-managed.js", () => ({ prepareOpenNewsEvidenceWorld: vi.fn() }));

const input = { contextId: "owned", caseId: "assigned" };
function workspace() {
  const files = new Map<string, string>();
  return {
    contextId: input.contextId,
    status: async () => ({ mainEventId: "unchanged" }),
    fs: {
      mkdtemp: async (label: string) => "/scratch/" + label,
      writeFile: async (path: string, text: string) => void files.set(path, text),
      readFile: async (path: string) => files.get(path),
      rename:async (from:string,to:string)=>{files.set(to,files.get(from)!);files.delete(from);},
    },
  } as never;
}

it("requires semantic review of actual runbook edits while allowing equivalent field wording",async()=>{
 const world=googleRunbookWorlds.find(world=>world.action==="revise")!;
 const selection={calendarId:"operations",eventId:"ramp-shift-brief",startsAt:"2026-10-22T10:30:00Z",description:"Venue: North safety bay"};
 const review={decision:{selection}};
 const calendar={services:{},verify:async()=>({passed:true}),verifyObserved:async()=>({passed:true,handoff:null,readback:{observed:{status:"current",record:selection}}})};
 const prepared=await prepareGoogleRunbook({...input,caseId:world.id},world,calendar as never,workspace());
 const first=await prepared.services.googleRunbook.read();
 const target=first.documents.find(document=>document.path==="operations-runbook.md")!;
 const initialProposal=world.after.replace("Start:","Time:");
 expect((await prepared.services.googleRunbook.apply(review as never,{...target,text:initialProposal})).status).toBe("changed");
 expect((await prepared.services.googleRunbook.apply(review as never,{...target,text:initialProposal})).status).toBe("changed");
 const fresh=(await prepared.services.googleRunbook.read()).documents.find(document=>document.path===target.path)!;
 const alternative=initialProposal+fresh.text.slice(world.before.length);
 const write=await prepared.services.googleRunbook.apply(review as never,{...fresh,text:alternative});
 const proof=await prepared.verify({decision:{action:"revise",path:target.path,approval:"APP-RAMP",reason:"Approved time and venue"},attribution:null,write});
 expect(proof.checks.exact_runbook_result).toBe(true);
 expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.semanticReviewInput?.actual.documentEdits[0]?.retainedText).toBe(alternative);
 expect(alternative).not.toBe(world.after+(world.coedit??""));
});

it("rejects an incomplete News edition while retaining the native workspace checks", async () => {
  const verify = vi.fn(() => ({ passed: false }));
  const prepared = await prepareNewsEditionReview(input, {
    id: input.caseId, goal: "report the selected edition", title: "Current edition",
    news: { topic: "service changes" }, grant: "read-only", format: "brief",
    facts: [], action: "hold", spec: {},
  } as never, {} as never, workspace(), async () => ({ services: {}, verifyObserved:verify, referenceEvidence:async()=>null }) as never);
  for (const outcome of [{}, { news: { handoff: null } }]) {
    const result = await prepared.verify(outcome);
    expect(result.checks).toMatchObject({
      current_news_edition: false,
      preserved_workspace: true,
    });
    expect(result.outcomeDimensions.incidentalValues?.checks.exact_basis_attribution).toBe(false);
    expect(result.passed).toBe(false);
  }
  expect(verify).toHaveBeenCalledTimes(2);
});

it("rejects an incomplete runbook report without reading missing decision or Calendar fields", async () => {
  const verify = vi.fn();
  const prepared = await prepareGoogleRunbook(input, {
    id: input.caseId, goal: "check the runbook", before: "current notes", approval: "APP-REVIEW",
    authorization: "read only", action: "held", requestedReturnRequired:true,
  } as never, { services: {}, verify, verifyObserved:async()=>({passed:false,handoff:null,readback:null}) } as never, workspace());
  const result = await prepared.verify({});
  expect(result.checks).toMatchObject({
    current_calendar: false,
    runbook_authority: false,
    preserved_workspace: true,
  });
  expect(result.outcomeDimensions.incidentalValues?.checks.exact_basis_attribution).toBe(false);
  expect(result.passed).toBe(false);
  expect(verify).not.toHaveBeenCalled();
});

it("permits fresh-version runbook improvements without a private size/one-write quota while refusing protected edits",async()=>{
 const world=googleRunbookWorlds.find(w=>w.id==="google-runbook-winter-kit-handoff")!;
 const selection={calendarId:"operations",eventId:"winter-kit-handoff",startsAt:"2026-10-22T10:00:00Z",description:"Venue: Supply annex"};
 const review={decision:{selection}};const calendar={services:{},verify:async()=>({passed:true}),verifyObserved:async()=>({passed:true,handoff:null,readback:{observed:{status:"current",record:selection}}})};
 const p=await prepareGoogleRunbook({...input,caseId:world.id},world,calendar as never,workspace());
 let current=(await p.services.googleRunbook.read()).documents.find(d=>d.path==="operations-runbook.md")!;
 const outside={...current,text:world.after.replace("signed checklist","unapproved deletion")};
 expect((await p.services.googleRunbook.apply(review as never,outside)).status).toBe("held");
 expect((await p.services.googleRunbook.read()).documents.find(d=>d.path===current.path)?.text).toBe(world.before);
 const first=await p.services.googleRunbook.apply(review as never,{...current,text:world.after});expect(first.status).toBe("written");
 const stale=current;current=(await p.services.googleRunbook.read()).documents.find(d=>d.path===current.path)!;
 const text=world.after.replace("Venue:"," ".repeat(17000)+"Venue:");
 expect((await p.services.googleRunbook.apply(review as never,{...current,text})).status).toBe("written");
 expect((await p.services.googleRunbook.apply(review as never,{...stale,text:world.after})).status).toBe("changed");
 expect((await p.services.googleRunbook.read()).documents.find(d=>d.path===current.path)?.text).toBe(text);
});
it("reviews query native facts without private action/approval echoes and excludes optional report copies",async()=>{
 const world=googleRunbookWorlds.find(w=>w.id==="google-runbook-projector-unload")!;const calendar={services:{},verify:async()=>({passed:true}),verifyObserved:async()=>({passed:true,handoff:null,readback:{observed:{status:"current",record:null}}})};
 const p=await prepareGoogleRunbook({...input,caseId:world.id},world,calendar as never,workspace());await p.services.googleRunbook.read();
 const value={decision:{action:"review-only",path:null,approval:null,reason:"The runbook retains10:00 UTC while the actual appointment is10:45 UTC at Dock B."},write:null,attribution:null};
 const proof=await p.verify(value);expect(proof.checks.runbook_authority).toBe(true);expect(proof.outcomeDimensions.incidentalValues?.checks.exact_basis_attribution).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput?.actual.requestedReturn).toEqual(value);expect(proof.semanticReviewInput?.actual.observations.productReview).not.toHaveProperty("report");
 expect((await p.verify(undefined)).checks.runbook_authority).toBe(false);
});
