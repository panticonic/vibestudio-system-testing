import { isDeepStrictEqual } from "node:util";
import {
  compareUtf16CodeUnits,
  sha256Hex,
  sha256HexSyncText,
} from "@vibestudio/content-addressing";
import type {
  VcsEditChange,
  VcsMoveSpec,
  VcsStateNodeRef,
} from "@vibestudio/service-schemas/vcs";
import type {
  RuntimeFs,
  VcsClient,
  rpc as RuntimeRpc,
} from "@workspace/runtime";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type {
  AssetDifference,
  AssetIntegrityWorld,
  AssetSeed,
} from "./open-goal-asset-integrity-worlds.js";

type Ports = {
  contextId: string | null;
  vcs: Pick<
    VcsClient,
    | "status"
    | "edit"
    | "move"
    | "commit"
    | "resolveRepository"
    | "listFiles"
    | "readFile"
  >;
  fs: RuntimeFs;
  rpc: Pick<typeof RuntimeRpc, "call">;
};
type Edition = "archive" | "approved" | "working";
type Version = {
  id: string;
  edition: Edition;
  bundle: string;
  dossier: string;
};
type Claim = {
  key: string;
  path: string;
  digest: string;
  mode: number;
  output: string;
};
type Manifest = {
  bundle: string;
  edition: string;
  release: AssetIntegrityWorld["release"];
  assets: Claim[];
};
type File = {
  id: string;
  path: string;
  digest: string;
  mode: number;
  size: number;
  type: "text" | "bytes";
};
type Inspection = File & { manifest: Manifest | null };
type Selection = { id: string; digest: string; output: string };
type Receipt = {
  directory: string;
  manifestDigest: string;
  source: string;
  files: Selection[];
};
type Stage =
  | { status: "staged"; receipt: Receipt }
  | { status: "changed"; working: string }
  | { status: "held"; reason: string };
type Finding = {
  key: string;
  retained: string | null;
  working: string | null;
  differences: AssetDifference[];
};
type Outcome = {
  status: string;
  approved: string;
  working: string;
  findings: Finding[];
  receipt: Receipt | null;
  reason: string;
};
type Entry = {
  service: "assetHistory" | "assetRecovery";
  method: string;
  args: unknown[];
  result: unknown;
};
const dossier = "release-manifest.json";
const manifestOutput = "verified-bundle.json";
const token = (state: VcsStateNodeRef) => JSON.stringify(state);
const maximum = 4096;
const mode = 0o644;
const byteArray = (base64: string) =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const textContent = (text: string) => ({ kind: "text" as const, text });
const binaryContent = (bytes: Uint8Array) => ({
  kind: "bytes" as const,
  base64: encode(bytes),
});
const writer = new TextEncoder();

function assetBytes(asset: AssetSeed, version: number) {
  const salt = [...asset.key].reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  const payload = Uint8Array.from(
    { length: 24 },
    (_, i) => (salt * (i + 1) + version * 43) % 256,
  );
  if (asset.format === "bin") return payload;
  if (asset.format === "pgm") {
    const header = writer.encode("P5\n6 4\n255\n");
    return Uint8Array.from([...header, ...payload]);
  }
  const bytes = new Uint8Array(44 + payload.length);
  const header = new DataView(bytes.buffer);
  bytes.set(writer.encode("RIFF"), 0);
  header.setUint32(4, 36 + payload.length, true);
  bytes.set(writer.encode("WAVEfmt "), 8);
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, 16000, true);
  header.setUint32(28, 16000, true);
  header.setUint16(32, 1, true);
  header.setUint16(34, 8, true);
  bytes.set(writer.encode("data"), 36);
  header.setUint32(40, payload.length, true);
  bytes.set(payload, 44);
  return bytes;
}

function buildManifest(world: AssetIntegrityWorld, edition: Edition): Manifest {
  return {
    bundle: world.bundle,
    edition,
    release:
      edition === "archive"
        ? "verified"
        : edition === "working"
          ? "review"
          : world.release,
    assets: world.assets.map((asset) => ({
      key: asset.key,
      path: asset.path,
      output: asset.output,
      digest: sha256Hex(
        assetBytes(
          asset,
          edition === "archive" ? 0 : asset.badClaim === "digest" ? 2 : 1,
        ),
      ),
      mode: edition === "approved" && asset.badClaim === "mode" ? 0o755 : mode,
    })),
  };
}
const manifestText = (world: AssetIntegrityWorld, edition: Edition) =>
  JSON.stringify(buildManifest(world, edition)) + "\n";

