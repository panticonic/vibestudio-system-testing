import {assessObservedApplicationOutcome} from "./observed-application-outcome.js";
import type {SemanticOutcomeContract} from "./semantic-outcome-contract.js";
import type {InvocationObservations} from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { vcs } from "@workspace/runtime";
import { openSpectroliteVault } from "./open-goal-spectrolite-worlds.js";
import { prepareOpenPdfInspection } from "./open-goal-pdf-managed.js";
import { openGoalPdfVaultWorlds, type OpenPdfVaultWorld } from "./open-goal-pdf-vault-worlds.js";

type Input = { contextId: string; caseId: string; panelId: string };
type VaultServices = {
  inspect(): Promise<unknown>;
  follow(target: string, revision: string): Promise<string>;
  revise(revision: string, source: string): Promise<string>;
  evidence(checks: string[]): Promise<unknown>;
};
type VaultVerification = {
  passed: boolean;
  revisionAttempts: { revision: string; outcome: string }[];
  workingFiles: Record<string, unknown>;
};
type PrepareVault = (input: Input, world: OpenPdfVaultWorld["vault"], options: { beforeWrite?: () => Promise<void> }) =>
  Promise<{
    services: { spectroliteGoal: VaultServices };
    verify(value: unknown): Promise<VaultVerification>;
    reference(): Promise<{ outcome: unknown; verification: VaultVerification }>;
  }>;
type Pdf = Awaited<ReturnType<typeof prepareOpenPdfInspection>>;
type Bound = { status: "bound"; source: NonNullable<Awaited<ReturnType<Pdf["attestCitations"]>>>; directive: string };
type Handoff = Bound | { status: "hold"; reason: string };

const hold = (reason: string): Handoff => ({ status: "hold", reason });

