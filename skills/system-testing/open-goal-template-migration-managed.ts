import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {migrationReviewGuidance} from "./native-domain-review.js";
import type {ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome = bindObservedContentReview(
  ["journal", "observations", "readIds", "nativePrepared", "protectedMain"],
  ["handoff", "receiptText"],
);
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import {
  compareUtf16CodeUnits,
  sha256HexSyncText,
  stableSha256Hex,
} from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { TemplatesClient } from "@vibestudio/service-schemas/templates";
import type {
  RuntimeFs,
  VcsClient,
  rpc as RuntimeRpc,
} from "@workspace/runtime";
import { bindTemplateCandidate } from "@workspace-skills/template-candidate-bindings";
import type {
  CandidateOffer,
  CandidateReport,
  CandidateRequest,
  CandidateState,
  MigrationHandoff,
  MigrationObservation,
  MigrationRead,
  MigrationReport,
  MigrationStatus,
  StageReceipt,
} from "../template-candidate/types.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import {
  openTemplateMigrationWorlds,
  type OpenTemplateMigrationWorld,
} from "./open-goal-template-migration-worlds.js";

type Templates = Pick<
  TemplatesClient,
  "updateStatus" | "prepareUpdate" | "reviewUpdate"
>;
type Native = Templates & {
  checkUpdates(): ReturnType<Templates["updateStatus"]>;
};
type Ports = {
  contextId: string;
  fs: RuntimeFs;
  vcs: Pick<VcsClient, "status" | "importSnapshot">;
  rpc: Pick<typeof RuntimeRpc, "call">;
  templates: Native;
};
type State = Awaited<ReturnType<VcsClient["status"]>>["workingHead"];
type Journal = {
  service: string;
  method: string;
  args: unknown[];
  result: unknown;
};
const examples =
  "git+https://github.com/panticonic/vibestudio-template-examples.git";
const maximumReceipt = 32 * 1024;
const encoder = new TextEncoder();