export async function prepareOpenAssetIntegrity(
  input: { contextId: string; caseId: string },
  world: AssetIntegrityWorld,
  ports: Ports,
) {
  const { vcs, fs, rpc } = ports;
  const { contextId } = input;
  if (contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("Asset integrity requires its assigned local context");
  const status = () => vcs.status({ contextId });
  const baseline = await status();
  const scope = crypto.randomUUID();
  const repoPath = "projects/asset-integrity-" + scope.slice(0, 12);
  const draft = (head: VcsStateNodeRef, label: string) => ({
    contextId,
    expectedWorkingHead: head,
    commandId: scope + ":" + label,
  });
  const created = await vcs.edit({
    ...draft(baseline.workingHead, "archive-work"),
    changes: [
      {
        kind: "repository-create",
        repoPath,
        files: [
          ...world.assets.map((asset) => ({
            path: asset.path,
            content: binaryContent(assetBytes(asset, 0)),
            mode,
          })),
          {
            path: dossier,
            content: textContent(manifestText(world, "archive")),
            mode,
          },
        ],
      },
    ],
  });
  const commit = async (
    head: VcsStateNodeRef,
    label: string,
  ): Promise<VcsStateNodeRef> => {
    const result = await vcs.commit({ ...draft(head, label), message: label });
    if (result.event.kind !== "event")
      throw new Error("The retained asset snapshot was not committed");
    return result.event;
  };
  const archive = await commit(
    created.workingHead,
    "Retain owned original asset archive",
  );
  const repo = await vcs.resolveRepository({ state: archive, repoPath });
  if (!repo || repo.repoPath !== repoPath)
    throw new Error("The private asset archive repository was not retained");
  const repositoryId = repo.repositoryId;
  async function list(state: VcsStateNodeRef): Promise<File[]> {
    const page = await vcs.listFiles({ state, repositoryId, limit: 40 });
    if (
      page.repositoryId !== repositoryId ||
      !isDeepStrictEqual(page.state, state) ||
      page.nextCursor !== null
    )
      throw new Error(
        "Asset list does not identify the complete retained repository",
      );
    return page.files.map((file) => ({
      id: file.fileId,
      path: file.path,
      digest: file.contentHash,
      mode: file.mode,
      size: file.byteLength,
      type: file.contentKind,
    }));
  }
  async function read(state: VcsStateNodeRef, file: File) {
    const result = await vcs.readFile({
      state,
      repositoryId,
      file: { kind: "id", fileId: file.id },
    });
    if (
      !result ||
      result.repoPath !== repoPath ||
      result.repositoryId !== repositoryId ||
      result.fileId !== file.id ||
      result.path !== file.path ||
      result.contentHash !== file.digest ||
      result.mode !== file.mode ||
      result.content.kind !== file.type
    )
      throw new Error(
        "Semantic asset file moved outside the observed coordinate",
      );
    const bytes =
      result.content.kind === "bytes"
        ? byteArray(result.content.base64)
        : writer.encode(result.content.text);
    if (
      bytes.length !== file.size ||
      bytes.length > maximum ||
      sha256Hex(bytes) !== file.digest
    )
      throw new Error(
        "Retained asset bytes do not match the original exact digest",
      );
    const manifest =
      result.path === dossier && result.content.kind === "text"
        ? (JSON.parse(result.content.text) as Manifest)
        : null;
    return { bytes, value: { ...file, manifest } satisfies Inspection };
  }
  const archiveList = await list(archive);
  const manifestFile = (files: File[]) => {
    const manifest = files.find((file) => file.path === dossier);
    if (!manifest) throw new Error("The retained asset dossier is missing");
    return manifest;
  };
  const original = (files: File[], asset: AssetSeed) =>
    files.find((file) => file.path === asset.path);
  const originals = world.assets.map((asset) => ({
    asset,
    id: original(archiveList, asset)!.id,
  }));
  const signingChanges: VcsEditChange[] = originals.map(
    ({ asset, id: fileId }) =>
      asset.badClaim === "missing"
        ? { kind: "file-delete", repositoryId, fileId }
        : {
            kind: "content-replace",
            repositoryId,
            fileId,
            content: binaryContent(assetBytes(asset, 1)),
          },
  );
  signingChanges.push({
    kind: "content-replace",
    repositoryId,
    fileId: manifestFile(archiveList).id,
    content: textContent(manifestText(world, "approved")),
  });
  const signing = await vcs.edit({
    ...draft(archive, "signed-work"),
    changes: signingChanges,
  });
  const approved = await commit(
    signing.workingHead,
    "Retain signed asset package",
  );
  const approvedList = await list(approved);
  const changes: VcsEditChange[] = [
    {
      kind: "content-replace",
      repositoryId,
      fileId: manifestFile(approvedList).id,
      content: textContent(manifestText(world, "working")),
    },
  ];
  const creates: VcsEditChange[] = [];
  const moves: VcsMoveSpec[] = [];
  for (const asset of world.assets) {
    const fileId = original(approvedList, asset)?.id;
    if (!fileId || asset.drift === "replace" || asset.drift === "clone") {
      if (fileId) changes.push({ kind: "file-delete", repositoryId, fileId });
      creates.push({
        kind: "file-create",
        repositoryId,
        path: asset.path,
        content: binaryContent(
          assetBytes(asset, asset.drift === "clone" ? 1 : 2),
        ),
        mode,
      });
      continue;
    }
    if (asset.drift === "lost")
      changes.push({ kind: "file-delete", repositoryId, fileId });
    if (asset.drift === "overwrite" || asset.drift === "move-bytes")
      changes.push({
        kind: "content-replace",
        repositoryId,
        fileId,
        content: binaryContent(assetBytes(asset, 2)),
      });
    if (asset.drift === "mode" || asset.drift === "move-mode")
      changes.push({ kind: "file-mode", repositoryId, fileId, mode: 0o755 });
    if (
      asset.drift === "move" ||
      asset.drift === "move-bytes" ||
      asset.drift === "move-mode"
    )
      moves.push({
        kind: "file",
        repositoryId,
        fileId,
        destinationRepositoryId: repositoryId,
        destinationPath: "reorganized/" + asset.output,
      });
  }
  let working = (await vcs.edit({ ...draft(approved, "working"), changes }))
    .workingHead;
  if (creates.length)
    working = (
      await vcs.edit({
        ...draft(working, "working-replacements"),
        changes: creates,
      })
    ).workingHead;
  if (moves.length)
    working = (await vcs.move({ ...draft(working, "working-moves"), moves }))
      .workingHead;
  const initialWorking = working;
  const initialWorkingList = await list(working);
  const initialVersion = token(initialWorking);
  const sourceToken = token(approved);
  const seen = new Map<
    string,
    {
      state: VcsStateNodeRef;
      edition: Edition;
      fileIds: Map<string, File>;
      inspected: Set<string>;
    }
  >();
  const journal: Entry[] = [];
  const directory = await fs.mkdtemp("asset-integrity");
  const pending = directory + "/stage";
  const final = directory + "/verified";
  const close = () => fs.rm(directory, { recursive: true, force: true });
  let receipt: Receipt | null = null;
  let staging = false;
  let race = false;

  const record = <T>(
    service: Entry["service"],
    method: string,
    args: unknown[],
    result: T,
  ): T => {
    journal.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };
  function open(id: string) {
    const record = seen.get(id);
    if (!record)
      throw new Error("The VCS state is outside the owned asset dossier");
    return record;
  }
  async function assertHead() {
    const head = await status();
    if (
      head.mainEventId !== baseline.mainEventId ||
      head.contextId !== contextId ||
      !isDeepStrictEqual(head.committed, approved)
    )
      throw new Error("Protected main or committed asset authority changed");
    return head.workingHead;
  }

  function expectedFindings(files: File[]): Finding[] {
    return world.expected.findings.map((expected) => {
      const asset = world.assets.find((item) => item.key === expected.key)!;
      const retained = original(approvedList, asset);
      const target = retained
        ? (files.find((item) => item.id === retained.id) ??
          original(files, asset))
        : null;
      return {
        key: expected.key,
        retained: retained?.id ?? null,
        working: target?.id ?? null,
        differences: expected.differences,
      };
    });
  }

  function selectionFiles(selection: Selection[], claims: Manifest) {
    const requested = new Set(selection.map((file) => file.id));
    const candidates = claims.assets.flatMap((claim) => {
      const file = approvedList.find((item) => item.path === claim.path);
      return file && requested.has(file.id) ? [{ file, claim }] : [];
    });
    if (
      requested.size !== selection.length ||
      candidates.length !== selection.length ||
      !candidates.every(
        ({ file, claim }, index) =>
          world.permitted.includes(claim.key) &&
          file.digest === claim.digest &&
          file.mode === claim.mode &&
          file.type === "bytes" &&
          selection[index]?.id === file.id &&
          selection[index]?.digest === file.digest &&
          selection[index]?.output === claim.output &&
          /^[a-z0-9][a-z0-9-]*\.(wav|pgm|bin)$/u.test(claim.output),
      )
    )
      return null;
    return candidates;
  }

  const manifestBytes = (basis: string, wanted: Selection[]) =>
    JSON.stringify({
      schema: "vibestudio.verified-assets/1",
      accepted: sourceToken,
      working: basis,
      files: wanted,
    }) + "\n";
  const equalBytes = (one: Uint8Array, two: Uint8Array) =>
    one.length === two.length &&
    one.every((value, index) => value === two[index]);
  async function verifyOutput(
    output: string,
    args: Selection[],
    basis: string,
  ) {
    const names = [...args.map((file) => file.output), manifestOutput].sort();
    if (!isDeepStrictEqual((await fs.readdir(output)).sort(), names))
      return null;
    for (const selected of args) {
      const native = await read(
        approved,
        approvedList.find((file) => file.id === selected.id)!,
      );
      const local = await readWorkspaceBytes(
        rpc,
        output + "/" + selected.output,
        maximum,
      );
      if (
        !equalBytes(local, native.bytes) ||
        ((await fs.stat(output + "/" + selected.output)).mode & 0o777) !==
          native.value.mode
      )
        return null;
    }
    const text = String(
      await fs.readFile(output + "/" + manifestOutput, "utf8"),
    );
    if (text !== manifestBytes(basis, args)) return null;
    return text;
  }

  const services = {
    assetHistory: {
      async discover(): Promise<Version[]> {
        const current = await assertHead();
        const states = [
          { state: archive, edition: "archive" },
          { state: approved, edition: "approved" },
          { state: current, edition: "working" },
        ] as const;
        const versions = await Promise.all(
          states.map(async ({ state, edition }) => {
            const id = token(state);
            const fileIds = new Map(
              (await list(state)).map((file) => [file.id, file]),
            );
            if (!seen.has(id))
              seen.set(id, { state, edition, fileIds, inspected: new Set() });
            return {
              id,
              edition,
              bundle: world.bundle,
              dossier: manifestFile([...fileIds.values()]).id,
            };
          }),
        );
        return record("assetHistory", "discover", [], versions);
      },
      async listFiles(version: string) {
        const view = open(version);
        return record(
          "assetHistory",
          "listFiles",
          [version],
          await list(view.state),
        );
      },
      async inspect(version: string, fileId: string) {
        const view = open(version);
        const file = view.fileIds.get(fileId);
        if (!file)
          throw new Error(
            "The asset ID is not present at the observed owned revision",
          );
        const { value } = await read(view.state, file);
        view.inspected.add(fileId);
        return record("assetHistory", "inspect", [version, fileId], value);
      },
    },
    assetRecovery: {
      async stage(
        source: string,
        workingRevision: string,
        selection: Selection[],
      ): Promise<Stage> {
        if (
          source !== sourceToken ||
          open(workingRevision).edition !== "working" ||
          !selection.length ||
          receipt ||
          staging
        )
          throw new Error(
            "Expected one authorized copy from the exact signed asset event",
          );
        const accepted = open(source);
        if (
          !accepted.inspected.has(manifestFile(approvedList).id) ||
          !selection.every((pick) => accepted.inspected.has(pick.id))
        )
          throw new Error(
            "Read the signed manifest and original asset coordinates first",
          );
        staging = true;
        const finish = (result: Stage) =>
          record(
            "assetRecovery",
            "stage",
            [source, workingRevision, selection],
            result,
          );
        try {
          const { value } = await read(approved, manifestFile(approvedList));
          const candidates =
            value.manifest?.release === "verified"
              ? selectionFiles(selection, value.manifest)
              : null;
          if (!candidates)
            return finish({
              status: "held",
              reason:
                "The complete selection lacks verified manifest authority.",
            });
          const now = await assertHead();
          if (token(now) !== workingRevision)
            return finish({ status: "changed", working: token(now) });
          if (world.coedit && !race) {
            const advanced = await vcs.edit({
              ...draft(now, "parallel-desk-note"),
              changes: [
                {
                  kind: "file-create",
                  repositoryId,
                  path: "incoming-desk-note.txt",
                  content: textContent(
                    "Another reviewer confirmed the working inventory independently.\n",
                  ),
                  mode,
                },
              ],
            });
            working = advanced.workingHead;
            race = true;
            return finish({ status: "changed", working: token(working) });
          }
          await fs.mkdir(pending);
          try {
            for (const { file, claim } of candidates) {
              const bytes = (await read(approved, file)).bytes;
              await fs.writeFile(pending + "/" + claim.output, bytes);
              await fs.chmod(pending + "/" + claim.output, file.mode);
            }
            await fs.writeFile(
              pending + "/" + manifestOutput,
              manifestBytes(workingRevision, selection),
            );
            const verified = await verifyOutput(
              pending,
              selection,
              workingRevision,
            );
            if (verified === null)
              throw new Error(
                "Private copies do not match signed bytes and mode",
              );
            const confirmed = await assertHead();
            if (token(confirmed) !== workingRevision)
              return finish({ status: "changed", working: token(confirmed) });
            await fs.rename(pending, final);
            const readback = await verifyOutput(
              final,
              selection,
              workingRevision,
            );
            if (readback === null)
              throw new Error(
                "Renamed private copies failed independent readback",
              );
            const latest = await assertHead();
            if (token(latest) !== workingRevision) {
              await fs.rm(final, { recursive: true, force: true });
              return finish({ status: "changed", working: token(latest) });
            }
            receipt = {
              directory: final,
              manifestDigest: sha256HexSyncText(readback),
              source,
              files: selection,
            };
            return finish({ status: "staged", receipt });
          } catch (error) {
            await fs.rm(final, { recursive: true, force: true });
            throw error;
          } finally {
            await fs.rm(pending, { recursive: true, force: true });
          }
        } finally {
          staging = false;
        }
      },
    },
  };

  const copies = (keys: readonly string[]): Selection[] =>
    world.assets.flatMap((asset) => {
      const file = original(approvedList, asset);
      return keys.includes(asset.key) && file
        ? [{ id: file.id, digest: file.digest, output: asset.output }]
        : [];
    });
  async function verify(value: unknown) {
    const report = value as {
      status?: string;
      skill?: string;
      outcome?: Outcome;
    } | null;
    const outcome = report?.outcome;
    const current = await assertHead();
    const currentToken = token(current);
    const currentFiles = await list(current);
    const findings = expectedFindings(currentFiles);
    const requested = copies(world.expected.copies);
    const output = receipt
      ? await verifyOutput(final, requested, currentToken)
      : null;
    const attempts = journal.filter((entry) => entry.method === "stage");
    const revisions = [token(archive), sourceToken, currentToken];
    const checkedRevisions = await Promise.all(
      revisions.map(async (revision) => {
        const view = seen.get(revision);
        if (
          !view ||
          !journal.some(
            (entry) =>
              entry.method === "listFiles" && entry.args[0] === revision,
          )
        )
          return false;
        const rows = await list(view.state);
        if (!rows.every((row) => view.inspected.has(row.id))) return false;
        const witnesses = await Promise.all(
          rows.map((row) => read(view.state, row)),
        );
        return (
          witnesses.find((item) => item.value.path === dossier)?.value.manifest
            ?.edition === view.edition
        );
      }),
    );
    const expectedWorking = [...initialWorkingList];
    if (world.coedit)
      expectedWorking.push(
        currentFiles.find((file) => file.path === "incoming-desk-note.txt")!,
      );
    const checks = {
      boundAssetHistory:
        checkedRevisions.every(Boolean) &&
        seen.get(sourceToken)?.state.kind === "event",
      joinedAssetIntegrityFinding:
        report?.status === "workspace-skill-reviewed" &&
        report.skill === "assetIntegrity" &&
        outcome?.approved === sourceToken &&
        outcome.working === currentToken &&
        isDeepStrictEqual(outcome.findings, findings),
      preservedOwnedAssetBasis:
        isDeepStrictEqual(current, working) &&
        isDeepStrictEqual(
          [...currentFiles].sort((left, right) =>
            compareUtf16CodeUnits(left.path, right.path),
          ),
          expectedWorking.sort((left, right) =>
            compareUtf16CodeUnits(left.path, right.path),
          ),
        ) &&
        (world.coedit
          ? race &&
            currentToken !== initialVersion
          : !race && currentToken === initialVersion),
      matchedAssetDisposition:
        outcome?.status === world.expected.status &&
        typeof outcome.reason === "string" &&
        Boolean(outcome.reason.trim()) &&
        world.expected.reason.every((term) =>
          outcome.reason.toLowerCase().includes(term),
        ),
      independentlyReadExactRecovery: world.expected.copies.length
        ? Boolean(
            output &&
            receipt &&
            isDeepStrictEqual(receipt.files, requested) &&
            receipt.manifestDigest === sha256HexSyncText(output) &&
            isDeepStrictEqual(outcome?.receipt, receipt) &&
            isDeepStrictEqual(await fs.readdir(directory), ["verified"]) &&
            attempts.some(attempt => (attempt.result as Stage).status === "staged" &&
              isDeepStrictEqual((attempt.result as {receipt?:Receipt}).receipt, receipt)),
          )
        : receipt === null &&
          outcome?.receipt === null &&
          (await fs.readdir(directory)).length === 0 &&
          attempts.every(attempt => (attempt.result as Stage).status !== "staged"),
    };
    return {
      contextId,
      caseId: input.caseId,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      approved: sourceToken,
      working: currentToken,
      findings,
      receipt,
      receiptBytes: output,
      journal,
    };
  }

  async function qualify() {
    async function observe() {
      const revisions = await services.assetHistory.discover();
      for (const { id } of revisions) {
        const files = await services.assetHistory.listFiles(id);
        for (const file of files)
          await services.assetHistory.inspect(id, file.id);
      }
      return revisions;
    }
    await observe();
    let rejectedAlias = false;
    try {
      await services.assetHistory.inspect(
        sourceToken,
        "unowned-file-coordinate",
      );
    } catch {
      rejectedAlias = true;
    }
    let rejectedSource = false;
    try {
      await services.assetRecovery.stage(
        token(archive),
        initialVersion,
        copies(world.permitted),
      );
    } catch {
      rejectedSource = true;
    }
    let stage: Stage | null = null;
    if (world.expected.copies.length || world.coedit)
      stage = await services.assetRecovery.stage(
        sourceToken,
        initialVersion,
        copies(world.permitted),
      );
    if (stage?.status === "changed") {
      await observe();
      if (world.coedit === "refresh")
        stage = await services.assetRecovery.stage(
          sourceToken,
          stage.working,
          copies(world.expected.copies),
        );
    }
    const outcome = {
      approved: sourceToken,
      working: token(working),
      status: world.expected.status,
      findings: expectedFindings(await list(working)),
      receipt: stage?.status === "staged" ? stage.receipt : null,
      reason:
        world.expected.reason.join(" ") ||
        "Verified exact signed and working byte evidence",
    };
    const proof = await verify({
      status: "workspace-skill-reviewed",
      skill: "assetIntegrity",
      outcome,
    });
    return {
      ...proof,
      passed: proof.passed && rejectedAlias && rejectedSource,
      checks: {
        ...proof.checks,
        rejectedUnassignedAssetEvidence: rejectedAlias && rejectedSource,
      },
    };
  }
  return { goal: world.goal, services, verify, qualify, close };
}