export async function prepareOpenPdfVaultGoal(input: Input, prepareVault: PrepareVault) {
  const { contextId, caseId, panelId } = input;
  const scene = openGoalPdfVaultWorlds.find(item => item.id === caseId);
  if (!scene || !panelId) throw new Error("The PDF-backed correction needs the owned vault and attachments.");
  const world = scene;
  const { goal, concurrent } = world;
  const initial = await vcs.status({ contextId });
  const pdf = await prepareOpenPdfInspection(contextId, world.pdf);
  const mayEdit = world.vault.writablePath !== undefined;
  let bound: Bound | undefined;
  let attestedReport: unknown;
  let concurrentReceipt: { previous: unknown; next: unknown; text: string } | undefined;

  async function beforeWrite() {
    if (!concurrent || concurrentReceipt) return;
    const { workingHead } = await vcs.status({ contextId });
    const repository = await vcs.resolveRepository({ state: workingHead, repoPath: openSpectroliteVault });
    if (!repository) throw new Error("The concurrent draft has no owned repository.");
    const file = await vcs.readFile({ state: workingHead, repositoryId: repository.repositoryId, file: { kind: "path", path: concurrent.path } });
    if (!file || file.content.kind !== "text") throw new Error("The concurrent edit has no working document.");
    const at = file.content.text.length;
    const edited = await vcs.edit({ contextId, expectedWorkingHead: workingHead, commandId: `pdf-vault:coedit:${contextId}`,
      changes: [{ kind: "text-edit", repositoryId: repository.repositoryId, fileId: file.fileId,
        edits: [{ start: at, end: at, text: concurrent.append }] }] });
    const read = await vcs.readFile({ state: edited.workingHead, repositoryId: repository.repositoryId, file: { kind: "path", path: concurrent.path } });
    if (!edited.changeIds.length || read?.content?.kind !== "text" || read.content.text !== file.content.text + concurrent.append)
      throw new Error("The concurrent edit could not be read back from its exact workspace head.");
    concurrentReceipt = { previous: workingHead, next: edited.workingHead, text: read.content.text };
  }

  const vault = await prepareVault(input, world.vault, { beforeWrite });
  const vaultService = vault.services.spectroliteGoal;
  function requireBound() {
    if (!bound) throw new Error("Bind the live approved PDF evidence before opening the correction.");
  }
  const services = {
    ...pdf.services,
    pdfVaultBridge: {
      async bind(report: unknown, indices: number[]): Promise<Handoff> {
        const source = await pdf.attestCitations(report, indices);
        if (!source) return hold("The requested lines cannot be attested against the original PDF.");
        if (bound) return isDeepStrictEqual(source,bound.source) ? structuredClone(bound) : hold("This correction already has a different bound source.");
        const citations = source.citations.map(({ page, line, quote }) => ({ page, line, quote }));
        const directive = `${goal}\n\nVerified original attachment and lines:\n${JSON.stringify({ ...source, citations })}\nApply only the requested changes to the latest observed working source. Preserve other text and verify the resulting working revision.`;
        bound = { status: "bound", source, directive };
        attestedReport = structuredClone(report);
        return structuredClone(bound);
      },
    },
    spectroliteGoal: {
      inspect() { return vaultService.inspect(); },
      follow(target: string, revision: string) { return vaultService.follow(target, revision); },
      revise(revision: string, source: string) { requireBound(); return vaultService.revise(revision, source); },
      evidence(checks: string[]) { return vaultService.evidence(checks); },
    },
  };

  async function verify(value: unknown,invocation?:InvocationObservations) {
    const wrapper = value as {source:Bound["source"]|null;holdReason:string|null;vault:unknown}|null;
    const result = wrapper;
    const pdfResult = await pdf.verifyObserved({ allowWorkingHeadChange: mayEdit });
    const vaultResult = mayEdit ? await vault.verify(result?.vault) : null;
    const after = await vcs.status({ contextId });
    const expectedQuotes = world.pdf.expected.text?.quotes ?? [];
    const selectedQuotes = bound?.source?.citations?.map(({ page, quote }) => ({ page, text: quote }));
    const attempts = vaultResult?.revisionAttempts ?? [];
    const coedited = concurrent && vaultResult?.workingFiles[concurrent.path];
    const reason = typeof result?.holdReason === "string" ? result.holdReason.trim().toLowerCase() : "";
    const checks = {
      exactOriginalPdf: pdfResult.passed,
      nativePdfHandoff: mayEdit ? !!bound&&!!attestedReport&&bound.source.document===world.pdf.expected.document&&isDeepStrictEqual(selectedQuotes,expectedQuotes):!bound&&pdfResult.passed,
      verifiedHandoff:mayEdit?result?.holdReason===null&&isDeepStrictEqual(result?.source,bound?.source):result?.source===null&&result?.vault===null&&reason.length>0,
      returnedVaultFindings:mayEdit?vaultResult?.outcomeDimensions.returnedValue.passed===true:true,
      exactWorkingVault: mayEdit ? vaultResult?.outcomeDimensions.effects.passed === true
        : isDeepStrictEqual(initial.workingHead, after.workingHead),
      concurrentRevision: concurrent ? !!concurrentReceipt && !isDeepStrictEqual(concurrentReceipt.previous, concurrentReceipt.next) &&
        vaultResult?.outcomeDimensions.effects.passed === true && typeof coedited === "string" && coedited.includes(concurrent.append)
        : !concurrentReceipt && (mayEdit ? attempts.some(attempt => attempt.outcome === "written") : attempts.length === 0),
      protectedHeads: initial.mainEventId === after.mainEventId && isDeepStrictEqual(initial.committed, after.committed),
    };
    const contract:SemanticOutcomeContract={effects:{checks:["exactOriginalPdf", "nativePdfHandoff", "exactWorkingVault", "concurrentRevision", "protectedHeads"],rationale:"Independent native observations, exact authority and persisted state establish application effects."},returnedValue:{checks:["verifiedHandoff", "returnedVaultFindings"],required:!mayEdit,rationale:"Requested findings and verified result handles are required for query goals; completed mutation effects stand independently."},incidentalValues:{checks:[],rationale:"Returned receipt presentation is optional; actual artifacts and receipts are verified from native state."}};
    return assessObservedApplicationOutcome({ passed: Object.values(checks).every(Boolean), checks, contextId, caseId, panelId, goal,
      proof: { pdf: pdfResult, handoff: bound ?? null, vault: vaultResult, concurrent: concurrentReceipt ?? null } },contract,value,invocation,[{"checks":["verifiedHandoff"],"rootPath":["source"],"producerSourceSuffix":"authorizePdfVaultHandoff.nl","producerPath":["source"]},{"checks":["verifiedHandoff"],"rootPath":["holdReason"],"producerSourceSuffix":"authorizePdfVaultHandoff.nl","producerPath":["reason"]}]);
  }

  async function qualify() {
    const reference = await pdf.reference();
    const quoteIndices = reference.outcome.text?.citations?.map((_, index) => index) ?? [];
    const forged = structuredClone(reference.outcome);
    const quotation = forged.text?.citations[0];
    if (quotation) quotation.quote += " Altered.";
    const rejectsForgedQuotation = (await services.pdfVaultBridge.bind(forged, quoteIndices)).status === "hold";
    let rejectsPrematureVaultMutation = false;
    try { await services.spectroliteGoal.revise("unbound", "unapproved source"); }
    catch (error) { rejectsPrematureVaultMutation = error instanceof Error && error.message.includes("approved PDF evidence"); }
    const handoff = mayEdit ? await services.pdfVaultBridge.bind(reference.outcome, quoteIndices)
      : hold(`Missing approved page ${world.pdf.expected.missing?.join(", ")}.`);
    if (mayEdit && handoff.status !== "bound") throw new Error("The reference could not attest the approved PDF lines.");
    const outcome = handoff.status === "bound" ? (await vault.reference()).outcome : null;
    const result={source:handoff.status==="bound"?handoff.source:null,holdReason:handoff.status==="hold"?handoff.reason:null,vault:outcome};
    const verified = await verify(result);
    const rejectedInventedSource=!(await verify({...result,source:{document:"invented",digest:"invented",citations:[]}})).outcomeDimensions.returnedValue.passed;
    const checks = { ...verified.checks, exactPdfReference: reference.verification.passed,
      rejectsForgedQuotation, rejectsPrematureVaultMutation,rejectedInventedSource };
    return { ...verified, checks, passed: Object.values(checks).every(Boolean) };
  }

  return { goal, services, verify, qualify };
}
