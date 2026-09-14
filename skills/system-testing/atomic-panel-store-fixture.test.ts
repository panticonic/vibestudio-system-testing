import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { publishAtomicPanelStoreFixture } from "./atomic-panel-store-fixture.js";

describe("publishAtomicPanelStoreFixture", () => {
  it("imports one canonical snapshot while preserving unrelated meta blobs", async () => {
    const blobs = new Map<string, string>([
      [
        "meta-config",
        fs.readFileSync(
          new URL("../../meta/vibestudio.yml", import.meta.url),
          "utf8",
        ),
      ],
    ]);
    let importedInput: any;
    const blobstore = {
      readText: vi.fn(async (digest: string) => blobs.get(digest) ?? null),
      putText: vi.fn(async (text: string) => {
        const digest = `stored-${blobs.size}`;
        blobs.set(digest, text);
        return { digest, size: text.length };
      }),
    };
    const vcs = {
      status: vi.fn(async () => ({
        workingHead: { kind: "event", eventId: "working" },
        mainEventId: "main",
      })),
      resolveRepository: vi.fn(async () => ({ repositoryId: "meta-id" })),
      listFiles: vi.fn(async () => ({
        files: [
          { path: "z.txt", contentHash: "z-hash", mode: 0o644 },
          { path: "vibestudio.yml", contentHash: "meta-config", mode: 0o644 },
          { path: "a.txt", contentHash: "a-hash", mode: 0o755 },
        ],
        nextCursor: null,
      })),
      importSnapshot: vi.fn(async (input: any) => {
        importedInput = input;
        return {
          eventId: "imported",
          workUnitId: "work",
          importedRepositoryIds: ["meta-id", "panel-id", "worker-id"],
        };
      }),
      inspect: vi.fn(async () => ({
        node: {
          kind: "work-unit",
          value: {
            kind: "import",
            commandId: "system-test:atomic-panel-store:import",
            authoredChangeIds: ["change"],
            externalSnapshot: {
              ...importedInput.source,
              targetRepositoryIds: ["meta-id", "panel-id", "worker-id"],
            },
          },
        },
      })),
      push: vi.fn(async () => ({ mainEventId: "published" })),
    };

    await publishAtomicPanelStoreFixture({
      vcs: vcs as never,
      blobstore,
      contextId: "fixture-context",
    });

    expect(
      importedInput.repositories.map((repository: any) => repository.repoPath),
    ).toEqual(["meta", "panels/atomic-notes", "workers/atomic-notes-store"]);
    for (const repository of importedInput.repositories) {
      const paths = repository.files.map((file: any) => file.path);
      expect(paths).toEqual([...paths].sort());
    }
    const meta = importedInput.repositories[0];
    expect(meta.files).toEqual(
      expect.arrayContaining([
        { path: "a.txt", contentHash: "a-hash", mode: 0o755 },
        { path: "z.txt", contentHash: "z-hash", mode: 0o644 },
      ]),
    );
    const panel = importedInput.repositories[1];
    const worker = importedInput.repositories[2];
    const workerSource = blobs.get(
      worker.files.find((candidate: any) => candidate.path === "index.ts")
        .contentHash,
    );
    expect(workerSource).toContain(
      'website: { kind: "closed", reason: "This receiver owns retained workspace data; websites require a reviewed bounded operation." }',
    );
    const manifestFor = (repository: any) => {
      const file = repository.files.find(
        (candidate: any) => candidate.path === "package.json",
      );
      return JSON.parse(blobs.get(file.contentHash)!);
    };
    const panelManifest = manifestFor(panel);
    expect(panelManifest).toMatchObject({
      private: true,
      type: "module",
      vibestudio: {
        entry: "index.tsx",
        tests: [{ runtime: "browser" }],
        authority: {
          requests: expect.arrayContaining([
            {
              capability: "workspace-service:atomic-notes-store",
              resource: {
                kind: "exact",
                key: "do:workers/atomic-notes-store:NotesStore:workspace",
              },
              tier: "gated",
              evidence: "exact",
            },
          ]),
          serviceRequests: [
            {
              protocol: "system-test.atomic-notes.v1",
              availability: "required",
            },
          ],
        },
      },
      dependencies: {
        "@workspace/runtime": "workspace:*",
        "@workspace/test-runtime": "workspace:*",
      },
    });
    const workerManifest = manifestFor(worker);
    expect(workerManifest).toMatchObject({
      private: true,
      type: "module",
      vibestudio: {
        entry: "index.ts",
        durable: { classes: [{ className: "NotesStore" }] },
        tests: [{ runtime: "workerd" }],
      },
      dependencies: {
        "@workspace/runtime": "workspace:*",
        "@workspace/test-runtime": "workspace:*",
      },
    });
    expect(vcs.push).toHaveBeenCalledWith({
      contextId: "fixture-context",
      commandId: "system-test:atomic-panel-store:push",
      expectedCommittedEventId: "imported",
      expectedMainEventId: "main",
    });
  });
});
