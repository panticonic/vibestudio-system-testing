import { isDeepStrictEqual } from "node:util";
import {
  sha256HexSyncText,
  stableSha256Hex,
} from "@vibestudio/content-addressing";
import { parseWorkspaceSystemEpochEnvelope } from "@vibestudio/workspace/configParser";
import { parseTemplateManifestContent } from "@vibestudio/workspace/templateManifest";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import {
  adoptionReviewLayers,
  evaluateAdoption,
} from "./examples-adoption-composition.js";
import type { ExamplesAdoptionWorld } from "./open-goal-examples-adoption-worlds.js";

type State = Awaited<ReturnType<typeof vcs.status>>["workingHead"];
type Ports = {
  contextId: string | null;
  vcs: Pick<
    typeof vcs,
    "status" | "importSnapshot" | "resolveRepository" | "readFile"
  >;
  fs: Parameters<typeof bindScratchHandoff>[0] & Pick<typeof fs, "readdir">;
  putText(text: string): Promise<string>;
  readBytes(path: string, limit: number): Promise<Uint8Array>;
};
type Plan = {
  disposition: ExamplesAdoptionWorld["disposition"];
  finding: string;
  proof: string[];
};
type Card = {
  id: string;
  title: string;
  event: string;
  edition: "staged" | "retired";
  mayRecord: boolean;
};
type Installed = {
  repository: string;
  packageName: string;
  manifestDigest: string;
  templateDigest: string;
  main: string;
};
type Composition = ReturnType<typeof evaluateAdoption> & {
  id: string;
  event: string;
};
type Gate = { event: string; status: "current" | "changed" };
type Receipt = { path: string; digest: string; event: string };
type Readback = { main: string; event: string; digest: string | null };
type Outcome = {
  scope: string;
  card: Card;
  evidence: { installed: Installed; composition: Composition };
  plan: Plan;
  gate: Gate;
  receipt: Receipt | null;
  readback: Readback;
};
type Journal = {
  service: string;
  method: string;
  args: unknown[];
  result: unknown;
};
const read = "adoptionReview";
const write = "adoptionHandoff";
const maxNoteBytes = 32 * 1024;
function livePorts(): Ports {
  return {
    contextId,
    vcs,
    fs,
    putText: async (text) =>
      (await rpc.call("main", mainRpcMethods["blobstore.putText"], [text]))
        .digest,
    readBytes: (path, limit) => readWorkspaceBytes(rpc, path, limit),
  };
}

