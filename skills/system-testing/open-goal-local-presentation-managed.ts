import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome=bindObservedContentReview(["current","journal","preview","previewDisplay"],["report","display"]);
import type {ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import {
  contextId as runtimeContext,
  fs,
  panelTree,
  vcs,
  type PanelHandle,
} from "@workspace/runtime";
import type { PresentationReport } from "@workspace-skills/visualize/types";
import {
  checkPresentation,
  selectedPresentationViews,
  observePresentation,
  referencePresentation,
} from "./presentation-managed.js";
import type {
  LocalPresentationWorld,
  RecordSeed,
} from "./open-goal-local-presentation-worlds.js";

type Assignment = {
  contextId: string;
  caseId: string;
  panelId: string;
  source: string;
};
type Files = Pick<typeof fs, "mkdtemp" | "readFile" | "writeFile" | "rm">;
type Head = () => Promise<
  Pick<Awaited<ReturnType<typeof vcs.status>>, "mainEventId" | "workingHead">
>;
type Prepared = NonNullable<ReturnType<typeof checkPresentation>>;
type PreviewState = {
  views?: { id: string; mdx: string }[];
  previewRevision?: string;
};
type Source = RecordSeed & { revision: string };
type Receipt = {
  source: string;
  revision: string;
  viewIds: string[];
  mdxDigests: string[];
};
type Preview =
  | { status: "visible"; receipt: Receipt }
  | { status: "changed"; revision: string }
  | { status: "unavailable"; reason: string };
type Journal = {
  service: "presentationRecords";
  method: string;
  args: unknown[];
  result: unknown;
};
type Outcome =
  | { status: "visible"; receipt: Receipt; notes: string[] }
  | { status: "held"; reason: string; revision: string | null };
type Ports = {
  contextId: string | null;
  files: Files;
  getPanel: (id: string) => PanelHandle;
  head: Head;
  observe: typeof observePresentation;
};

function defaultPorts(): Ports {
  return {
    contextId: runtimeContext,
    files: fs,
    getPanel: (id) => panelTree.get(id),
    head: async () => {
      const { mainEventId, workingHead } = await vcs.status();
      return { mainEventId, workingHead };
    },
    observe: observePresentation,
  };
}


export async function prepareOpenLocalPresentation(
  input: Assignment,
  world: LocalPresentationWorld,
  ports = defaultPorts(),
) {
  if (
    ports.contextId !== input.contextId ||
    input.caseId !== world.id ||
    !input.panelId
  )
    throw new Error(
      "Local presentation belongs to a different fixture context",
    );
  const panel = ports.getPanel(input.panelId);
  const initialHead = await ports.head();
  const checkPanel = async () => {
    const bind = await panel.observe();
    if (
      bind.kind !== "workspace" ||
      bind.phase !== "ready" ||
      bind.contextId !== input.contextId ||
      bind.source !== input.source ||
      bind.requestedRef !== "ctx:" + input.contextId ||
      !bind.attemptId ||
      !bind.buildKey
    )
      throw new Error(
        "Local presentation renderer is outside the owned preview",
      );
    return { attemptId: bind.attemptId, buildKey: bind.buildKey };
  };
  const initialPanel = await checkPanel();
  const directory = await ports.files.mkdtemp("local-presentation");
  const close = () =>
    ports.files.rm(directory, { recursive: true, force: true });
  const seeds = new Map(world.sources.map((source) => [source.id, source]));
  const path = (id: string) => {
    if (!seeds.has(id))
      throw new Error("Source record is outside the owned catalogue");
    return directory + "/" + id + ".json";
  };
  const write = (record: RecordSeed) =>
    ports.files.writeFile(path(record.id), JSON.stringify(record));
  try {
    for (const entry of seeds.values()) await write(entry);
  } catch (error) {
    await close();
    throw error;
  }
  async function read(id: string): Promise<Source> {
    const raw = String(await ports.files.readFile(path(id), "utf8"));
    const record = JSON.parse(raw) as RecordSeed;
    if (record.id !== id)
      throw new Error("Retained record identity differs from its owned path");
    return { ...record, revision: sha256HexSyncText(raw) };
  }
  const journal: Journal[] = [];
  const reads = new Map<string, Source>();
  let listed = false;
  let raced = false;
  let writing = false;
  let saved: {
    preview: Receipt;
    report: PresentationReport;
    display: Awaited<ReturnType<typeof observePresentation>>;
  } | null = null;
  const effect = <T>(method: string, args: unknown[], result: T): T => {
    journal.push(
      structuredClone({ service: "presentationRecords", method, args, result }),
    );
    return structuredClone(result);
  };
  const services = {
    presentationRecords: {
      async discover() {
        listed = true;
        const records = await Promise.all([...seeds.keys()].map(read));
        return effect(
          "discover",
          [],
          records.map(({ id, title, desk, period, status }) => ({
            id,
            title,
            desk,
            period,
            status,
          })),
        );
      },
      async read(id: string) {

        const record = await read(id);
        reads.set(id, record);
        return effect("read", [id], record);
      },
      async preview(
        id: string,
        revision: string,
        report: PresentationReport,
      ): Promise<Preview> {
        if (writing || saved)
          throw new Error("Only one preview may reach the owned renderer");
        const basis = reads.get(id);
        if (!basis?.previewAllowed || basis.revision !== revision)
          throw new Error(
            "Preview requires a previously observed and authorized local source revision",
          );
        writing = true;
        const finish = (result: Preview) =>
          effect("preview", [id, revision, report], result);
        try {
          const current = await read(id);
          if (current.revision !== revision)
            return finish({ status: "changed", revision: current.revision });
          if (!raced && world.coedit?.id === id) {
            const { revision: _revision, ...contents } = current;
            await write({ ...contents, sections: world.coedit.sections });
            raced = true;
            return finish({
              status: "changed",
              revision: (await read(id)).revision,
            });
          }
          const selected = selectedPresentationViews(report);
          if (!selected?.length)
            return finish({
              status: "unavailable",
              reason:
                "No canonical renderable view of the retained record was available.",
            });
          const owned = await checkPanel();
          if (!isDeepStrictEqual(owned, initialPanel))
            throw new Error("Preview renderer was replaced");
          await panel.stateArgs.patch({
            previewRevision: revision,
            views: selected.map(({ id, mdx }) => ({ id, mdx })),
          });
          const display = await ports.observe(
            panel,
            selected,
            input.contextId,
            input.source,
            AbortSignal.timeout(12_000),
            revision,
          );
          if (
            !display.passed ||
            display.panelAttempt !== owned.attemptId ||
            display.buildKey !== owned.buildKey
          )
            throw new Error(
              "Canonical preview did not render at the requested owned revision",
            );
          const after = await read(id);
          if (after.revision !== revision) {
            await panel.stateArgs.patch({ previewRevision: null, views: [] });
            return finish({ status: "changed", revision: after.revision });
          }
          const receipt = {
            source: id,
            revision,
            viewIds: selected.map(({ id }) => id),
            mdxDigests: selected.map(({ mdx }) => sha256HexSyncText(mdx)),
          };
          saved = {
            preview: receipt,
            report: structuredClone(report),
            display: structuredClone(display),
          };
          return finish({ status: "visible", receipt });
        } finally {
          writing = false;
        }
      },
    },
  };

  
  async function verify(report: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(report,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["matchedPresentationDisposition"],"rootPath":["notes"],"producerSourceSuffix":"reviewLocalPresentation/requestedFindings.nl","producerPath":[]}];
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
async function verifyNativeApplication(report: unknown, _invocation?: InvocationObservations) {
    const resolved = report as Outcome | null;
    const outcome = resolved;
    const { target, holds } = world.expected;
    const currentRecords = await Promise.all([...seeds.keys()].map(read));
    const current =
      currentRecords.find((record) => record.id === target) ?? null;
    const changes = journal.filter(
      (row) =>
        row.method === "preview" &&
        (row.result as Preview).status === "changed",
    );
    const attempts = journal.filter((row) => row.method === "preview");
    const previewState = await panel.stateArgs.get<PreviewState>();
    const rendering =
      saved ? selectedPresentationViews(saved.report) : null;
    const observe = (views: Prepared, revision?: string) =>
      ports.observe(
        panel,
        views,
        input.contextId,
        input.source,
        AbortSignal.timeout(12_000),
        revision,
      );
    const display =
      holds && !saved
        ? await observe([])
        : rendering?.length && current && saved
          ? await observe(rendering, current.revision)
          : null;
    const matchedScope =
      true;

    const checks = {
      discoveredPresentationRecords:
        (current ? reads.has(current.id) : listed),
      retainedSourceIntegrity: currentRecords.every(
        ({ revision: _revision, ...value }) => {
          const seed = seeds.get(value.id)!;
          return isDeepStrictEqual(
            value,
            world.coedit?.id === value.id
              ? { ...seed, sections: world.coedit.sections }
              : seed,
          );
        },
      ),
      joinedCurrentPresentationRevision:
        (world.coedit
          ? raced &&
            changes.some(change => current?.revision !== change.args[1] &&
              (change.result as {revision?:string}).revision === current?.revision) &&
            reads.get(current!.id)?.revision === current?.revision
          : changes.length === 0) &&
        (holds
          ? attempts.every(attempt => (attempt.result as Preview).status !== "visible")
          : saved?.preview.source === current?.id &&
            saved?.preview.revision === current?.revision),
      matchedPresentationDisposition: Boolean(
        matchedScope &&
        (holds
          ? outcome?.status === "held" &&
            outcome.revision === (current?.revision ?? null) &&
            typeof outcome.reason === "string" &&
            Boolean(outcome.reason.trim())
          : outcome?.status === "visible" &&
            isDeepStrictEqual(outcome.receipt, saved?.preview) &&
            Array.isArray(outcome.notes) &&
            outcome.notes.every(note=>typeof note==="string"&&Boolean(note.trim()))),
      ),
      independentlyVerifiedPresentationDom: Boolean(
        display?.passed &&
        display.panelAttempt === initialPanel.attemptId &&
        display.buildKey === initialPanel.buildKey &&
        (holds
          ? !saved &&
            display.rendered.revision === null &&
            !previewState.previewRevision &&
            !previewState.views?.length
          : rendering?.length &&
            isDeepStrictEqual(display.mdxDigests, saved?.preview.mdxDigests) &&
            display.rendered.revision === current?.revision &&
            previewState.previewRevision === current?.revision &&
            isDeepStrictEqual(
              previewState.views,
              rendering.map(({ id, mdx }) => ({ id, mdx })),
            )),
      ),
      protectedPresentationHeadUnchanged:
        isDeepStrictEqual(await ports.head(), initialHead) &&
        isDeepStrictEqual(await checkPanel(), initialPanel),
    };
    return {
      outcomeContract:{effects:{checks:["discoveredPresentationRecords", "retainedSourceIntegrity", "joinedCurrentPresentationRevision", "independentlyVerifiedPresentationDom", "protectedPresentationHeadUnchanged"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["matchedPresentationDisposition"],required:Boolean(holds),rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],

      contextId: input.contextId,
      caseId: input.caseId,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      current,
      journal,
      report: saved?.report ?? null,
      preview: saved?.preview ?? null,
      display,
      previewDisplay: saved?.display ?? null,
    };
  }

  async function qualify() {
    await services.presentationRecords.discover();
    let rejectedAlias = false;
    try {
      await services.presentationRecords.read("unassigned-copy");
    } catch {
      rejectedAlias = true;
    }
    const records = await Promise.all(
      [...seeds.keys()].map(services.presentationRecords.read),
    );
    const { target, requirements, holds, notes } = world.expected;
    let current = records.find((record) => record.id === target);
    const original = current;
    let rejectedWrongRevision = false;
    if (current) {
      try {
        await services.presentationRecords.preview(
          current.id,
          "retired-revision",
          { views: [], omitted: [] },
        );
      } catch {
        rejectedWrongRevision = true;
      }
    }
    let preview: Preview | null = null;
    if (current && requirements) {
      // The first preview with a coedit only reaches the revision check.
      const reference = referencePresentation(requirements);
      preview = await services.presentationRecords.preview(
        current.id,
        current.revision,
        reference,
      );
      if (preview.status === "changed") {
        current = await services.presentationRecords.read(current.id);
        if (!holds)
          preview = await services.presentationRecords.preview(
            current.id,
            current.revision,
            reference,
          );
      }
    }
    const outcome = holds
      ? {
          status: "held",
          reason: holds.join(" "),
          revision: current?.revision ?? null,
        }
      : {
          status: "visible",
          receipt: preview?.status === "visible" ? preview.receipt : null,
          notes: notes.length ? [notes.join(" ")] : [],
        };
    const proof = await verify(outcome);
    const rejectedForeignPresentation =
      rejectedAlias && (!original || rejectedWrongRevision);
    return assessNativeQualification({
      ...proof,outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"rejectedForeignPresentation"]}},
      passed: proof.passed && rejectedForeignPresentation,
      checks: { ...proof.checks, rejectedForeignPresentation },
    });
  }
  return { goal: world.goal, services, verify, qualify, close };
}
