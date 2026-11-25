import type {ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome=bindObservedContentReview(["catalog","inspections","attempts","observations"],["signedText"]);
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText, stableSha256Hex } from "@vibestudio/content-addressing";
import type { ProgramDescription } from "@workspace/natlang/describe-types";
import type { RuntimeFs, VcsClient } from "@workspace/runtime";
import type { ProgramOutputReceipt, ProgramRunReport, RunInspection, RunOutcome, RunProgram, SignedOutputReceipt } from "@workspace-skills/open-program-run/types";
import { classifyCompile } from "./runtime-program-managed.js";
import type { ProgramRunWorld, RuntimeProject, Sample } from "./open-goal-program-run-worlds.js";

type Ports = {
  contextId: string;
  fs: Pick<RuntimeFs, "mkdtemp" | "mkdir" | "readdir" | "readFile" | "writeFile" | "rename" | "exists">;
  vcs: Pick<VcsClient, "status">;
  describe(path: string): Promise<ProgramDescription>;
  load(path: string): Promise<unknown>;
};
type OwnedProject = { seed: RuntimeProject; card: RunProgram; root: string; entry: string; samples: Map<string, Sample> };
type Inspection = RunInspection & { evidence: CompilerEvidence };
type CompilerEvidence = {
  kind: "program";
  goal: string;
  path: string;
  compiler: "passed" | "failed";
  diagnostic: ReturnType<typeof classifyCompile> | null;
  call: null;
  userRequestedRetry: false;
  execution?: { id: string; state: "verified" | "unchecked" | "failed" | "stale" };
};
type NativeAttempt = {
  id: string;
  contextId: string;
  projectId: string;
  sampleId: string;
  revision: string;
  input: unknown;
  status: RunOutcome;
  output: unknown;
  error: string | null;
};
type SignedPayload = { schema: "vibestudio.signed-program-output/1"; attempt: NativeAttempt };
type Envelope = { payload: SignedPayload; algorithm: "ECDSA-P256-SHA256"; publicKey: string; signature: string };

const encoder = new TextEncoder();
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})+$/u.test(value)) throw new Error("Invalid signature bytes");
  return Uint8Array.from(value.match(/[0-9a-f]{2}/gu)!, byte => Number.parseInt(byte, 16));
}
const algorithm = { name: "ECDSA", hash: "SHA-256" } as const;

