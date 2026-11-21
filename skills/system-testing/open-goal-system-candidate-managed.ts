import { isDeepStrictEqual } from "node:util";
import {
  canonicalSnapshotDigest,
  compareUtf16CodeUnits,
  sha256HexSyncText,
  stableSha256Hex,
} from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import {
  boundedTemplateUpdatePreview,
  threeWayTextMerge,
} from "@workspace/vcs-engine";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type { SystemCandidateWorld } from "./open-goal-system-candidate-worlds.js";

type Vcs = Pick<
  typeof vcs,
  | "status"
  | "importSnapshot"
  | "registerExternalDelta"
  | "compare"
  | "resolveRepository"
  | "readFile"
>;
type State = Awaited<ReturnType<Vcs["status"]>>["workingHead"];
type Ports = {
  contextId: string | null;
  vcs: Vcs;
  fs: Parameters<typeof bindScratchHandoff>[0] & Pick<typeof fs, "readdir">;
  putText(value: string): Promise<string>;
  getText(digest: string): Promise<string | null>;
  readBytes(path: string, limit: number): Promise<Uint8Array>;
};
type Plan = {
  decision: SystemCandidateWorld["decision"];
  record: boolean;
  finding: string;
  proof: string[];
};
type Side = {
  status: "text" | "missing" | "too-large" | "binary";
  digest: string | null;
  text: string | null;
};
type Coordinate = {
  id: string;
  path: string;
  status: "adopt" | "convergent" | "composed" | "conflict" | "resolved";
  aspects: string[];
};
type Preview = {
  coordinate: Coordinate;
  base: Side;
  ours: Side;
  theirs: Side;
  result:
    | "compose"
    | "same-change"
    | "incoming-only"
    | "collision"
    | "absence"
    | "limited";
  composedDigest: string | null;
};
type Gate = { current: boolean; event: string; main: string };
type Receipt = {
  path: string;
  digest: string;
  coordinate: string;
  event: string;
};
type Readback = { event: string; main: string; artifactDigest: string | null };
type Journal = {
  service: string;
  method: string;
  args: unknown[];
  result: unknown;
};
const maxNote = 32 * 1024;
const read = "systemCandidateRead";
const write = "systemCandidateHandoff";
const encoder = new TextEncoder();

function livePorts(): Ports {
  return {
    contextId,
    vcs,
    fs,
    putText: async (value) =>
      (await rpc.call("main", mainRpcMethods["blobstore.putText"], [value]))
        .digest,
    getText: (digest) =>
      rpc.call("main", mainRpcMethods["blobstore.getText"], [digest]),
    readBytes: (path, limit) => readWorkspaceBytes(rpc, path, limit),
  };
}
function ownedFixture(world: SystemCandidateWorld) {
  const header = "# " + world.title + "\n";
  const lines = [
    header,
    "Opening: keep the current wording.\n",
    "Fallback: wait for the owner.\n",
  ];
  const base = lines.join("");
  const local = header + "Opening: keep the local clarification.\n" + lines[2];
  const incoming =
    header + lines[1] + "Fallback: verify the incoming evidence.\n";
  const competing =
    header + "Opening: use the upstream clarification.\n" + lines[2];
  switch (world.mode) {
    case "compose":
      return [base, local, incoming] as const;
    case "same":
      return [base, local, local] as const;
    case "incoming":
      return [base, base, incoming] as const;
    case "overlap":
      return [base, local, competing] as const;
    case "delete-edit":
      return [base, local, null] as const;
    case "delete":
      return [base, base, null] as const;
    case "binary":
      return [base, base, header + "cue\0data"] as const;
    case "oversize":
      return [base, base, header + "é".repeat(66 * 1024)] as const;
  }
}
function side(text: string | null): Side {
  if (text === null) return { status: "missing", digest: null, text: null };
  return {
    ...boundedTemplateUpdatePreview(text),
    digest: sha256HexSyncText(text),
  };
}
function describe(
  coordinate: Coordinate,
  base: Side,
  ours: Side,
  theirs: Side,
): Preview {
  const fields = { coordinate, base, ours, theirs, composedDigest: null };
  if (
    [base, ours, theirs].some(
      (value) => value.status === "binary" || value.status === "too-large",
    )
  )
    return { ...fields, result: "limited" };
  if (base.text === null || ours.text === null || theirs.text === null)
    return { ...fields, result: "absence" };
  if (ours.text === theirs.text) return { ...fields, result: "same-change" };
  if (ours.text === base.text) return { ...fields, result: "incoming-only" };
  const composed = threeWayTextMerge(base.text, ours.text, theirs.text);
  if (composed.kind === "composed")
    return {
      ...fields,
      result: "compose",
      composedDigest: sha256HexSyncText(composed.text),
    };
  return {
    ...fields,
    result: composed.kind === "too-large" ? "limited" : "collision",
  };
}
const nativeStatuses = {
  compose: "composed",
  same: "convergent",
  incoming: "adopt",
  overlap: "conflict",
  "delete-edit": "conflict",
  delete: "adopt",
  binary: "adopt",
  oversize: "adopt",
} as const;

