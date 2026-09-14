import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { parseWorkspaceConfigContentWithId } from "@vibestudio/workspace/configParser";
import { parseUnitAuthorityManifest } from "@vibestudio/shared/authorityManifest";
import type { VcsClient } from "@workspace/runtime";
import YAML from "yaml";
import { buildProjectManifest } from "@workspace-skills/workspace-dev/project-manifest";

const panelPath = "panels/atomic-notes";
const storePath = "workers/atomic-notes-store";
const protocol = "system-test.atomic-notes.v1";

const panelManifest = buildProjectManifest({
  projectType: "panel",
  name: "atomic-notes",
  title: "Atomic Notes",
  entry: "index.tsx",
  exposeModules: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
  dependencies: { react: "19.2.4", "react-dom": "19.2.4" },
});
const panelVibestudio = panelManifest["vibestudio"] as Record<string, unknown>;
const panelAuthority = panelVibestudio["authority"] as Record<string, unknown>;
panelVibestudio["authority"] = {
  ...panelAuthority,
  requests: [
    ...((panelAuthority["requests"] as unknown[]) ?? []),
    {
      capability: "workspace-service:atomic-notes-store",
      resource: {
        kind: "exact",
        key: "do:workers/atomic-notes-store:NotesStore:workspace",
      },
      tier: "gated",
      evidence: "exact",
    },
  ],
  serviceRequests: [{ protocol, availability: "required" }],
};
parseUnitAuthorityManifest(
  panelVibestudio["authority"],
  "atomic notes panel authority",
);

const panelFiles = {
  "package.json": `${JSON.stringify(panelManifest, null, 2)}\n`,
  "index.tsx": `import { createDurableObjectServiceClient } from "@workspace/runtime";
import { useEffect, useMemo, useState } from "react";

export default function AtomicNotes() {
  const store = useMemo(() => createDurableObjectServiceClient("${protocol}"), []);
  const [stored, setStored] = useState("");
  useEffect(() => { void store.call<{ value: string }>("load").then(({ value }) => setStored(value)); }, [store]);
  return <main><form onSubmit={(event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("note") ?? ""); void store.call("save", { value }).then(() => setStored(value)); }}><input data-testid="note-input" name="note" defaultValue="" /><button data-testid="save-note" type="submit">Save</button></form><output data-testid="stored-note">{stored}</output></main>;
}
`,
};

const storeFiles = {
  "package.json": `${JSON.stringify(
    buildProjectManifest({
      projectType: "worker",
      name: "atomic-notes-store",
      title: "Atomic Notes Store",
      entry: "index.ts",
      durableClasses: ["NotesStore"],
      dependencies: { "@workspace/runtime": "workspace:*" },
    }),
    null,
    2,
  )}\n`,
  "index.ts": `import { DurableObjectBase, rpc } from "@workspace/runtime/worker/kernel";
export class NotesStore extends DurableObjectBase {
  static override schemaVersion = 1;
  protected override createTables() { this.sql.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, value TEXT NOT NULL)"); }
  protected override requiredTables() { return ["notes"]; }
  @rpc({ website: { kind: "closed", reason: "This receiver owns retained workspace data; websites require a reviewed bounded operation." }, principals: ["user", "code"], effect: { kind: "open" }, tier: "open", sensitivity: "write" })
  save(input: { value: string }): void { this.ensureReady(); this.sql.exec("INSERT INTO notes (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value", input.value); }
  @rpc({ website: { kind: "closed", reason: "This receiver owns retained workspace data; websites require a reviewed bounded operation." }, principals: ["user", "code"], effect: { kind: "open" }, tier: "open", sensitivity: "read" })
  load(): { value: string } { this.ensureReady(); const row = this.sql.exec("SELECT value FROM notes WHERE id = 1").toArray()[0] as { value?: string } | undefined; return { value: row?.value ?? "" }; }
}
export default { fetch() { return new Response("Atomic Notes Store"); } };
`,
};

