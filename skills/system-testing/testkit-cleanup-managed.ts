import { isDeepStrictEqual } from "node:util";
import { contextId, fs, panelTree, rpc } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import {
  fail,
  openPanel,
  runSuites,
  suite,
  type TestContext,
} from "@workspace/testkit";
import type {
  LiveCleanupEvidence,
  LiveCleanupReport,
  LiveCleanupRequest,
  TestkitOwnedResource,
} from "../session-test-review/types.js";
import { managedTestkitCleanupWorlds } from "./testkit-cleanup-worlds.js";

function world(caseId: string) {
  const found = managedTestkitCleanupWorlds.find(({ id }) => id === caseId);
  if (!found) throw new Error("Unknown managed Testkit cleanup case");
  return found;
}

type Resource = TestkitOwnedResource & {
  present(): Promise<boolean>;
  remove(): Promise<void>;
};
type Assignment = ReturnType<typeof world>["plan"][number];
type Panel = Awaited<ReturnType<typeof openPanel>>;

export async function exerciseTestkitCleanup(
  caseId: string,
): Promise<LiveCleanupEvidence> {
  if (!contextId) throw new Error("Testkit cleanup needs an owned context");
  const scope = contextId;
  const assigned = world(caseId);
  const receipt = `${scope}:testkit-cleanup`;
  const release: LiveCleanupEvidence["release"] = {
    kind: "testkit",
    receipt: `${receipt}:deferred`,
    resources: [],
    released: [],
  };
  const active: { slot: string; resource: Resource }[] = [];
  const panels: Panel[] = [];
  const sentinel = await fs.mkdtemp("testkit-untouched");
  const sentinelText = "Safety register unmodified by the assigned test";
  const sentinelFile = `${sentinel}/register.txt`;
  const eventMarker = "Assigned fixture failure";
  const copy = ({ id, kind }: Resource): TestkitOwnedResource => ({ id, kind });

  async function allocate({ slot, kind }: Assignment): Promise<Resource> {
    switch (kind) {
      case "scratch": {
        const path = await fs.mkdtemp("testkit-cleanup");
        await fs.writeFile(`${path}/evidence.txt`, slot);
        return {
          id: path,
          kind,
          present: () => fs.exists(path),
          remove: () => fs.rm(path, { recursive: true }),
        };
      }
      case "worker": {
        const entity = await rpc.call(
          "main",
          mainRpcMethods["runtime.createEntity"],
          [
            {
              kind: "do",
              execution: {
                surface: "code",
                source: "workers/local-messaging-fixture",
              },
              className: "LocalMessagingProbeDO",
              key: `natlang-cleanup-${crypto.randomUUID()}`,
              contextId: scope,
            },
          ],
        );
        if (entity.contextId !== scope)
          throw new Error("Testkit worker belongs to another context");
        return {
          id: entity.id,
          kind,
          present: async () =>
            (
              await rpc.call("main", mainRpcMethods["runtime.listEntities"], [
                { kind: "do" },
              ])
            ).some(
              ({ id, contextId }) => id === entity.id && contextId === scope,
            ),
          remove: () =>
            rpc.call("main", mainRpcMethods["runtime.retireEntity"], [
              { id: entity.id },
            ]),
        };
      }
      case "panel": {
        const handle = await openPanel("panels/chat", {
          parentId: null,
          ref: `ctx:${scope}`,
          contextId: scope,
          focus: false,
        });
        panels.push(handle);
        return {
          id: handle.id,
          kind,
          present: async () => (await panelTree.path(handle.id)) !== null,
          remove: async () => {
            await handle.archive();
          },
        };
      }
      case "page-client": {
        const handle = panels.at(-1);
        if (!handle)
          throw new Error("Assigned CDP client does not have a panel");
        const { page } = await handle.cdp.session();
        return {
          id: `${handle.id}:cdp:${slot}`,
          kind,
          present: async () => !page.isClosed(),
          remove: async () => {
            await page.close();
          },
        };
      }
      default:
        throw new Error("Unsupported managed Testkit resource");
    }
  }

  async function acquire(t: TestContext, phase: Assignment["phase"]) {
    for (const entry of assigned.plan.filter(
      (candidate) => candidate.phase === phase,
    )) {
      const resource = await allocate(entry);
      active.push({ slot: entry.slot, resource });
      if (!(await resource.present()))
        throw new Error(`Owned resource was never observed: ${entry.slot}`);
      if (entry.cleanup === "unregistered") continue;
      release.resources.push(copy(resource));
      t.defer(async () => {
        try {
          if (entry.cleanup === "nonrecursive") await fs.rmdir(resource.id);
          else await resource.remove();
          if (await resource.present())
            throw new Error(
              `Resource still present after cleanup: ${entry.slot}`,
            );
          if (entry.cleanup === "report-after-release")
            throw new Error(
              `Assigned callback error after release: ${entry.slot}`,
            );
          release.released.push({
            ...copy(resource),
            acknowledgement: "released",
          });
        } catch (error) {
          release.released.push({
            ...copy(resource),
            acknowledgement: "failed",
          });
          throw error;
        }
      });
    }
  }

  try {
    await fs.writeFile(sentinelFile, sentinelText);
    const test = suite("managed-testkit-cleanup", { failOnSupervision: false })
      .beforeEach(async (t) => {
        await acquire(t, "before");
        if (assigned.stop === "before")
          throw new Error(eventMarker + " in setup");
      })
      .test(
        assigned.id,
        async (t) => {
          await acquire(t, "body");
          if (assigned.stop === "assert") fail(eventMarker + " in assertion");
          if (assigned.stop === "throw")
            throw new Error(eventMarker + " in body");
          if (assigned.stop === "timeout" && !t.signal.aborted) {
            await new Promise<void>((resolve) =>
              t.signal.addEventListener("abort", () => resolve(), {
                once: true,
              }),
            );
          }
        },
        { timeoutMs: assigned.stop === "timeout" ? 1_500 : 45_000 },
      )
      .afterEach(async (t) => {
        await acquire(t, "after");
        if (assigned.stop === "after")
          throw new Error(eventMarker + " in after hook");
      });
    const result = (await runSuites(test)).results[0];
    if (!result || result.status === "skipped")
      throw new Error("Testkit did not run the assigned test");
    const remaining = [];
    for (const { resource } of active)
      if (await resource.present()) remaining.push(copy(resource));
    const evidence: LiveCleanupEvidence = {
      receipt,
      outcome: result.status,
      error: result.error?.message ?? null,
      logs: result.logs,
      acquired: active.map(({ resource }) => copy(resource)),
      release,
      remaining,
      protectedUnchanged:
        (await fs.readFile(sentinelFile, "utf8")) === sentinelText,
    };
    const expected = assigned.expected;
    const bySlot = new Map(
      active.map(({ slot, resource }) => [slot, resource.id]),
    );
    const ids = (resources: TestkitOwnedResource[]) =>
      resources.map(({ id }) => id);
    const errorMatches =
      expected.outcome === "passed"
        ? evidence.error === null
        : expected.outcome === "timeout"
          ? evidence.error?.includes("timed out")
          : evidence.error?.startsWith(eventMarker);
    if (
      !errorMatches ||
      expected.outcome !== evidence.outcome ||
      !evidence.protectedUnchanged ||
      !isDeepStrictEqual(
        active.map(({ slot }) => slot),
        assigned.plan.map(({ slot }) => slot),
      ) ||
      !isDeepStrictEqual(
        ids(release.resources),
        assigned.plan
          .filter(({ cleanup }) => cleanup !== "unregistered")
          .map(({ slot }) => bySlot.get(slot)),
      ) ||
      !isDeepStrictEqual(
        ids(release.released),
        ids(release.resources).reverse(),
      ) ||
      !isDeepStrictEqual(
        ids(
          release.released.filter(
            ({ acknowledgement }) => acknowledgement === "failed",
          ),
        ).sort(),
        expected.failed.map((slot) => bySlot.get(slot)).sort(),
      ) ||
      !isDeepStrictEqual(
        ids(remaining),
        expected.remaining.map((slot) => bySlot.get(slot)),
      ) ||
      evidence.logs.filter((line) => line.startsWith("cleanup failed:"))
        .length !== expected.failed.length
    )
      throw new Error(
        `Testkit outcome or live inventory did not match ${caseId}: ${JSON.stringify({ outcome: evidence.outcome, error: evidence.error, logs: evidence.logs, remaining: remaining.map(({ kind }) => kind), active: active.map(({ slot }) => slot) })}`,
      );
    return evidence;
  } finally {
    const errors: unknown[] = [];
    for (const { resource } of active.reverse()) {
      try {
        if (await resource.present()) await resource.remove();
      } catch (error) {
        errors.push(error);
      }
    }
    await fs
      .rm(sentinel, { recursive: true })
      .catch((error) => errors.push(error));
    if (errors.length)
      throw new AggregateError(errors, "Owned Testkit fixture cleanup failed");
  }
}