export async function prepareOpenSystemCandidate(
  input: { contextId: string; caseId: string },
  world: SystemCandidateWorld,
  ports = livePorts(),
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("System candidate belongs to another context");
  const key = crypto.randomUUID();
  const repoPath = "projects/system-candidate-" + key;
  const otherPath = "sibling-release.md";
  const status = () => ports.vcs.status({ contextId: input.contextId });
  const initial = await status();
  const protectedState = {
    kind: "event" as const,
    eventId: initial.mainEventId,
  };
  async function readInstalled() {
    const repository = await ports.vcs.resolveRepository({
      state: protectedState,
      repoPath: world.unit,
    });
    if (!repository || repository.repoPath !== world.unit)
      throw new Error("The assigned installed System unit is not available");
    const actual = await ports.vcs.readFile({
      state: protectedState,
      repositoryId: repository.repositoryId,
      file: { kind: "path", path: "package.json" },
    });
    if (
      actual?.content.kind !== "text" ||
      typeof JSON.parse(actual.content.text).name !== "string" ||
      sha256HexSyncText(actual.content.text) !== actual.contentHash
    )
      throw new Error("Missing exact installed System manifest");
    return actual.contentHash;
  }
  const installedDigest = await readInstalled();
  const [baseText, oursText, theirsText] = ownedFixture(world);
  const sourceUri = "system-test://system-candidate/" + key;
  const raw = async (
    entries: readonly (readonly [string, string | null])[],
  ) => {
    const files = await Promise.all(
      entries
        .flatMap(([path, value]) =>
          value === null
            ? []
            : [
                async () => {
                  const digest = await ports.putText(value);
                  if (digest !== sha256HexSyncText(value))
                    throw new Error(
                      "System candidate blob did not retain its bytes",
                    );
                  return {
                    path,
                    contentHash: digest,
                    mode: 0o644 as const,
                    size: encoder.encode(value).byteLength,
                  };
                },
              ],
        )
        .map((item) => item()),
    );
    files.sort((left, right) => compareUtf16CodeUnits(left.path, right.path));
    const snapshot = canonicalSnapshotDigest(
      files.map((file) => ({ ...file, mode: 0o100644 as const })),
    );
    return { files: files.map(({ size, ...file }) => file), snapshot };
  };
  const old = await raw([
    [world.document, baseText],
    [otherPath, "Base sibling\n"],
  ]);
  const local = await raw([
    [world.document, oursText],
    [otherPath, "Base sibling\n"],
  ]);
  const incoming = await raw([
    [world.document, theirsText],
    [otherPath, "Incoming sibling\n"],
  ]);
  let repositoryId: string | undefined;
  const envelope = (label: string, expectedWorkingHead: State) => ({
    contextId: input.contextId,
    commandId: key + ":" + label,
    expectedWorkingHead,
    intentSummary: "Review an isolated System template delta",
  });
  async function importReview(
    label: string,
    expected: State,
    source: typeof old,
  ) {
    const receipt = await ports.vcs.importSnapshot({
      ...envelope(label, expected),
      source: {
        kind: "generated",
        uri: sourceUri + "/" + label,
        snapshotRevision: source.snapshot,
      },
      repositories: [
        {
          repoPath,
          files: source.files,
          ...(repositoryId ? { repositoryId } : {}),
        },
      ],
      message: "Retain an isolated System review observation",
    });
    if (
      receipt.importedRepositoryIds.length !== 1 ||
      (repositoryId && repositoryId !== receipt.importedRepositoryIds[0])
    )
      throw new Error("System review lost its exact repository");
    repositoryId = receipt.importedRepositoryIds[0]!;
    return { kind: "event" as const, eventId: receipt.eventId };
  }
  const baseline = await importReview("baseline", initial.workingHead, old);
  const working =
    oursText === baseText
      ? baseline
      : await importReview("working", baseline, local);
  if (!repositoryId)
    throw new Error("Missing scoped System candidate repository");
  const owner = repositoryId;
  const registered = await ports.vcs.registerExternalDelta({
    ...envelope("upstream", working),
    repositoryId: owner,
    repoPath,
    oldSource: {
      kind: "generated",
      uri: sourceUri,
      snapshotRevision: "old",
      snapshot: old.snapshot,
    },
    newSource: {
      kind: "generated",
      uri: sourceUri,
      snapshotRevision: "incoming",
      snapshot: incoming.snapshot,
    },
    oldFiles: old.files,
    newFiles: incoming.files,
  });
  const deltaId = registered.deltaId;
  async function event() {
    const current = await status();
    if (
      current.mainEventId !== initial.mainEventId ||
      current.workingHead.kind !== "event"
    )
      throw new Error("System candidate must preserve protected main");
    return current.workingHead.eventId;
  }
  if ((await event()) !== working.eventId)
    throw new Error("Registration changed the working review");
  const card = {
    id: key,
    title: world.title,
    usual: world.document,
    workingEvent: working.eventId,
    deltaId,
    main: initial.mainEventId,
    mayRecord: world.mayRecord,
    edition: "working" as const,
  };
  const older = {
    ...card,
    id: crypto.randomUUID(),
    title: world.title + " retired review",
    workingEvent: initial.mainEventId,
    deltaId: "retired-unassigned",
    mayRecord: false,
    edition: "retired" as const,
  };
  async function frontier() {
    const comparison = await ports.vcs.compare({
      target: working,
      source: { kind: "external-delta", deltaId },
      limit: 15,
    });
    if (
      !isDeepStrictEqual(comparison.target, working) ||
      comparison.source.kind !== "external-delta" ||
      comparison.source.deltaId !== deltaId ||
      comparison.nextCursor
    )
      throw new Error("Unexpected System delta scope");
    const coordinates = comparison.coordinates
      .filter((item) => item.coordinate.kind === "file")
      .map((item) => ({
        id: item.coordinate.id,
        path:
          item.coordinate.paths.ours ??
          item.coordinate.paths.theirs ??
          item.coordinate.paths.base ??
          "",
        status: item.status,
        aspects: item.aspects.map((aspect) => aspect.aspect),
      }));
    return {
      id: key,
      workingEvent: working.eventId,
      deltaId,
      repository: world.unit,
      installedDigest,
      coordinates,
    };
  }
  const chosen = (state: Awaited<ReturnType<typeof frontier>>) => {
    const matches = state.coordinates.filter(
      (c) =>
        c.path === world.document || c.path === repoPath + "/" + world.document,
    );
    if (matches.length !== 1)
      throw new Error("No unique assigned System file coordinate");
    return matches[0]!;
  };
  async function installedSide(state: State, expected: string | null) {
    const actual = await ports.vcs.readFile({
      state,
      repositoryId: owner,
      file: { kind: "path", path: world.document },
    });
    if (expected === null && !actual) return side(null);
    if (
      actual?.content.kind !== "text" ||
      actual.content.text !== expected ||
      sha256HexSyncText(actual.content.text) !== actual.contentHash
    )
      throw new Error("Retained System candidate readback changed its bytes");
    return side(actual.content.text);
  }
  async function preview(active: Awaited<ReturnType<typeof frontier>>) {
    const base = await installedSide(baseline, baseText);
    const ours = await installedSide(working, oursText);
    const descriptor = incoming.files.find(
      (file) => file.path === world.document,
    );
    const incomingText = descriptor
      ? await ports.getText(descriptor.contentHash)
      : null;
    if (
      (descriptor &&
        (incomingText === null ||
          sha256HexSyncText(incomingText) !== descriptor.contentHash)) ||
      incomingText !== theirsText
    )
      throw new Error(
        "Incoming System preview no longer matches its verified delta",
      );
    return describe(chosen(active), base, ours, side(incomingText));
  }
  const priorScratch = new Set(await listOwnedScratchEntries(ports.fs));
  const writer = bindScratchHandoff(
    ports.fs,
    {
      goal: world.goal,
      questions: ["What changed in the exact System review?"],
      sources: [{ id: "system-candidate", path: "/.tmp/" + key }],
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
  const assign = (id: string, at = working.eventId) => {
    if (id !== key || at !== working.eventId)
      throw new Error("Read only the assigned current System candidate");
  };
  const scope = "owned-system-template-conflict-review";
  let observed: Awaited<ReturnType<typeof frontier>> | undefined;
  let viewed: Preview | undefined;
  let gate: Gate | undefined;
  let receipt: Receipt | null = null;
  let moved = false;
  const digests = (view: Preview) =>
    [view.base.digest, view.ours.digest, view.theirs.digest].filter(
      (digest) => digest !== null,
    );
  const services = {
    systemCandidateRead: {
      async discover() {
        return keep(read, "discover", [], [card, older]);
      },
      async compare(id: string, at: string) {
        assign(id, at);
        observed = await frontier();
        return keep(read, "compare", [id, at], observed);
      },
      async preview(id: string, at: string, coordinate: string) {
        assign(id, at);
        if (!observed || chosen(observed).id !== coordinate)
          throw new Error("Preview only the designated native file coordinate");
        viewed = await preview(observed);
        return keep(read, "preview", [id, at, coordinate], viewed);
      },
      async confirm(id: string, at: string, coordinate: string) {
        assign(id, at);
        if (!viewed || viewed.coordinate.id !== coordinate)
          throw new Error("No observed coordinate for confirmation");
        if (world.moves && !moved) {
          moved = true;
          await importReview(
            "restaged",
            working,
            await raw([
              [world.document, oursText],
              [otherPath, "New local sibling\n"],
            ]),
          );
        }
        const current = await event();
        gate = {
          current: current === at,
          event: current,
          main: initial.mainEventId,
        };
        return keep(read, "confirm", [id, at, coordinate], gate);
      },
      async readback(id: string, path: string | null) {
        assign(id);
        if (path !== (receipt?.path ?? null))
          throw new Error("Read only the scoped private System receipt");
        const bytes = path ? await ports.readBytes(path, maxNote) : null;
        const artifactDigest = bytes
          ? sha256HexSyncText(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            )
          : null;
        return keep(read, "readback", [id, path], {
          event: await event(),
          main: initial.mainEventId,
          artifactDigest,
        });
      },
    },
    systemCandidateHandoff: {
      async record(id: string, at: string, coordinate: string, plan: Plan) {
        assign(id, at);
        if (
          receipt ||
          !card.mayRecord ||
          !gate?.current ||
          !viewed ||
          viewed.coordinate.id !== coordinate ||
          !plan.record ||
          !isDeepStrictEqual(plan.proof, digests(viewed)) ||
          (await event()) !== at
        )
          return keep(write, "record", [id, at, coordinate, plan], null);
        const body = JSON.stringify({
          title: card.title,
          scope,
          deltaId,
          at,
          coordinate,
          plan,
          evidence: {
            base: viewed.base.status,
            ours: viewed.ours.status,
            theirs: viewed.theirs.status,
            composedDigest: viewed.composedDigest,
          },
        });
        const saved = await writer.stage(body);
        if (saved && (await event()) === at)
          receipt = {
            path: saved.path,
            digest: sha256HexSyncText(body),
            event: at,
            coordinate,
          };
        else if (saved)
          await ports.fs.rm(saved.path.slice(0, saved.path.lastIndexOf("/")), {
            recursive: true,
            force: true,
          });
        return keep(write, "record", [id, at, coordinate, plan], receipt);
      },
    },
  };
  type Outcome = {
    scope: string;
    card: typeof card;
    frontier: Awaited<ReturnType<typeof frontier>>;
    preview: Preview;
    plan: Plan;
    gate: Gate;
    receipt: Receipt | null;
    readback: Readback;
  };
  async function verify(value: unknown) {
    const envelope = value as {
      status?: string;
      skill?: string;
      outcome?: Outcome;
    } | null;
    const out = envelope?.outcome;
    const actual = await frontier();
    const exactPreview = await preview(actual);
    const end = await event();
    const path = receipt?.path ?? null;
    const scratch = (await listOwnedScratchEntries(ports.fs)).filter(
      (name) => !priorScratch.has(name),
    );
    const bytes = path ? await ports.readBytes(path, maxNote) : null;
    const body = bytes
      ? new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      : null;
    const readback = journal.find((row) => row.method === "readback")
      ?.result as Readback | undefined;
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
    const target = exactPreview.coordinate.id;
    const checks = {
      exactSystemCandidateFrontier: Boolean(
        out &&
        isDeepStrictEqual(out.card, card) &&
        isDeepStrictEqual(out.frontier, actual) &&
        exact(read, "discover", [], [card, older]) &&
        exact(read, "compare", [key, working.eventId], actual) &&
        actual.coordinates.length >= 2 &&
        actual.installedDigest === (await readInstalled()),
      ),
      exactNativeCoordinateAndSides: Boolean(
        out &&
        isDeepStrictEqual(out.preview, exactPreview) &&
        exact(read, "preview", [key, working.eventId, target], exactPreview) &&
        exactPreview.coordinate.status === nativeStatuses[world.mode],
      ),
      currentSystemReview: Boolean(
        out &&
        gate &&
        isDeepStrictEqual(out.gate, gate) &&
        exact(read, "confirm", [key, working.eventId, target], gate) &&
        gate.event === end &&
        gate.current === !world.moves &&
        (end === working.eventId) === !world.moves,
      ),
      scopedPrivateDiagnosis: Boolean(
        envelope?.status === "workspace-skill-reviewed" &&
        envelope.skill === "systemCandidateTriage" &&
        out?.scope === scope &&
        out.plan.decision === world.decision &&
        out.plan.record === world.record &&
        out.plan.finding.trim() &&
        isDeepStrictEqual(
          out.plan.proof,
          world.moves ? [end] : digests(exactPreview),
        ) &&
        isDeepStrictEqual(out.receipt, receipt) &&
        (world.record
          ? receipt &&
            body &&
            scratch.length === 1 &&
            receipt.event === end &&
            receipt.coordinate === target &&
            sha256HexSyncText(body) === receipt.digest &&
            isDeepStrictEqual(JSON.parse(body), {
              title: card.title,
              scope,
              deltaId,
              at: end,
              coordinate: target,
              plan: out.plan,
              evidence: {
                base: exactPreview.base.status,
                ours: exactPreview.ours.status,
                theirs: exactPreview.theirs.status,
                composedDigest: exactPreview.composedDigest,
              },
            }) &&
            exact(
              write,
              "record",
              [key, working.eventId, target, out.plan],
              receipt,
            )
          : !receipt &&
            !body &&
            !scratch.length &&
            journal.every((row) => row.service !== write)),
      ),
      independentReadbackAndProtectedMain: Boolean(
        out &&
        readback &&
        isDeepStrictEqual(out.readback, readback) &&
        exact(read, "readback", [key, path], readback) &&
        readback.main === initial.mainEventId &&
        readback.event === end &&
        readback.artifactDigest === (receipt?.digest ?? null) &&
        journal.length === (world.record ? 6 : 5),
      ),
    };
    return {
      contextId: input.contextId,
      caseId: world.id,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      card,
      frontier: actual,
      preview: exactPreview,
      gate,
      receipt,
      readback,
      journal: structuredClone(journal),
    };
  }
  async function qualify() {
    const cards = await services.systemCandidateRead.discover();
    const state = await services.systemCandidateRead.compare(
      key,
      working.eventId,
    );
    const target = chosen(state);
    let denied = 0;
    for (const request of [
      () => services.systemCandidateRead.compare(cards[1]!.id, working.eventId),
      () =>
        services.systemCandidateRead.preview(
          key,
          working.eventId,
          state.coordinates.find((c) => c.id !== target.id)!.id,
        ),
    ])
      try {
        await request();
      } catch {
        denied++;
      }
    const viewed = await services.systemCandidateRead.preview(
      key,
      working.eventId,
      target.id,
    );
    const confirmed = await services.systemCandidateRead.confirm(
      key,
      working.eventId,
      target.id,
    );
    const plan: Plan = {
      decision: world.decision,
      record: world.record,
      finding: "Reviewed exact staged System coordinate evidence.",
      proof: world.moves ? [confirmed.event] : digests(viewed),
    };
    const saved = world.record
      ? await services.systemCandidateHandoff.record(
          key,
          working.eventId,
          target.id,
          plan,
        )
      : null;
    const readback = await services.systemCandidateRead.readback(
      key,
      saved?.path ?? null,
    );
    const report = {
      status: "workspace-skill-reviewed",
      skill: "systemCandidateTriage",
      outcome: {
        scope,
        card,
        frontier: state,
        preview: viewed,
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