export async function publishAtomicPanelStoreFixture(input: {
  vcs: VcsClient;
  blobstore: {
    readText(digest: string): Promise<string | null>;
    putText(text: string): Promise<{ digest: string; size: number }>;
  };
  contextId: string;
}) {
  const status = await input.vcs.status({ contextId: input.contextId });
  const meta = await input.vcs.resolveRepository({
    state: status.workingHead,
    repoPath: "meta",
  });
  if (!meta)
    throw new Error("Atomic fixture requires the workspace meta repository");
  const metaFiles = [];
  let cursor: string | undefined;
  do {
    const page = await input.vcs.listFiles({
      state: status.workingHead,
      repositoryId: meta.repositoryId,
      limit: 500,
      ...(cursor ? { cursor } : {}),
    });
    metaFiles.push(...page.files);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const configFile = metaFiles.find((file) => file.path === "vibestudio.yml");
  if (!configFile)
    throw new Error("Atomic fixture requires meta/vibestudio.yml");
  const configText = await input.blobstore.readText(configFile.contentHash);
  if (configText === null)
    throw new Error("Atomic fixture could not read meta/vibestudio.yml");
  const document = YAML.parseDocument(configText);
  if (document.errors.length) throw document.errors[0];
  const config = document.toJS() as Record<string, unknown>;
  document.set("services", [
    ...(Array.isArray(config["services"]) ? config["services"] : []),
    {
      source: storePath,
      name: "atomic-notes-store",
      title: "Atomic Notes Store",
      action: "store notes",
      description: "Stores notes for the atomic publication acceptance",
      notability: "everyday",
      presentation: { domain: "automation", verb: "manage" },
      protocols: [protocol],
      authority: {
        principals: ["user", "code"],
        binding: { declaredFor: [panelPath] },
      },
      durableObject: { className: "NotesStore" },
    },
  ]);
  document.set("singletonObjects", [
    ...(Array.isArray(config["singletonObjects"])
      ? config["singletonObjects"]
      : []),
    { source: storePath, className: "NotesStore", key: "workspace" },
  ]);
  const configSource = String(document);
  parseWorkspaceConfigContentWithId(
    configSource,
    "system-test-atomic-panel-store",
  );
  const configBlob = await input.blobstore.putText(configSource);
  const store = async (files: Record<string, string>) =>
    Promise.all(
      Object.entries(files)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(async ([path, content]) => ({
          path,
          contentHash: (await input.blobstore.putText(content)).digest,
          mode: 0o644,
        })),
    );
  const repositories = [
    { repoPath: panelPath, files: await store(panelFiles) },
    { repoPath: storePath, files: await store(storeFiles) },
    {
      repositoryId: meta.repositoryId,
      repoPath: "meta",
      files: [...metaFiles]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((file) =>
          file.path === "vibestudio.yml"
            ? {
                path: file.path,
                contentHash: configBlob.digest,
                mode: file.mode,
              }
            : {
                path: file.path,
                contentHash: file.contentHash,
                mode: file.mode,
              },
        ),
    },
  ].sort((left, right) => left.repoPath.localeCompare(right.repoPath));
  const source = {
    kind: "generated" as const,
    uri: "system-test://atomic-panel-store-install-clearance",
    snapshotRevision: `fixture:${sha256HexSyncText(JSON.stringify(repositories))}`,
  };
  const imported = await input.vcs.importSnapshot({
    contextId: input.contextId,
    commandId: "system-test:atomic-panel-store:import",
    expectedWorkingHead: status.workingHead,
    intentSummary: "Create the atomic notes panel and store",
    source,
    repositories,
    message: "Create atomic notes panel and store",
  });
  const work = await input.vcs.inspect({
    node: { kind: "work-unit", workUnitId: imported.workUnitId },
    edgeLimit: 1,
  });
  if (
    work.node.kind !== "work-unit" ||
    work.node.value.kind !== "import" ||
    work.node.value.commandId !== "system-test:atomic-panel-store:import" ||
    work.node.value.externalSnapshot?.snapshotRevision !==
      source.snapshotRevision ||
    work.node.value.externalSnapshot.targetRepositoryIds.length !== 3
  )
    throw new Error("Atomic fixture import lost exact snapshot causality");
  const pushed = await input.vcs.push({
    contextId: input.contextId,
    commandId: "system-test:atomic-panel-store:push",
    expectedCommittedEventId: imported.eventId,
    expectedMainEventId: status.mainEventId,
  });
  return {
    panelPath,
    storePath,
    contextId: input.contextId,
    importedWorkUnitId: imported.workUnitId,
    importedChangeIds: work.node.value.authoredChangeIds,
    publishedEventId: pushed.mainEventId,
  };
}
