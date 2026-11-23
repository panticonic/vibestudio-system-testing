import type { InvocationObservations } from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import {
  sha256HexSyncText,
  stableSha256Hex,
} from "@vibestudio/content-addressing";
import { contextId, fs, panelTree, rpc, vcs } from "@workspace/runtime";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { grimoireSceneInstalled } from "@workspace-skills/examples-review-fixtures/open-grimoire-scene-owner";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type { GrimoireSceneWorld } from "./open-goal-grimoire-scene-worlds.js";

type GrimoireDocket = {
  id: string;
  title: string;
  edition: "current" | "archive";
};
type GrimoireSceneSource = {
  id: string;
  title: string;
  detail: string;
  x: number;
  y: number;
  kind: "observed" | "planned";
};
type GrimoireSceneView = {
  docketId: string;
  ownerId: string;
  frontier: string;
  sceneDigest: string;
  description: string;
  turn: number;
  day: number;
  weather: string;
  pending: boolean;
  assets: string[];
  anchors: GrimoireSceneSource[];
};
type GrimoireCaretakerScope = {
  docketId: string;
  ownerId: string;
  frontier: string;
  directive: string;
  approved: boolean;
  proposed: GrimoireSceneSource | null;
  requestedAsset: string | null;
};
type GrimoireSceneEvidence = {
  scene: GrimoireSceneView;
  scope: GrimoireCaretakerScope;
};
type GrimoirePlan = {
  action:
    | "stage-scene"
    | "stage-note"
    | "keep-current"
    | "hold-foreign"
    | "hold-no-art"
    | "hold-authority"
    | "hold-stale";
  finding: string;
  proposedIds: string[];
  description: string | null;
};
type GrimoireSceneGate = {
  ownerId: string;
  frontier: string;
  status: "current" | "changed";
};
type GrimoireSceneReceipt = {
  status: "staged";
  path: string;
  digest: string;
  previewDigest: string | null;
  frontier: string;
};
type GrimoireSceneReadback = {
  ownerId: string;
  frontier: string;
  sceneDigest: string;
  fileDigest: string | null;
};
type GrimoireSceneOutcome = GrimoireSceneReceipt | { action: GrimoirePlan["action"]; finding: string };

import { advanceOwnedGrimoirePanel, assertOwnedGrimoirePanel, grimoireClockIndex,
  grimoireSceneDocket, grimoireSceneEstate, type GrimoireClock } from "./grimoire-fixture-player.js";

type Installed = typeof grimoireSceneInstalled;
type Input = { contextId: string; caseId: string; panelId?: string; grimoireEstateKey?: string };
type Journal = {
  service: string;
  method: string;
  args: unknown[];
  result: unknown;
};
type Ports = {
  contextId: string | null;
  fs: Parameters<typeof bindScratchHandoff>[0] & Pick<typeof fs, "readdir">;
  status: Pick<typeof vcs, "status">["status"];
  readBytes(path: string, limit: number): Promise<Uint8Array>;
  advanceFixture(before: GrimoireClock): Promise<void>;
};
const maxBytes = 64 * 1024;
const namespaces = { read: "grimoireScene", write: "grimoireHandoff" } as const;

async function livePorts(input: Input, estateKey: string): Promise<Ports> {
  if (!input.panelId) throw new Error("The owned Grimoire scene needs its player panel");
  const panel = panelTree.get(input.panelId);
  const fixture = {contextId:input.contextId,estateKey};
  await assertOwnedGrimoirePanel(panel,fixture);
  return {
    contextId,
    fs,
    status: (input) => vcs.status(input),
    readBytes: (path, limit) => readWorkspaceBytes(rpc, path, limit),
    advanceFixture: before => advanceOwnedGrimoirePanel(panel,fixture,before),
  };
}