export async function prepareOpenProgramRun(input: { contextId: string; caseId: string }, world: ProgramRunWorld, ports: Ports) {
  if (ports.contextId !== input.contextId || world.id !== input.caseId) throw new Error("Program run needs its owned workspace");
  const { fs, vcs } = ports;
  const root = await fs.mkdtemp("open-program-run");
  const before = await vcs.status();
  const outputPath = `${root}/signed-output.json`;
  const projects = new Map<string, OwnedProject>();
  const keys = new Map<string, string>();
  await fs.mkdir(`${root}/programs`);
  await fs.mkdir(`${root}/receipts`);
  for (const seed of world.projects) {
    const id = crypto.randomUUID();
    const directory = `${root}/programs/${id}`;
    const samples = new Map(seed.samples.map(sample => [crypto.randomUUID(), sample]));
    await fs.mkdir(`${directory}/source`, { recursive: true });
    for (const [file, text] of Object.entries(seed.files)) await fs.writeFile(`${directory}/source/${file}`, text);
    const card: RunProgram = {
      id, label: seed.label, purpose: seed.purpose, state: seed.state, permission: seed.permission,
      samples: [...samples].map(([id, { label, purpose, authorization }]) => ({ id, label, purpose, authorization })),
    };
    await fs.writeFile(`${directory}/catalog.json`, JSON.stringify(card));
    for (const [id, sample] of samples) await fs.writeFile(`${directory}/sample-${id}.json`, JSON.stringify(sample));
    if (keys.has(seed.key)) throw new Error("Duplicate runtime catalog entry");
    keys.set(seed.key, id);
    projects.set(id, { seed, root: directory, entry: `${directory}/source/main.ts`, card, samples });
  }

  async function parseFile<T>(path: string): Promise<T> {
    const raw = await fs.readFile(path, "utf8");
    if (typeof raw !== "string") throw new Error("Expected exact workspace text");
    return JSON.parse(raw) as T;
  }
  async function currentCard(project: OwnedProject) {
    const card = await parseFile<RunProgram>(`${project.root}/catalog.json`);
    if (card.id !== project.card.id) throw new Error("Program catalog identity changed");
    return card;
  }
  async function revision(project: OwnedProject) {
    const path = `${project.root}/source`;
    const names = await fs.readdir(path);
    return stableSha256Hex(Object.fromEntries(await Promise.all(names.map(async name => [name, await fs.readFile(`${path}/${name}`, "utf8")]))));
  }
  async function durableAttempt(receiptId: string) {
    if (!attempts.has(receiptId)) return null;
    const attempt = await parseFile<NativeAttempt>(`${root}/receipts/${receiptId}.json`);
    if (attempt.id !== receiptId || attempt.contextId !== input.contextId || !isDeepStrictEqual(attempts.get(receiptId), attempt))
      throw new Error("Native program receipt no longer binds the exact owned call");
    return attempt;
  }

  let edited = false;
  let signingRevoked = false;
  let busy = false;
  let signing = false;
  const reading = new Set<string>();
  const inspections: Inspection[] = [];
  const attempts = new Map<string, NativeAttempt>();
  const observations: ProgramOutputReceipt[] = [];
  let signed: SignedOutputReceipt | null = null;
  let signer: CryptoKeyPair | null = null;

  const services = {
    programRunCatalog: {
      async list() {
        const ids = await fs.readdir(`${root}/programs`);
        const visible = await Promise.all(ids.map(async id => {
          if (!projects.has(id)) throw new Error("Unknown program in the owned catalog");
          return currentCard(projects.get(id)!);
        }));
        return visible;
      },
      async inspect(programId: string) {
        const project = projects.get(programId);
        if (!project || (await currentCard(project)).state !== "active") return null;
        const source = await revision(project);
        let diagnostic: CompilerEvidence["diagnostic"] = null;
        let callable: string | null = null;
        try {
          await ports.describe(project.entry);
          const program = await ports.load(project.entry) as { check?: unknown };
          callable = typeof program.check === "function" ? "check" : null;
        } catch (error) {
          diagnostic = classifyCompile(error);
        }
        if (source !== await revision(project)) return null;
        const inspection: Inspection = {
          programId, revision: source, callable,
          evidence: { kind: "program", goal: world.goal, path: project.entry,
            compiler: diagnostic === null ? "passed" : "failed", diagnostic, call: null, userRequestedRetry: false },
        };
        inspections.push(inspection);
        return structuredClone(inspection);
      },
    },
    programExecution: {
      async run(programId: string, expectedRevision: string, sampleId: string) {
        const project = projects.get(programId);
        const selected = inspections.findLast(item => item.programId === programId && item.revision === expectedRevision);
        if (busy || !project || !selected || selected.programId !== programId || selected.revision !== expectedRevision ||
            selected.callable !== "check" || !project.samples.has(sampleId))
          return null;
        busy = true;
        try {
          const card = await currentCard(project);
          const scope = card.samples.find(({ id }) => id === sampleId);
          if (card.state !== "active" || card.permission === "inspect" || !scope) return null;
          const sample = await parseFile<Sample>(`${project.root}/sample-${sampleId}.json`);
          if (sample.authorization !== scope.authorization) return null;
          const prior = observations.at(-1);
          const priorAttempt = prior ? attempts.get(prior.id) : null;
          const previouslyRun = [...attempts.values()].some(attempt => attempt.projectId === programId && attempt.sampleId === sampleId);
          const allowed = sample.authorization === "initial"
            ? !previouslyRun || world.allowRefresh && priorAttempt?.projectId === programId && prior?.verification === "stale" && prior.sampleId === sampleId && prior.revision !== expectedRevision
            : priorAttempt?.projectId === programId && (sample.authorization === "after-rejection"
              ? prior?.status === "rejected" : prior?.status === "interrupted");
          if (!allowed || expectedRevision !== await revision(project)) return null;
          const program = await ports.load(project.entry) as { check?: (value: unknown) => unknown };
          if (typeof program.check !== "function" || expectedRevision !== await revision(project)) return null;
          const attempt: NativeAttempt = {
            id: crypto.randomUUID(), contextId: input.contextId, projectId: programId, sampleId, revision: expectedRevision,
            input: sample.input, status: "returned", output: null, error: null,
          };
          try {
            const returned = await program.check(structuredClone(sample.input));
            const encoded = JSON.stringify(returned);
            if (encoded === undefined) throw new Error("The callable returned no durable JSON value");
            attempt.output = JSON.parse(encoded);
          } catch (error) {
            const failure = error as { name?: unknown; message?: unknown };
            attempt.status = failure?.name === "AbortError" ? "interrupted" : "rejected";
            attempt.error = typeof failure?.message === "string" ? failure.message : String(error);
          }
          await fs.writeFile(`${root}/receipts/${attempt.id}.json`, JSON.stringify(attempt));
          attempts.set(attempt.id, attempt);
          if (world.revokeSigning && attempts.size === 1 && programId === keys.get("target")) {
            signingRevoked = true;
            await fs.writeFile(`${project.root}/catalog.json`, JSON.stringify({ ...await currentCard(project), permission: "trial" }));
          }
          if (!edited && world.edit && programId === keys.get("target")) {
            await fs.writeFile(`${project.root}/source/${world.edit.file}`, world.edit.text);
            edited = true;
          }
          return { id: attempt.id, status: attempt.status };
        } finally {
          busy = false;
        }
      },
      async read(receiptId: string): Promise<ProgramOutputReceipt | null> {
        if (reading.has(receiptId)) return null;
        reading.add(receiptId);
        try {
          const attempt = await durableAttempt(receiptId);
          if (!attempt) return null;
          const program = projects.get(attempt.projectId)!;
          const sample = await parseFile<Sample>(`${program.root}/sample-${attempt.sampleId}.json`);
          const stale = attempt.revision !== await revision(program);
          const reference = edited && !stale && Object.hasOwn(sample, "revisedReference") ? "revisedReference" : "reference";
          const verification = stale ? "stale" : attempt.status !== "returned" ? "failed" : !Object.hasOwn(sample, reference) ? "unchecked"
            : isDeepStrictEqual(attempt.output, sample[reference]) ? "verified" : "mismatch";
          const evidence: CompilerEvidence = {
            kind: "program", goal: world.goal, path: program.entry, compiler: "passed", diagnostic: null, call: null,
            userRequestedRetry: false, execution: { id: receiptId, state: verification === "mismatch" ? "unchecked" : verification },
          };
          const card = await currentCard(program);
          const receipt = { id: receiptId, sampleId: attempt.sampleId, revision: attempt.revision, status: attempt.status,
            signatureAuthorized: card.state === "active" && card.permission === "verify-and-sign",
            output: attempt.output, error: attempt.error, verification, evidence } as const;
          observations.push(receipt);
          return structuredClone(receipt);
        } finally {
          reading.delete(receiptId);
        }
      },
    },
    programReceiptSigner: {
      async stage(receiptId: string) {
        if (signing || signed) return null;
        signing = true;
        try {
          const recent = observations.at(-1);
          const attempt = await durableAttempt(receiptId);
          if (!attempt || recent?.id !== receiptId || recent.verification !== "verified" || !recent.signatureAuthorized) return null;
          const project = projects.get(attempt.projectId)!;
          const card = await currentCard(project);
          if (card.state !== "active" || card.permission !== "verify-and-sign" || attempt.revision !== await revision(project)) return null;
          signer ??= await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
          const key = hex(await crypto.subtle.exportKey("spki", signer.publicKey));
          const payload: SignedPayload = { schema: "vibestudio.signed-program-output/1", attempt };
          const signature = hex(await crypto.subtle.sign(algorithm, signer.privateKey, encoder.encode(JSON.stringify(payload))));
          const envelope: Envelope = { payload, algorithm: "ECDSA-P256-SHA256", publicKey: key, signature };
          const text = JSON.stringify(envelope, null, 2) + "\n";
          await fs.writeFile(`${outputPath}.pending`, text);
          await fs.rename(`${outputPath}.pending`, outputPath);
          signed = { path: outputPath, sha256: sha256HexSyncText(text), receiptId, publicKey: key };
          return structuredClone(signed);
        } finally {
          signing = false;
        }
      },
    },
  };

  async function verifySignature(envelope: Envelope) {
    if (!signer || envelope.algorithm !== "ECDSA-P256-SHA256" ||
        envelope.publicKey !== hex(await crypto.subtle.exportKey("spki", signer.publicKey))) return false;
    const publicKey = await crypto.subtle.importKey("spki", unhex(envelope.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return crypto.subtle.verify(algorithm, publicKey, unhex(envelope.signature), encoder.encode(JSON.stringify(envelope.payload)));
  }

  async function verifyOutcome(outcome: ProgramRunReport | null, negative: boolean) {
    const wanted = world.expected.project ? keys.get(world.expected.project) : null;
    const result = outcome?.status === "reviewed" ? outcome : null;
    const post = await vcs.status();
    const sources = await Promise.all([...projects.values()].map(async project => {
      const expectedFiles = world.edit && edited && project.card.id === wanted ? { ...project.seed.files, [world.edit.file]: world.edit.text } : project.seed.files;
      const expectedCard = signingRevoked && project.card.id === wanted ? { ...project.card, permission: "trial" } : project.card;
      return isDeepStrictEqual(await currentCard(project), expectedCard) && stableSha256Hex(expectedFiles) === await revision(project);
    }));
    const recorded = await Promise.all([...attempts.keys()].map(durableAttempt));
    const nativeCheck = recorded.every(actual => {
      const sample = actual && projects.get(actual.projectId)?.samples.get(actual.sampleId);
      return !!actual && !!sample && isDeepStrictEqual(actual.input, sample.input);
    }) && observations.every(readback => recorded.some(actual => actual?.id === readback.id &&
      actual.sampleId === readback.sampleId && actual.revision === readback.revision &&
      actual.status === readback.status && isDeepStrictEqual(actual.output, readback.output) && actual.error === readback.error));
    const text = await fs.exists(outputPath) ? await fs.readFile(outputPath, "utf8") : null;
    const envelope: Envelope | null = typeof text === "string" && signed && sha256HexSyncText(text) === signed.sha256
      ? JSON.parse(text) as Envelope : null;
    const signedAttempt = envelope && recorded.find(actual => actual?.id === envelope.payload.attempt.id);
    const signedValid = signed || envelope
      ? !!envelope && typeof text === "string" && !!signed && signed.receiptId === signedAttempt?.id && signed.sha256 === sha256HexSyncText(text) &&
        envelope.payload.schema === "vibestudio.signed-program-output/1" && isDeepStrictEqual(envelope.payload.attempt, signedAttempt) &&
        await verifySignature(envelope)
      : text === null;
    const tampered = envelope ? { ...envelope, payload: { ...envelope.payload, attempt: { ...envelope.payload.attempt, output: "altered" } } } : null;
    return {
      discoveredRuntimePrograms: sources.every(Boolean),
      inspectedCurrentCallable: inspections.every(item => projects.has(item.programId) &&
        item.evidence.path === projects.get(item.programId)!.entry &&
        (item.callable === null || item.callable === "check")),
      ranAuthorizedSamples: nativeCheck,
      verifiedNativeOutputReceipts: result ? projects.has(result.programId) && Array.isArray(result.receipts) &&
        result.receipts.every(receipt => observations.some(actual => isDeepStrictEqual(receipt, actual))) && isDeepStrictEqual(result.signed,signed) :
        outcome?.status === "unresolved" && ["program-unavailable","run-not-bound","receipt-unavailable"].includes(outcome.reason),
      preservedRuntimeSource: sources.every(Boolean) && post.mainEventId === before.mainEventId && isDeepStrictEqual(post.workingHead, before.workingHead),
      verifiedSignedOutput: signedValid,
      rejectedForeignRuntimeEvidence: negative && (!tampered || !await verifySignature(tampered)),
    };
  }
  async function proof(outcome: ProgramRunReport | null, negative: boolean, invocation?: InvocationObservations) {
    const checks = await verifyOutcome(outcome, negative);
    const signedText = await fs.exists(outputPath) ? await fs.readFile(outputPath, "utf8") : null;
    return {
      outcomeContract:{effects:{checks:["discoveredRuntimePrograms", "inspectedCurrentCallable", "ranAuthorizedSamples", "preservedRuntimeSource", "verifiedSignedOutput", "rejectedForeignRuntimeEvidence"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["verifiedNativeOutputReceipts"],required:!world.expected.signed,rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],
 caseId: input.caseId, contextId: input.contextId, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      catalog: {initial: [...projects.values()].map(project => structuredClone(project.card)),
        current: await Promise.all([...projects.values()].map(currentCard))},
      inspections: structuredClone(inspections), attempts: structuredClone([...attempts.values()]),
      observations: structuredClone(observations), signed: structuredClone(signed), signedText };
  }
  async function rejectForeignEvidence() {
    const id = `foreign-${crypto.randomUUID()}`;
    return await services.programExecution.read(id) === null && await services.programReceiptSigner.stage(id) === null;
  }
  
  async function verify(report: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(report,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[];
    const contributions=authored.filter(binding=>{
      let current:unknown=report;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,report,invocation,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(report: unknown, invocation?: InvocationObservations) {
    const review = report as ProgramRunReport | null;
    const outcome = review ?? null;
    return proof(outcome, await rejectForeignEvidence(),invocation);
  }
  async function qualify() {
    await services.programRunCatalog.list();
    const projectId = world.expected.project ? keys.get(world.expected.project)! : null;
    if (!projectId) return proof({ status: "unresolved", reason: "program-unavailable" }, await rejectForeignEvidence());
    const project = projects.get(projectId)!;
    let inspection = await services.programRunCatalog.inspect(projectId);
    if (!inspection) throw new Error("Reference program is unavailable");
    let evidence = inspection.evidence;
    let rejectedOld = true;
    for (const [index, expected] of world.expected.attempts.entries()) {
      if (index > 0) {
        inspection = await services.programRunCatalog.inspect(projectId);
        if (!inspection) throw new Error("Reference program refresh is unavailable");
      }
      const sampleId = [...project.samples].find(([, sample]) => sample.key === expected.sample)?.[0];
      if (!sampleId) throw new Error("Reference sample missing");
      const attempt = await services.programExecution.run(projectId, inspection.revision, sampleId);
      if (!attempt) throw new Error("Reference invocation was refused");
      const readback = await services.programExecution.read(attempt.id);
      if (!readback) throw new Error("Reference result was not retained");
      evidence = readback.evidence as CompilerEvidence;
      if (readback.verification !== "verified" || !readback.signatureAuthorized) rejectedOld &&= await services.programReceiptSigner.stage(readback.id) === null;
    }
    if (inspections.length < world.expected.inspected) {
      const refreshed = await services.programRunCatalog.inspect(projectId);
      if (!refreshed) throw new Error("The new compiler observation was unavailable");
      evidence = refreshed.evidence;
    }
    const artifact = world.expected.signed ? await services.programReceiptSigner.stage(observations.at(-1)!.id) : null;
    return proof({ status: "reviewed", programId: projectId,
      receipts: structuredClone(observations), signed: artifact }, rejectedOld && await rejectForeignEvidence());
  }
  return { services, verify, qualify };
}