export async function prepareTestkitCleanup(caseId: string) {
  const assigned = world(caseId);
  const evidence = await exerciseTestkitCleanup(caseId);
  const request: LiveCleanupRequest = {
    goal: assigned.goal,
    receipt: evidence.receipt,
  };
  let read = false;
  const services = {
    testkitCleanup: {
      async inspect(receipt: string) {
        if (read || receipt !== evidence.receipt)
          throw new Error("Read the assigned cleanup receipt once");
        read = true;
        return structuredClone(evidence);
      },
    },
  };
  const reference: LiveCleanupReport = {
    receipt: evidence.receipt,
    testOutcome: assigned.expected.outcome,
    release: {
      decision:
        assigned.expected.release === "testkit-released"
          ? "confirmed"
          : "revise",
      finding: assigned.expected.release,
      evidenceIds: [evidence.release.receipt],
    },
    inventory: assigned.expected.inventory,
    remainingIds: evidence.remaining.map(({ id }) => id),
  };
  function verify(report: unknown) {
    const checks = {
      exactRead: read,
      protectedUnchanged: evidence.protectedUnchanged,
      joinedReport: isDeepStrictEqual(report, reference),
    };
    return {
      caseId,
      evidence,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }
  return {
    request,
    services,
    reference,
    verify,
    firstCase: assigned === managedTestkitCleanupWorlds[0],
  };
}