export async function prepareOpenTemplateMigration(
  input: { contextId: string; caseId: string },
  ports: Ports,
  worlds: readonly OpenTemplateMigrationWorld[] = openTemplateMigrationWorlds,
) {
  const world = worlds.find(({ id }) => id === input.caseId);
  if (!world || input.contextId !== ports.contextId)
    throw new Error("Unknown owned template migration dossier");
  const { contextId } = input;
  const { fs, vcs, rpc, templates } = ports;
  const scope = crypto.randomUUID();
  const repoPath = "projects/template-migration-" + scope.slice(0, 12);
  const initial = await vcs.status({ contextId });
  const discovered = await templates.checkUpdates();
  const assigned = discovered.checks.filter(
    (check) => check.source.url === examples,
  );
  if (
    assigned.length !== 1 ||
    !assigned[0] ||
    (world.authority && assigned[0].status !== "available")
  )
    throw new Error(
      "The installed workspace does not expose the exact Examples template offer",
    );
  const offer = assigned[0];
  const descriptors = world.records.map(({ id, kind, title }) => ({
    id,
    kind,
    title,
  }));
  function instantiate(text: string) {
    return text
      .replaceAll("{{installed}}", offer.source.commit)
      .replaceAll("{{incoming}}", offer.target?.commit ?? offer.source.commit)
      .replaceAll("{{main}}", initial.mainEventId);
  }
  const contents = new Map(
    world.records.map(({ id, text }) => [id, instantiate(text)]),
  );
  let repositoryId: string;
  let ownershipHead: State;
  let moved = false;

  async function seed(workingHead: State, label: string) {
    const files = await Promise.all(
      [...contents]
        .map(([id, text]) => ({ path: id + ".md", text }))
        .sort((left, right) => compareUtf16CodeUnits(left.path, right.path))
        .map(async ({ path, text }) => {
          const blob = await rpc.call(
            "main",
            mainRpcMethods["blobstore.putText"],
            [text],
          );
          if (blob.digest !== sha256HexSyncText(text))
            throw new Error("Template dossier blob changed");
          return { path, mode: 0o644, contentHash: blob.digest };
        }),
    );
    const created = await vcs.importSnapshot({
      contextId,
      expectedWorkingHead: workingHead,
      commandId: "template-migration:" + scope + ":" + label,
      source: {
        kind: "generated",
        uri: "system-test://template-migration/" + scope,
        snapshotRevision: stableSha256Hex(files),
      },
      repositories: [
        { repoPath, ...(repositoryId ? { repositoryId } : {}), files },
      ],
      intentSummary: "Record owned migration evidence",
      message: "Store private release dossier snapshot",
    });
    const next = { kind: "event", eventId: created.eventId } as const;
    const repo = await rpc.call(
      "main",
      mainRpcMethods["vcs.resolveRepository"],
      [{ state: next, repoPath }],
    );
    if (
      !repo ||
      repo.repoPath !== repoPath ||
      !isDeepStrictEqual(repo.state, next) ||
      created.importedRepositoryIds.length !== 1 ||
      created.importedRepositoryIds[0] !== repo.repositoryId ||
      (repositoryId && repositoryId !== repo.repositoryId)
    )
      throw new Error("Template dossier ownership was not retained");
    repositoryId = repo.repositoryId;
    ownershipHead = next;
  }

  await seed(initial.workingHead, "reviewed");
  const directory = await fs.mkdtemp("template-migration");
  const receiptPath = directory + "/migration.json";
  const journal: Journal[] = [];
  const observations: MigrationObservation[] = [];
  const liveReads = new Map<string, MigrationRead>();
  let observedRevision: string | undefined;
  let decisionBasis: CandidateRequest | null = null;
  let candidateBinding: ReturnType<typeof bindTemplateCandidate> | null = null;
  let offerReceipt: CandidateOffer | null = null;
  let prepareReceipt: StageReceipt | null = null;
  let candidateReadback: CandidateState | null = null;
  let handoff: MigrationHandoff | null = null;
  let writingHandoff = false;
  const events = { lostRead: 0, templatePreparations: 0, handoffs: 0 };

  function log<T>(
    service: string,
    method: string,
    args: unknown[],
    result: T,
  ): T {
    journal.push(structuredClone({ service, method, args, result }));
    return result;
  }
  const migration = <T>(method: string, args: unknown[], result: T) =>
    log("templateMigration", method, args, result);

  function projectTemplates(
    status: Awaited<ReturnType<Templates["updateStatus"]>>,
  ) {
    return status.checks
      .map((check) => ({
        source: check.source.url,
        installed: check.source.commit,
        incoming: check.target?.commit ?? null,
        status: check.status,
        minimumAppVersion: check.targetMinimumAppVersion ?? null,
      }))
      .sort((left, right) => left.source.localeCompare(right.source));
  }
  async function stillOwned(revision: string) {
    const status = await vcs.status({ contextId });
    return (
      status.mainEventId === initial.mainEventId &&
      isDeepStrictEqual(status.workingHead, ownershipHead) &&
      JSON.stringify(status.workingHead) === revision
    );
  }
  async function atHead(id: string): Promise<MigrationRead | null> {
    const read = await rpc.call("main", mainRpcMethods["vcs.readFile"], [
      {
        state: ownershipHead,
        repositoryId,
        file: { kind: "path", path: id + ".md" },
      },
    ]);
    if (
      !read ||
      read.repositoryId !== repositoryId ||
      read.path !== id + ".md" ||
      read.content.kind !== "text" ||
      sha256HexSyncText(read.content.text) !== read.contentHash
    )
      return null;
    return { id, text: read.content.text, sha256: read.contentHash };
  }

  const services = {
    templateMigration: {
      async discover() {
        const status = await vcs.status({ contextId });
        if (
          status.mainEventId !== initial.mainEventId ||
          !isDeepStrictEqual(status.workingHead, ownershipHead)
        )
          throw new Error(
            "The protected source or owned dossier moved outside the exercise",
          );
        const now = await templates.updateStatus();
        observedRevision = JSON.stringify(status.workingHead);
        const observed = {
          mainEvent: status.mainEventId,
          revision: observedRevision,
          appVersion: now.workspaceAppVersion,
          templates: projectTemplates(now),
          records: descriptors,
        };
        observations.push(structuredClone(observed));
        return migration("discover", [], observed);
      },
      async read(revision: string, ids: string[]) {
        const done = (result: MigrationRead[] | null) =>
          migration("read", [revision, ids], result);
        if (
          revision !== observedRevision ||
          !ids.length ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !contents.has(id)) ||
          !(await stillOwned(revision))
        )
          return done(null);
        if (world.movement && !moved) {
          contents.set(world.movement.record, instantiate(world.movement.text));
          await seed(ownershipHead, "steward-revision");
          liveReads.clear();
          moved = true;
          events.lostRead++;
          return done(null);
        }
        const rows = await Promise.all(ids.map(atHead));
        if (!(await stillOwned(revision)) || rows.some((row) => row === null))
          return done(null);
        const exact = rows.filter((row) => row !== null);
        for (const row of exact) liveReads.set(row.id, row);
        return done(exact);
      },
      async authorizeStage(revision: string, candidateId: string) {
        const done = (result: CandidateRequest | null) =>
          migration("authorizeStage", [revision, candidateId], result);
        if (
          !world.authority ||
          candidateBinding ||
          candidateId !== world.authority.candidateId ||
          revision !== observedRevision ||
          !liveReads.has(candidateId) ||
          !liveReads.has(world.authority.approvalId) ||
          !(await stillOwned(revision))
        )
          return done(null);
        // Match the exact offer just observed, then let the installed binder
        // perform its own fresh admission on the same native source.
        const offerNow = observations
          .at(-1)
          ?.templates.find((row) => row.source === examples);
        if (
          !offerNow ||
          offerNow.status !== "available" ||
          !offerNow.incoming ||
          offerNow.installed !== offer.source.commit ||
          offerNow.incoming !== offer.target?.commit
        )
          return done(null);
        const request: CandidateRequest = {
          goal: world.goal,
          intent: "stage",
          sourceUrl: examples,
          installedCommit: offerNow.installed,
          incomingCommit: offerNow.incoming,
          checkedAfterMs: offer.checkedAt,
          commandId: scope,
        };
        candidateBinding = bindTemplateCandidate(
          templates,
          async () => (await vcs.status({ contextId })).mainEventId,
          request,
        );
        decisionBasis = request;
        return done(request);
      },
      async stageHandoff(
        revision: string,
        candidateId: string | null,
        status: MigrationStatus,
        recipient: string,
      ) {
        const done = (result: MigrationHandoff | null) =>
          migration(
            "stageHandoff",
            [revision, candidateId, status, recipient],
            result,
          );
        if (
          !world.handoff ||
          handoff ||
          writingHandoff ||
          candidateId !== world.handoff.candidateId ||
          recipient !== world.handoff.recipient ||
          revision !== observedRevision ||
          (world.authority && !candidateReadback) ||
          !(await stillOwned(revision))
        )
          return done(null);
        writingHandoff = true;
        try {
          const payload = JSON.stringify({
            recipient,
            candidateId,
            status,
            mainEvent: initial.mainEventId,
            dossierRevision: revision,
            deployedPin: offer.source.commit,
            sources: [...liveReads.values()]
              .map(({ id, sha256 }) => ({ id, sha256 }))
              .sort((a, b) => a.id.localeCompare(b.id)),
            nativeCandidate: candidateReadback?.review ?? null,
          });
          await fs.writeFile(receiptPath, payload);
          const bytes = await readWorkspaceBytes(
            rpc,
            receiptPath,
            maximumReceipt,
          );
          if (
            new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== payload
          )
            throw new Error(
              "The local migration handoff did not retain exact bytes",
            );
          handoff = {
            path: receiptPath,
            sha256: sha256HexSyncText(payload),
            bytes: bytes.length,
          };
          events.handoffs++;
          return done(handoff);
        } finally {
          writingHandoff = false;
        }
      },
    },
    templateOffer: {
      async read() {
        offerReceipt = (await candidateBinding?.templateOffer.read()) ?? null;
        return log("templateOffer", "read", [], offerReceipt);
      },
    },
    templateCandidatePrepare: {
      async prepare() {
        const result: StageReceipt = candidateBinding
          ? await candidateBinding.templateCandidatePrepare.prepare()
          : { outcome: "offer-changed", review: null };
        if (candidateBinding && prepareReceipt === null) {
          prepareReceipt = result;
          events.templatePreparations++;
        }
        return log("templateCandidatePrepare", "prepare", [], result);
      },
    },
    templateCandidateReview: {
      async read() {
        candidateReadback =
          (await candidateBinding?.templateCandidateReview.read()) ?? null;
        return log("templateCandidateReview", "read", [], candidateReadback);
      },
    },
  };

  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["exactMigrationDisposition"],"rootPath":["status"],"producerSourceSuffix":"reviewTemplateMigration/decideMigration.nl","producerPath":["status"]},{"checks":["exactMigrationDisposition"],"rootPath":["answer"],"producerSourceSuffix":"reviewTemplateMigration/decideMigration.nl","producerPath":["answer"]},{"checks":["exactMigrationDisposition"],"rootPath":["candidateId"],"producerSourceSuffix":"reviewTemplateMigration/decideMigration.nl","producerPath":["candidateId"]},{"checks":["exactMigrationDisposition"],"rootPath":["status"],"producerSourceSuffix":"reviewTemplateMigration/finishMigration.nl","producerPath":["status"]},{"checks":["exactMigrationDisposition"],"rootPath":["answer"],"producerSourceSuffix":"reviewTemplateMigration/finishMigration.nl","producerPath":["answer"]},{"checks":["exactMigrationDisposition"],"rootPath":["candidateId"],"producerSourceSuffix":"reviewTemplateMigration/finishMigration.nl","producerPath":["candidateId"]}];
    const replacementObserved=invocation?.calls.some(call=>call.outcome==="done"&&call.definition.source?.endsWith("finishMigration.nl"))??false;
    const contributions=authored.filter(binding=>{
      if(binding.producerSourceSuffix.endsWith(replacementObserved?"decideMigration.nl":"finishMigration.nl"))return false;
      let current:unknown=value;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,value,invocation,contributions);
    assessed.semanticReviewInput.rubric += migrationReviewGuidance;
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(value: unknown, invocation?: InvocationObservations) {
    const wrapper = value as MigrationReport | null;
    const output =
      wrapper;
    const nativeNow = await templates.updateStatus();
    const nativePrepared =
      decisionBasis && prepareReceipt?.outcome === "acknowledged"
        ? await templates.reviewUpdate({ operationId: decisionBasis.commandId })
        : null;
    const expectedRecords = await Promise.all(
      descriptors.map(({ id }) => atHead(id)),
    );
    const expectedReadIds = [...liveReads.keys()];
    const expectedSources = [...liveReads.values()]
      .map(({ id, sha256 }) => ({ id, sha256 }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const actualReceipt = handoff
      ? await readWorkspaceBytes(rpc, receiptPath, maximumReceipt)
      : null;
    const receiptText = actualReceipt
      ? new TextDecoder("utf-8", { fatal: true }).decode(actualReceipt)
      : null;
    const stagedStatus = journal.find(row =>
      row.service === "templateMigration" && row.method === "stageHandoff" &&
      row.result !== null && isDeepStrictEqual(row.result, handoff))?.args[2];
    const expectedReceipt =
      world.handoff &&
      JSON.stringify({
        recipient: world.handoff.recipient,
        candidateId: world.handoff.candidateId,
        // Bind retained bytes to the actual admitted stage call. The meaning
        // of this actor-supplied label is reviewed, never compared to a hidden enum.
        status: stagedStatus,
        mainEvent: initial.mainEventId,
        dossierRevision: observedRevision,
        deployedPin: offer.source.commit,
        sources: expectedSources,
        nativeCandidate: candidateReadback?.review ?? null,
      });
    const after = await vcs.status({ contextId });
    const initialPins = projectTemplates(discovered).map(
      ({ source, installed }) => ({ source, installed }),
    );
    const finalPins = projectTemplates(nativeNow).map(
      ({ source, installed }) => ({ source, installed }),
    );
    const checks = {
      observedExactTemplateDeployment:
        observations.length > 0 &&
        observations.every(
          (row) =>
            row.mainEvent === initial.mainEventId &&
            isDeepStrictEqual(
              row.templates.map(({ source, installed }) => ({
                source,
                installed,
              })),
              initialPins,
            ),
        ),
      readExactOwnedMigrationSources:
        world.expected.reads.every((id) => liveReads.has(id)) &&
        expectedRecords.every(
          (row) =>
            row &&
            row.text === contents.get(row.id) &&
            (!liveReads.has(row.id) ||
              isDeepStrictEqual(row, liveReads.get(row.id))),
        ),
      matchedNativeCandidateOwnership: world.authority
        ? Boolean(
            nativePrepared &&
            decisionBasis &&
            prepareReceipt?.outcome === "acknowledged" &&
            candidateReadback &&
            isDeepStrictEqual(
              candidateReadback.review,
              prepareReceipt.review,
            ) &&
            candidateReadback.mainEventId === initial.mainEventId &&
            nativePrepared.status === "review" &&
            nativePrepared.contextId !== contextId &&
            nativePrepared.contextId === candidateReadback.review.contextId &&
            nativePrepared.mainEventId === initial.mainEventId &&
            nativePrepared.operationId === decisionBasis.commandId &&
            nativePrepared.target.url === examples &&
            nativePrepared.target.commit === decisionBasis.incomingCommit &&
            events.templatePreparations === 1
          )
        : !decisionBasis &&
          events.templatePreparations === 0,
      preservedProtectedTemplateDeployment:
        after.mainEventId === initial.mainEventId &&
        isDeepStrictEqual(after.workingHead, ownershipHead) &&
        isDeepStrictEqual(finalPins, initialPins),
      honoredChangedDossier: world.movement
        ? moved &&
          events.lostRead === 1 &&
          observations.length >= 2 &&
          observations[0]!.revision !== observations.at(-1)!.revision
        : !moved,
      verifiedLocalMigrationHandoff: world.handoff
        ? events.handoffs === 1 &&
          Boolean(
            handoff &&
            actualReceipt &&
            receiptText === expectedReceipt &&
            handoff.sha256 === sha256HexSyncText(receiptText) &&
            handoff.bytes === actualReceipt.length,
          )
        : events.handoffs === 0 &&
          !(await fs.readdir(directory)).includes("migration.json"),
      // The goal requires an accurate domain answer, not a hidden enum, ID
      // echo or fixture vocabulary. Mandatory source-bound content review below
      // establishes its meaning against actual native observations and artifacts.
      exactMigrationDisposition:
        !world.requestedAnswerRequired || typeof output?.answer === "string" && output.answer.trim().length > 0,
    };
    return {
      outcomeContract:{effects:{checks:["observedExactTemplateDeployment", "readExactOwnedMigrationSources", "matchedNativeCandidateOwnership", "preservedProtectedTemplateDeployment", "honoredChangedDossier", "verifiedLocalMigrationHandoff"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["exactMigrationDisposition"],required:world.requestedAnswerRequired,rationale:"The unchanged user goal explicitly determines whether a separate answer is required; successful native effects never replace a requested explanation, while effect-only goals do not require incidental report echoes."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],

      contextId,
      caseId: input.caseId,
      goal: world.goal,
      checks,
      journal,
      observations,
      readIds: expectedReadIds,
      nativePrepared,
      protectedMain: after.mainEventId,
      handoff,
      receiptText,
      passed: Object.values(checks).every(Boolean),
    };
  }

  return {
    services,
    verify,
    async qualify() {
      let live = await services.templateMigration.discover();
      const rejectedSourceAlias =
        (await services.templateMigration.read(live.revision, [
          "./" + world.expected.reads[0],
        ])) === null;
      let rejectedStale =
        (await services.templateMigration.read(
          "prior-dossier",
          world.expected.reads,
        )) === null;
      let reads = await services.templateMigration.read(
        live.revision,
        world.expected.reads,
      );
      if (!reads) {
        const retired = live.revision;
        live = await services.templateMigration.discover();
        rejectedStale &&=
          (await services.templateMigration.read(
            retired,
            world.expected.reads,
          )) === null;
        reads = await services.templateMigration.read(
          live.revision,
          world.expected.reads,
        );
      }
      if (!reads)
        throw new Error("The assigned migration record did not recover");
      const rejectedAlias =
        rejectedSourceAlias &&
        (await services.templateMigration.authorizeStage(
          live.revision,
          "./" + world.expected.candidateId,
        )) === null;
      let candidate: CandidateReport | null = null;
      if (world.authority) {
        const request = await services.templateMigration.authorizeStage(
          live.revision,
          world.authority.candidateId,
        );
        if (!request)
          throw new Error("The reference native candidate was not authorized");
        const offer = await services.templateOffer.read();
        await services.templateCandidatePrepare.prepare();
        const settled = await services.templateCandidateReview.read();
        if (!settled)
          throw new Error("The reference native candidate did not read back");
        candidate = {
          status: settled.review.conflicts.length
            ? "resolve-conflicts"
            : "validate-candidate",
          offer,
          operationId: request.commandId,
          candidate: settled.review,
        };
      }
      const rejectedWrongRecipient =
        (await services.templateMigration.stageHandoff(
          live.revision,
          world.expected.candidateId,
          world.expected.status,
          "Another owner",
        )) === null;
      const local = world.handoff
        ? await services.templateMigration.stageHandoff(
            live.revision,
            world.handoff.candidateId,
            world.expected.status,
            world.handoff.recipient,
          )
        : null;
      const report: MigrationReport = {
        status: world.expected.status,
        candidateId: world.expected.candidateId,
        handoff: local,
        answer: world.expected.facts.join(" · "),
      };
      const envelope = report;
      const result = await verify(envelope);
      const rejectedForeignCandidateAuthority =
        (await services.templateMigration.authorizeStage(live.revision, "unowned-native-candidate")) === null;
      const rejectedMissingRequestedAnswer = !world.requestedAnswerRequired || !(
        await verify({ ...report, answer: "" })
      ).outcomeDimensions.returnedValue.passed;
      return assessNativeQualification({
        ...result,outcomeContract:{...result.outcomeContract,effects:{...result.outcomeContract.effects,checks:[...result.outcomeContract.effects.checks,"rejectedAlias","rejectedStale","rejectedWrongRecipient","rejectedForeignCandidateAuthority","rejectedMissingRequestedAnswer"]}},
        checks: {
          ...result.checks,
          rejectedAlias,
          rejectedStale,
          rejectedWrongRecipient,
          rejectedForeignCandidateAuthority,
          rejectedMissingRequestedAnswer,
        },
        passed:
          result.passed &&
          rejectedAlias &&
          rejectedStale &&
          rejectedWrongRecipient &&
          rejectedForeignCandidateAuthority &&
          rejectedMissingRequestedAnswer,
      });
    },
  };
}