export async function prepareOpenGrimoireScene(
  input: Input,
  world: GrimoireSceneWorld,
  installed: Installed,
  injected?: Ports,
) {
  const ownerId = input.grimoireEstateKey;
  if (!ownerId) throw new Error("The owned Grimoire scene needs its assigned estate");
  const key = grimoireSceneDocket(ownerId);
  const ports = injected ?? await livePorts(input,ownerId);
  if (
    !input.contextId ||
    input.contextId !== ports.contextId ||
    input.caseId !== world.id
  )
    throw new Error("Grimoire scene belongs to another Examples context");
  const owner = installed.owner(ownerId);
  const docket: GrimoireDocket = {
    id: key,
    title: world.name,
    edition: "current",
  };
  const archive: GrimoireDocket = {
    id: crypto.randomUUID(),
    title: world.name + " archive",
    edition: "archive",
  };
  const start = await ports.status({ contextId: input.contextId });
  const initialScratch = new Set(await listOwnedScratchEntries(ports.fs));
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
  function assigned(id: string) {
    if (id !== docket.id)
      throw new Error("Read only the exact owned Grimoire scene docket");
  }

  async function observe() {
    const game = await owner.read();
    const catalog = await owner.catalog();
    const garden = game.game.life.garden;
    if (game.seated || game.pending)
      throw new Error(
        "The owned quiet Grimoire fixture must have no seated or pending model",
      );
    const scene = installed.validateScene(game.game.scene);
    const assets = Object.keys(catalog).sort();
    const anchors: GrimoireSceneSource[] = [
      ...garden.residents.map(({ id, name, form, activity, x, y }) => ({
        id,
        title: name,
        detail: form + " " + activity,
        x,
        y,
        kind: "observed" as const,
      })),
      ...garden.habitats.map(({ id, name, water, shade, shelter, x, y }) => ({
        id,
        title: name,
        detail: `Water ${water}, shade ${shade}, shelter ${shelter}.`,
        x,
        y,
        kind: "observed" as const,
      })),
    ];
    const view: GrimoireSceneView = {
      docketId: key,
      ownerId,
      frontier: stableSha256Hex({
        turn: game.game.turn,
        history: game.game.history,
        garden,
        scene,
        catalog,
      }),
      sceneDigest: stableSha256Hex(scene),
      description: scene.description,
      turn: game.game.turn,
      day: garden.day,
      weather: garden.weather,
      pending: Boolean(game.pending),
      assets,
      anchors,
    };
    return { view, scene, garden };
  }

  const initial = await observe();
  async function pulse() {
    const before = await observe();
    await ports.advanceFixture(before.garden);
    const after = await observe();
    if (grimoireClockIndex(after.garden) !== grimoireClockIndex(before.garden) + 1 ||
        before.view.turn !== after.view.turn || before.view.sceneDigest !== after.view.sceneDigest)
      throw new Error("The player control did not establish one quiet pulse in the assigned Grimoire estate");
  }
  for (let i = 0; i < (world.advanceBefore ?? 0); i++) await pulse();
  const ready = await observe();
  const site =
    world.proposed &&
    ready.view.anchors.find((anchor) => anchor.id === world.proposed?.at);
  const proposed: GrimoireSceneSource | null =
    world.proposed && site
      ? {
          id: "proposed",
          title: world.proposed.title,
          detail: world.proposed.detail,
          x: site.x + 24,
          y: site.y - 24,
          kind: "planned",
        }
      : null;
  const scope: GrimoireCaretakerScope = {
    docketId: docket.id,
    ownerId: world.source === "other" ? grimoireSceneEstate(archive.id) : ownerId,
    frontier:
      world.source === "past" ? initial.view.frontier : ready.view.frontier,
    approved: world.approved !== false,
    directive: world.directive,
    requestedAsset: world.asset ?? null,
    proposed,
  };
  const textWriter = bindScratchHandoff(
    ports.fs,
    {
      goal: world.goal,
      questions: ["What can the owned Grimoire caretaker hand off?"],
      sources: [{ id: "docket", path: "/.tmp/" + docket.id }],
    },
    ports.readBytes,
  ).scratchHandoffWrite;
  let view: GrimoireSceneView | undefined;
  let gate: GrimoireSceneGate | undefined;
  let receipt: GrimoireSceneReceipt | null = null;
  let moved = false;

  async function artifact(observed: typeof ready, plan: GrimoirePlan) {
    const sources = [...observed.view.anchors, ...(proposed ? [proposed] : [])];
    const found = plan.proposedIds.map((id) =>
      sources.find((source) => source.id === id),
    );
    if (
      found.some((source) => !source) ||
      !found.length ||
      found.length > 4 ||
      new Set(plan.proposedIds).size !== found.length
    )
      return null;
    const facts = found as GrimoireSceneSource[];
    const header = {
      docket: docket.title,
      ownerId,
      frontier: observed.view.frontier,
      sceneDigest: observed.view.sceneDigest,
    };
    if (plan.action === "stage-note" && plan.description === null) {
      return {
        body: JSON.stringify({
          ...header,
          kind: "private-caretaker-note",
          facts,
        }),
        previewDigest: null,
      };
    }
    if (
      plan.action !== "stage-scene" ||
      !plan.description ||
      plan.description === observed.scene.description ||
      facts.some((fact) => !plan.description?.includes(fact.title)) ||
      (facts.some((fact) => fact.kind === "planned") &&
        !/\b(?:proposed|planned|future)\b/iu.test(plan.description))
    )
      return null;
    const candidate = installed.validateScene({
      ...observed.scene,
      description: plan.description,
      annotations: [
        ...(observed.scene.annotations ?? []),
        ...facts.map(({ title, detail, x, y, kind }) => ({
          label: title,
          detail,
          x,
          y,
          kind,
        })),
      ],
    });
    const html = installed.sceneDocument(
      candidate.code,
      observed.view.frontier,
      {},
      observed.garden,
    );
    if (
      !html.includes("connect-src 'none'") ||
      !html.includes("motion.matches?0") ||
      !html.includes("art.world=data.world")
    )
      throw new Error("The installed Living Canvas preview contract changed");
    const previewDigest = sha256HexSyncText(html);
    return {
      body: JSON.stringify({
        ...header,
        kind: "editable-caretaker-scene",
        facts,
        candidate,
        previewDigest,
      }),
      previewDigest,
    };
  }

  const services = {
    grimoireScene: {
      async discover() {
        return keep(namespaces.read, "discover", [], [docket, archive]);
      },
      async view(id: string) {
        assigned(id);
        view = (await observe()).view;
        return keep(namespaces.read, "view", [id], view);
      },
      async readScope(id: string) {
        assigned(id);
        return keep(namespaces.read, "readScope", [id], scope);
      },
      async confirm(id: string, frontier: string) {
        assigned(id);
        if (view?.frontier !== frontier)
          throw new Error("Confirm only the observed Grimoire scene");
        if (world.advanceDuring && !moved) {
          moved = true;
          await pulse();
        }
        const current = (await observe()).view;
        gate = {
          ownerId,
          frontier: current.frontier,
          status: current.frontier === frontier ? "current" : "changed",
        };
        return keep(namespaces.read, "confirm", [id, frontier], gate);
      },
      async readback(id: string, path: string | null) {
        assigned(id);
        if (path !== (receipt?.path ?? null))
          throw new Error("Read only the new owned Grimoire artifact");
        const fresh = (await observe()).view;
        const data = path ? await ports.readBytes(path, maxBytes) : null;
        const readback: GrimoireSceneReadback = {
          ownerId,
          frontier: fresh.frontier,
          sceneDigest: fresh.sceneDigest,
          fileDigest: data
            ? sha256HexSyncText(
                new TextDecoder("utf-8", { fatal: true }).decode(data),
              )
            : null,
        };
        return keep(namespaces.read, "readback", [id, path], readback);
      },
    },
    grimoireHandoff: {
      async stage(id: string, frontier: string, plan: GrimoirePlan) {
        assigned(id);
        const current = await observe();
        if (
          receipt ||
          gate?.status !== "current" ||
          frontier !== view?.frontier ||
          frontier !== gate.frontier ||
          frontier !== current.view.frontier ||
          scope.ownerId !== ownerId ||
          scope.frontier !== frontier ||
          !scope.approved ||
          (scope.requestedAsset &&
            !current.view.assets.includes(scope.requestedAsset))
        )
          return keep(namespaces.write, "stage", [id, frontier, plan], null);
        const candidate = await artifact(current, plan);
        const staged = candidate
          ? await textWriter.stage(candidate.body)
          : null;
        if (!staged || !candidate)
          return keep(namespaces.write, "stage", [id, frontier, plan], null);
        if ((await observe()).view.frontier !== frontier) {
          await ports.fs.rm(
            staged.path.slice(0, staged.path.lastIndexOf("/")),
            { recursive: true, force: true },
          );
          return keep(namespaces.write, "stage", [id, frontier, plan], null);
        }
        receipt = {
          status: "staged",
          path: staged.path,
          frontier,
          digest: sha256HexSyncText(candidate.body),
          previewDigest: candidate.previewDigest,
        };
        return keep(namespaces.write, "stage", [id, frontier, plan], receipt);
      },
    },
  };

  async function verify(value: unknown, observations?: InvocationObservations) {
    const result = value as GrimoireSceneOutcome | null;
    const planned = journal.filter(row => row.service === namespaces.write && row.method === "stage").at(-1)?.args[2] as GrimoirePlan | undefined;
    const finding = planned ?? (result && "action" in result ? result : null);
    const final = await observe();
    const files = (await listOwnedScratchEntries(ports.fs)).filter(
      (path) => !initialScratch.has(path),
    );
    const end = await ports.status({ contextId: input.contextId });
    const exact = (
      service: string,
      method: string,
      args: unknown[],
      result: unknown,
    ) => {
      const evidence = journal.filter(
        (row) => row.service === service && row.method === method,
      );
      return (
        evidence.some(row => isDeepStrictEqual(row.args, args) && isDeepStrictEqual(row.result, result))
      );
    };
    const path = receipt?.path ?? null;
    const readback = journal.find((row) => row.method === "readback")
      ?.result as GrimoireSceneReadback | undefined;
    const stages =
      world.action === "stage-scene" || world.action === "stage-note";
    const bytes = path ? await ports.readBytes(path, maxBytes) : null;
    const body = bytes
      ? new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      : null;
    const staged = body ? JSON.parse(body) : null;
    const expectedFacts = [
      ...(view?.anchors ?? []),
      ...(proposed ? [proposed] : []),
    ].filter((fact) =>
      world.anchors?.includes(
        fact.id as NonNullable<typeof world.anchors>[number],
      ),
    );
    const actualFacts = Array.isArray(staged?.facts) ? staged.facts : [];
    const expectedPreview =
      world.action === "stage-scene"
        ? sha256HexSyncText(
            installed.sceneDocument(
              final.scene.code,
              final.view.frontier,
              {},
              final.garden,
            ),
          )
        : null;
    const checks = {
      returnedCaretakerValue: stages ? !!receipt && isDeepStrictEqual(result, receipt) :
        !!result && "action" in result && result.action === world.action && !!result.finding?.trim(),
      boundOwnedScene: Boolean(
        view &&

        view.ownerId === ownerId &&
        view.sceneDigest === ready.view.sceneDigest &&
        exact(namespaces.read, "discover", [], [docket, archive]) &&
        exact(namespaces.read, "view", [key], view) &&
        exact(namespaces.read, "readScope", [key], scope),
      ),
      keptCurrentAnchor: Boolean(
        view &&
        gate &&

        exact(namespaces.read, "confirm", [key, view.frontier], gate) &&
        gate.frontier === final.view.frontier &&
        gate.status === (world.advanceDuring ? "changed" : "current") &&
        final.view.sceneDigest === ready.view.sceneDigest,
      ),
      exactCaretakerDisposition: stages ? Boolean(planned && planned.action===world.action &&
        typeof planned.finding==="string"&&planned.finding.trim() &&
        isDeepStrictEqual([...planned.proposedIds].sort(),[...(world.anchors??[])].sort()) &&
        (world.action==="stage-scene"?Boolean(planned.description):planned.description===null)) : true,
      independentlyReadPrivateDraft: Boolean(

        (stages
          ? receipt &&
            body &&
            files.length === 1 &&
            receipt.digest === sha256HexSyncText(body) &&
            receipt.previewDigest === expectedPreview &&
            staged.ownerId === ownerId &&
            staged.frontier === final.view.frontier &&
            staged.sceneDigest === final.view.sceneDigest &&
            actualFacts.length === expectedFacts.length &&
            expectedFacts.every((fact) =>
              actualFacts.some((actual: unknown) =>
                isDeepStrictEqual(actual, fact),
              ),
            ) &&
            exact(
              namespaces.write,
              "stage",
              [key, view?.frontier, planned!],
              receipt,
            ) &&
            (world.action === "stage-scene"
              ? staged.kind === "editable-caretaker-scene" &&
                staged.candidate.code === final.scene.code &&
                isDeepStrictEqual(
                  staged.candidate.assets,
                  final.scene.assets,
                ) &&
                staged.previewDigest === expectedPreview &&
                staged.candidate.description === planned!.description &&
                isDeepStrictEqual(staged.candidate.annotations, [
                  ...(final.scene.annotations ?? []),
                  ...actualFacts.map(
                    ({ title, detail, x, y, kind }: GrimoireSceneSource) => ({
                      label: title,
                      detail,
                      x,
                      y,
                      kind,
                    }),
                  ),
                ])
              : staged.kind === "private-caretaker-note" &&
                staged.candidate === undefined)
          : !receipt &&
            !body &&
            !files.length &&
            journal.every((row) => row.service !== namespaces.write)),
      ),
      preservedNativeWorld: Boolean(
        readback &&
        exact(namespaces.read, "readback", [key, path], readback) &&
        readback.sceneDigest === final.view.sceneDigest &&
        readback.frontier === final.view.frontier &&
        readback.fileDigest === (receipt?.digest ?? null) &&
        isDeepStrictEqual(start.workingHead, end.workingHead) &&
        start.mainEventId === end.mainEventId,
      ),
    };
    return {
      outcomeContract: {
        effects: {checks:["boundOwnedScene", "keptCurrentAnchor", "exactCaretakerDisposition", "independentlyReadPrivateDraft", "preservedNativeWorld"],rationale:"The requested scene or note is established by its native private artifact and preserved garden."},
        returnedValue: {checks:["returnedCaretakerValue"],required:!stages,rationale:"A conversation-only caretaker finding is the requested answer; an extra receipt copy is optional."},
        incidentalValues: {checks:[],rationale:"A known incorrect emitted application value is excluded using the actual root definition."},
      },
      incorrectReturnValues: result!==undefined&&!(checks.returnedCaretakerValue) ? [{
        required:!stages,definition:observations?.calls.find(call=>call.parentCallId===null)?.definition??{name:"careForGrimoireScene",source:"careForGrimoireScene.nl"},value:result,
      }] : [],
      contextId: input.contextId,
      caseId: world.id,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      docket,
      view,
      scope,
      gate,
      receipt,
      readback,
      journal: structuredClone(journal),
    };
  }

  async function qualify() {
    const dockets = await services.grimoireScene.discover();
    let rejectedAlias = false;
    try {
      await services.grimoireScene.view(dockets[1]!.id);
    } catch {
      rejectedAlias = true;
    }
    const scene = await services.grimoireScene.view(docket.id);
    const evidence: GrimoireSceneEvidence = {
      scene,
      scope: await services.grimoireScene.readScope(docket.id),
    };
    const confirmed = await services.grimoireScene.confirm(
      docket.id,
      scene.frontier,
    );
    const facts = [...scene.anchors, ...(proposed ? [proposed] : [])];
    const notation = (world.anchors ?? []).map(
      (id) => facts.find((fact) => fact.id === id)?.title,
    );
    const plan: GrimoirePlan = {
      action: world.action,
      finding: "Read the exact public caretaker evidence.",
      proposedIds: [...(world.anchors ?? [])],
      description:
        world.action === "stage-scene"
          ? "Accessible garden view with " +
            notation.join(", ") +
            (proposed ? ", with a planned marker." : ".")
          : null,
    };
    const staged =
      plan.action === "stage-scene" || plan.action === "stage-note"
        ? await services.grimoireHandoff.stage(docket.id, scene.frontier, plan)
        : null;
    await services.grimoireScene.readback(docket.id, staged?.path ?? null);
    const report = staged ?? {action:plan.action,finding:plan.finding};
    const verification = await verify(report);
    const altered = structuredClone(report);
    if ("path" in altered) altered.path = "foreign-caretaker.json";
    else altered.action = "invented" as typeof altered.action;
    const wrong = await verify(altered);
    const rejectedAlteredEvidence = rejectedAlias && !wrong.passed;
    return {
      ...verification,
      outcomeContract:{...verification.outcomeContract,effects:{...verification.outcomeContract.effects,checks:[...verification.outcomeContract.effects.checks,...["rejectedAlteredEvidence"]]}},
      passed: verification.passed && rejectedAlteredEvidence,
      checks: { ...verification.checks, rejectedAlteredEvidence },
      referenceReport: report,
    };
  }
  return { services, verify, qualify };
}