export async function prepareOpenExamplesAdoption(
  input: { contextId: string; caseId: string },
  world: ExamplesAdoptionWorld,
  ports = livePorts(),
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("Composition review belongs to another context");
  const key = crypto.randomUUID();
  const ownedRepo = "packages/examples-adoption-review-" + key;
  const status = () => ports.vcs.status({ contextId: input.contextId });
  const initial = await status();
  const release = { kind: "event" as const, eventId: initial.mainEventId };
  const file = async (state: State, repoPath: string, path: string) => {
    const repo = await ports.vcs.resolveRepository({ state, repoPath });
    if (!repo || repo.repoPath !== repoPath)
      throw new Error("Missing exact native repository " + repoPath);
    const observed = await ports.vcs.readFile({
      state,
      repositoryId: repo.repositoryId,
      file: { kind: "path", path },
    });
    if (
      observed?.content.kind !== "text" ||
      observed.contentHash !== sha256HexSyncText(observed.content.text)
    )
      throw new Error("Missing exact source " + repoPath + "/" + path);
    return {
      text: observed.content.text,
      digest: observed.contentHash,
      repositoryId: repo.repositoryId,
    };
  };
  async function installedEvidence(): Promise<Installed & { epoch: number }> {
    const [manifest, unit] = await Promise.all([
      file(release, "meta", "vibestudio.yml"),
      file(release, world.unit, "package.json"),
    ]);
    const epoch = parseWorkspaceSystemEpochEnvelope(manifest.text);
    const parsed = parseTemplateManifestContent(manifest.text, epoch);
    const services = parsed.top.services ?? [];
    if (
      !services.some(
        (service) =>
          service.name === "grimoire" &&
          service.source === "workers/grimoire-world",
      ) ||
      !services.some(
        (service) =>
          service.name === "regency" &&
          service.source === "workers/regency-realm",
      )
    )
      throw new Error("Expected the installed Examples world services");
    const packageName = JSON.parse(unit.text).name;
    if (typeof packageName !== "string")
      throw new Error("Installed Examples unit lacks a package name");
    return {
      repository: world.unit,
      packageName,
      manifestDigest: unit.digest,
      templateDigest: manifest.digest,
      main: initial.mainEventId,
      epoch,
    };
  }
  const installed = await installedEvidence();
  const layers = adoptionReviewLayers(
    world,
    installed.epoch,
    installed.packageName,
  );
  const source = (label: string) =>
    JSON.stringify({
      title: world.name,
      label,
      protectedMain: initial.mainEventId,
      installed,
      layers:
        label === "working"
          ? layers
          : layers.map((layer, index) =>
              index === 0
                ? layer
                : {
                    ...layer,
                    files: Object.fromEntries(
                      Object.entries(layer.files).map(([path, bytes]) => [
                        path,
                        path.endsWith("/review-candidate.ts")
                          ? bytes +
                            "export const reviewEdition = " +
                            JSON.stringify(label) +
                            ";\n"
                          : bytes,
                      ]),
                    ),
                  },
            ),
    });
  let repositoryId: string | undefined;
  async function stageReview(expectedWorkingHead: State, label: string) {
    const records = [
      [
        "package.json",
        JSON.stringify({
          name: "@workspace/examples-adoption-review-" + key,
          private: true,
          type: "module",
          version: "0.1.0",
        }),
      ],
      ["review.json", source(label)],
    ] as const;
    const files = await Promise.all(
      records.map(async ([path, text]) => {
        const digest = await ports.putText(text);
        if (digest !== sha256HexSyncText(text))
          throw new Error("Template review source changed while seeding");
        return { path, mode: 0o644 as const, contentHash: digest };
      }),
    );
    const result = await ports.vcs.importSnapshot({
      contextId: input.contextId,
      commandId: "examples-adoption-" + key + "-" + label,
      expectedWorkingHead,
      intentSummary: "Stage owned Examples adoption evidence",
      source: {
        kind: "generated",
        uri: "system-test://examples-adoption/" + key,
        snapshotRevision: stableSha256Hex(files),
      },
      repositories: [
        {
          repoPath: ownedRepo,
          files,
          ...(repositoryId ? { repositoryId } : {}),
        },
      ],
      message: "Record the disposable composition review",
    });
    const state = { kind: "event" as const, eventId: result.eventId };
    const exact = await file(state, ownedRepo, "review.json");
    if (
      exact.text !== records[1][1] ||
      result.importedRepositoryIds.length !== 1 ||
      result.importedRepositoryIds[0] !== exact.repositoryId ||
      (repositoryId && repositoryId !== exact.repositoryId)
    )
      throw new Error("VCS did not retain the exact owned composition review");
    repositoryId = exact.repositoryId;
    return state;
  }
  const retired = await stageReview(initial.workingHead, "earlier");
  const current = await stageReview(retired, "working");
  const card: Card = {
    id: key,
    title: world.name,
    event: current.eventId,
    edition: "staged",
    mayRecord: world.mayRecord,
  };
  const older: Card = {
    id: crypto.randomUUID(),
    title: world.name + " prior review",
    event: retired.eventId,
    edition: "retired",
    mayRecord: false,
  };
  const priorScratch = new Set(await listOwnedScratchEntries(ports.fs));
  const writer = bindScratchHandoff(
    ports.fs,
    {
      goal: world.goal,
      questions: ["What does the exact staged Examples composition permit?"],
      sources: [{ id: "owned-adoption", path: "/.tmp/" + key }],
    },
    ports.readBytes,
  ).scratchHandoffWrite;
  const journal: Journal[] = [];
  const keep = <T>(
    service: string,
    method: string,
    args: unknown[],
    result: T,
  ): T => {
    journal.push({
      service,
      method,
      args: structuredClone(args),
      result: structuredClone(result),
    });
    return result;
  };
  const assign = (id: string) => {
    if (id !== key)
      throw new Error("Read only the current owned Examples review");
  };
  const stateEvent = async () => {
    const state = await status();
    if (
      state.mainEventId !== initial.mainEventId ||
      state.workingHead.kind !== "event"
    )
      throw new Error("The owned review must preserve protected main");
    return state.workingHead.eventId;
  };
  if ((await stateEvent()) !== current.eventId)
    throw new Error("The staged review is not the owned working head");
  const nativeComposition = async (): Promise<Composition> => {
    const evidence = await file(current, ownedRepo, "review.json");
    if (
      evidence.repositoryId !== repositoryId ||
      evidence.text !== source("working")
    )
      throw new Error("The staged Examples review changed its source");
    const readLayers = JSON.parse(evidence.text).layers as typeof layers;
    return {
      id: key,
      event: current.eventId,
      ...evaluateAdoption(world.unit, readLayers),
    };
  };
  let composition: Composition | undefined;
  let gate: Gate | undefined;
  let receipt: Receipt | null = null;
  let advanced = false;
  function possible(c: Composition) {
    return [
      c.issue,
      c.owner,
      c.minimumAppVersion,
      ...c.privateFiles,
      ...c.settings,
      ...c.pulledUnits,
    ];
  }
  const services = {
    adoptionReview: {
      async discover() {
        return keep(read, "discover", [], [card, older]);
      },
      async installed(id: string) {
        assign(id);
        const { epoch, ...observed } = await installedEvidence();
        return keep(read, "installed", [id], observed);
      },
      async compose(id: string, event: string) {
        assign(id);
        if (event !== card.event)
          throw new Error("Compose only the exact reviewed candidate event");
        composition = await nativeComposition();
        return keep(read, "compose", [id, event], composition);
      },
      async confirm(id: string, event: string) {
        assign(id);
        if (event !== card.event || composition?.event !== event)
          throw new Error("Confirm only the observed composition");
        if (world.during && !advanced) {
          advanced = true;
          await stageReview(current, "coedited");
        }
        const head = await stateEvent();
        gate = { event: head, status: head === event ? "current" : "changed" };
        return keep(read, "confirm", [id, event], gate);
      },
      async readback(id: string, path: string | null) {
        assign(id);
        if (path !== (receipt?.path ?? null))
          throw new Error(
            "Read only the assigned private composition artifact",
          );
        const event = await stateEvent();
        const bytes = path ? await ports.readBytes(path, maxNoteBytes) : null;
        const digest = bytes
          ? sha256HexSyncText(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            )
          : null;
        return keep(read, "readback", [id, path], {
          main: initial.mainEventId,
          event,
          digest,
        });
      },
    },
    adoptionHandoff: {
      async record(id: string, event: string, plan: Plan) {
        assign(id);
        let result: Receipt | null = null;
        if (
          !receipt &&
          card.mayRecord &&
          gate?.status === "current" &&
          event === card.event &&
          composition?.event === event &&
          composition.status === "composed" &&
          (await stateEvent()) === event &&
          plan.disposition === "record-private" &&
          plan.proof.length &&
          plan.proof.every((item) => possible(composition!).includes(item))
        ) {
          const body = JSON.stringify({
            title: card.title,
            event,
            main: initial.mainEventId,
            compositionDigest: composition.digest,
            owner: composition.owner,
            proof: plan.proof,
            finding: plan.finding,
          });
          const staged = await writer.stage(body);
          if (staged) {
            if ((await stateEvent()) === event) {
              result = {
                path: staged.path,
                digest: sha256HexSyncText(body),
                event,
              };
              receipt = result;
            } else {
              await ports.fs.rm(
                staged.path.slice(0, staged.path.lastIndexOf("/")),
                { recursive: true, force: true },
              );
            }
          }
        }
        return keep(write, "record", [id, event, plan], result);
      },
    },
  };
  async function verify(value: unknown) {
    const envelope = value as {
      status?: string;
      skill?: string;
      outcome?: Outcome;
    } | null;
    const out = envelope?.outcome;
    const finalEvent = await stateEvent();
    const independent = await nativeComposition();
    const { epoch, ...source } = await installedEvidence();
    const files = (await listOwnedScratchEntries(ports.fs)).filter(
      (path) => !priorScratch.has(path),
    );
    const actualProof = world.during
      ? [finalEvent]
      : (world.proof ?? [independent.issue]);
    const saved = receipt
      ? await ports.readBytes(receipt.path, maxNoteBytes)
      : null;
    const body = saved
      ? new TextDecoder("utf-8", { fatal: true }).decode(saved)
      : null;
    const readback = journal.find(
      (row) => row.service === read && row.method === "readback",
    )?.result as Readback | undefined;
    const records = world.disposition === "record-private";
    const expectedOwner = world.mode === "parent" ? "Base" : "Examples";
    const exact = (
      service: string,
      method: string,
      args: unknown[],
      result: unknown,
    ) => {
      const rows = journal.filter(
        (row) => row.service === service && row.method === method,
      );
      return (
        rows.length === 1 &&
        isDeepStrictEqual(rows[0]!.args, args) &&
        isDeepStrictEqual(rows[0]!.result, result)
      );
    };
    const checks = {
      exactStagedAndInstalledSource: Boolean(
        out &&
        isDeepStrictEqual(out.card, card) &&
        isDeepStrictEqual(out.evidence.installed, source) &&
        exact(read, "discover", [], [card, older]) &&
        exact(read, "installed", [key], source),
      ),
      exactNativeComposition: Boolean(
        out &&
        isDeepStrictEqual(out.evidence.composition, independent) &&
        exact(read, "compose", [key, card.event], independent) &&
        independent.status === world.status &&
        (independent.status === "composed"
          ? independent.owner === expectedOwner &&
            /^[a-f0-9]{64}$/u.test(independent.digest ?? "") &&
            (world.mode !== "replace" ||
              !independent.privateFiles.some((path) =>
                path.endsWith("/review-parent.ts"),
              ))
          : independent.digest === null && independent.owner === null),
      ),
      currentOwnedFrontier: Boolean(
        out &&
        gate &&
        isDeepStrictEqual(out.gate, gate) &&
        exact(read, "confirm", [key, card.event], gate) &&
        gate.status === (world.during ? "changed" : "current") &&
        gate.event === finalEvent &&
        (world.during ? finalEvent !== card.event : finalEvent === card.event),
      ),
      actualPrivateDisposition: Boolean(
        out &&
        envelope?.status === "workspace-skill-reviewed" &&
        envelope.skill === "examplesAdoption" &&
        out.scope === "owned-examples-composition-rehearsal" &&
        out.plan.disposition === world.disposition &&
        out.plan.finding.trim() &&
        isDeepStrictEqual(
          [...out.plan.proof].sort(),
          [...actualProof].sort(),
        ) &&
        isDeepStrictEqual(out.receipt, receipt) &&
        (records
          ? receipt &&
            body &&
            files.length === 1 &&
            receipt.event === finalEvent &&
            sha256HexSyncText(body) === receipt.digest &&
            isDeepStrictEqual(JSON.parse(body), {
              title: card.title,
              event: finalEvent,
              main: initial.mainEventId,
              compositionDigest: independent.digest,
              owner: independent.owner,
              proof: out.plan.proof,
              finding: out.plan.finding,
            }) &&
            exact(write, "record", [key, card.event, out.plan], receipt)
          : !receipt &&
            !body &&
            !files.length &&
            journal.every((row) => row.service !== write)),
      ),
      independentReadbackAndPreservedMain: Boolean(
        out &&
        readback &&
        isDeepStrictEqual(out.readback, readback) &&
        exact(read, "readback", [key, receipt?.path ?? null], readback) &&
        readback.main === initial.mainEventId &&
        readback.event === finalEvent &&
        readback.digest === (receipt?.digest ?? null),
      ),
    };
    return {
      contextId: input.contextId,
      caseId: world.id,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      card,
      installed: source,
      composition: independent,
      gate,
      receipt,
      readback,
      journal: structuredClone(journal),
    };
  }
  async function qualify() {
    await services.adoptionReview.discover();
    let denied = 0;
    try {
      await services.adoptionReview.installed(older.id);
    } catch {
      denied++;
    }
    try {
      await services.adoptionReview.compose(key, older.event);
    } catch {
      denied++;
    }
    const source = await services.adoptionReview.installed(key);
    const native = await services.adoptionReview.compose(key, card.event);
    const confirmed = await services.adoptionReview.confirm(key, card.event);
    const proof = world.during
      ? [confirmed.event]
      : (world.proof ?? [native.issue ?? ""]);
    const plan: Plan = {
      disposition: world.disposition,
      finding: "The exact owned candidate provides these native receipts.",
      proof: [...proof],
    };
    const saved =
      world.disposition === "record-private"
        ? await services.adoptionHandoff.record(key, card.event, plan)
        : null;
    const readback = await services.adoptionReview.readback(
      key,
      saved?.path ?? null,
    );
    const report = {
      status: "workspace-skill-reviewed",
      skill: "examplesAdoption",
      outcome: {
        scope: "owned-examples-composition-rehearsal",
        card,
        evidence: { installed: source, composition: native },
        plan,
        gate: confirmed,
        receipt: saved,
        readback,
      },
    };
    const verification = await verify(report);
    const altered = structuredClone(report);
    altered.outcome.readback.main = "foreign";
    const rejectedAlteredEvidence = denied === 2 && !(await verify(altered)).passed;
    return {
      ...verification,
      passed: verification.passed && rejectedAlteredEvidence,
      checks: { ...verification.checks, rejectedAlteredEvidence },
      referenceReport: report,
    };
  }
  return { services, verify, qualify };
}
