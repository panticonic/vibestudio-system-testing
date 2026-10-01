import { browserData, rpc } from "@workspace/runtime";
import { readRetainedChannelReplay } from "./_subagent-evidence.js";
import type {
  TestCase,
  TestExecutionResult,
  TestOrchestrationContext,
} from "../types.js";
import { CREATED_PANEL_STORE_WORKSPACE_REPO_FIXTURE } from "../types.js";
import {
  panelControlAuthorityPolicy,
  PANEL_AUTOMATION_RESOURCE,
} from "../panel-authority.js";
import {
  completedScenarioEvidence,
  walkRecords,
} from "./_scenario-evidence.js";
import { captureTrelloSource } from "./_trello-source-observation.js";
import { getToolCalls } from "./_helpers.js";
import { publishedCommits } from "./_project-evidence.js";
import {
  snapshotVisiblePanelTree,
  panelTreeDifference,
  createdPanelRoots,
} from "./_panel-tree-invariant.js";

type SourceBoard = Awaited<ReturnType<typeof captureTrelloSource>>;

export const prompt =
  "Import browser cookies and all Trello tabs from all Firefox profiles. Build a Trello-style task management app with full Markdown support and per-card histories, comments, attachments, and checklists. Import the data from the vibestudio Trello browser tab into the new app. Verify that it works and that the imported data persists after reload. You may use a subagent for this work.";

/** Trello slugs and filters may change during navigation; the stable board/card ID does not. */
export function trelloTabIdentity(value: string): string | null {
  try {
    const url = new URL(value.replace(/^browser:/, ""));
    if (url.hostname !== "trello.com") return null;
    const match = /^\/(b|c)\/([^/]+)/.exec(url.pathname);
    return match ? match[1] + "/" + match[2] : url.origin + url.pathname;
  } catch {
    return null;
  }
}

/** Live personal-data acceptance, intentionally never part of an automatic suite.
 * The source stays on Trello; cookie plaintext stays in the sealed host vault.
 * Independent read-only browser observations judge migration and persistence. */
async function orchestrate(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const started = Date.now();
  const runner = context.runner;
  const tree = runner.panelTreeClient;
  const before = await snapshotVisiblePanelTree(tree);
  const session = await runner.spawn({ context: "task" });
  const evidence: Record<string, unknown> = {};
  const result: TestExecutionResult = {
    messages: [],
    duration: 0,
    diagnostics: { trelloImport: evidence },
  };
  const handles: Array<Awaited<ReturnType<typeof runner.openPanelClient>>> = [];
  try {
    const inputs = [];
    for (const host of await browserData.listImportHosts()) {
      if (host.location !== "server") continue;
      for (const source of await browserData.listImportSources(host.hostId)) {
        if (source.browser !== "firefox") continue;
        const tabs = (
          await browserData.listOpenTabs(host.hostId, source.sourceId)
        ).filter((tab) => {
          try {
            return new URL(tab.url).hostname === "trello.com";
          } catch {
            return false;
          }
        });
        const preview = await browserData.previewSensitiveImport({
          hostId: host.hostId,
          sourceId: source.sourceId,
          dataTypes: ["cookies"],
        });
        inputs.push({ source, tabs, preview });
      }
    }
    evidence["inputs"] = inputs;
    const boardTab = inputs
      .flatMap((input) => input.tabs)
      .find(
        (tab) =>
          /^https:\/\/trello\.com\/b\//.test(tab.url) &&
          /vibestudio/i.test(tab.title ?? ""),
      );
    if (!boardTab)
      throw new Error("Firefox prerequisite: no vibestudio Trello board tab");
    await context.sendAndWait(
      session,
      prompt,
      "build and migrate task manager",
    );
    result.messages = [...session.messages];
    const deliveredBeforeInspection = await snapshotVisiblePanelTree(tree);
    evidence["browserTabs"] = await Promise.all(
      [...deliveredBeforeInspection.values()]
        .filter((node) => node.kind === "browser" && !before.has(node.id))
        .map(async (node) => {
          const observation = await tree.get(node.id, node.kind).observe();
          return {
            id: node.id,
            source: observation.source,
            url: observation.host?.view.url,
          };
        }),
    );
    const source = await runner.openPanelClient(boardTab.url, {
      parentId: null,
      focus: false,
    });
    handles.push(source);
    const sourcePage = await source.cdp.page();
    let sourceData: SourceBoard;
    try {
      sourceData = (await sourcePage.evaluate(
        captureTrelloSource,
      )) as SourceBoard;
    } finally {
      await sourcePage.close();
      await source.archive();
      handles.pop();
    }
    evidence["source"] = sourceData;
    const build = walkRecords(
      getToolCalls(result).map((c) => c.execution?.result),
    ).find(
      (r) =>
        r["protocol"] === "unit-verification-receipt.v1" &&
        r["status"] === "ok" &&
        typeof (r["unit"] as any)?.repoPath === "string" &&
        (r["unit"] as any).kind === "panel",
    );
    if (!build) throw new Error("No successful exact panel build receipt");
    const panelPath = (build["unit"] as { repoPath: string }).repoPath;
    const contextId = runner.workspaceRepoFixtureContextId;
    if (!contextId) throw new Error("Missing task context");
    const delivered = await snapshotVisiblePanelTree(tree);
    let app: Awaited<ReturnType<typeof runner.openPanelClient>> | undefined;
    for (const node of delivered.values()) {
      if (before.has(node.id) || node.kind !== "workspace") continue;
      const candidate = tree.get(node.id, node.kind);
      const observed = await candidate.observe();
      if (observed.source === panelPath) {
        app = candidate;
        break;
      }
    }
    if (!app)
      throw new Error("No delivered task-management panel in the visible tree");
    const activeApp = app;
    handles.push(activeApp);
    const read = async () => {
      const page = await activeApp.cdp.page();
      try {
        // A delivered panel and reload receipt establish the observation boundary.
        // Expected data is a validation condition, never a readiness condition:
        // missing data must fail validation rather than strand the harness.
        return await page.evaluate(() => document.body.innerText);
      } finally {
        await page.close();
      }
    };
    evidence["panelPath"] = panelPath;
    evidence["beforeReload"] = await read();
    await activeApp.reload();
    evidence["afterReload"] = await read();
    evidence["observation"] = await activeApp.observe();
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    // Delegated work has its own channel. Retain its original evidence before
    // retiring the owning context tree, alongside the parent's trajectory.
    try {
      const children = [];
      for (const message of session.messages) {
        const child = message.task?.subagent;
        if (!child?.taskChannelId || !child.childEntityId) continue;
        children.push({
          runId: message.task!.id,
          taskChannelId: child.taskChannelId,
          childEntityId: child.childEntityId,
          events: await readRetainedChannelReplay(rpc, child.taskChannelId),
          modelExecutionEvidence: await rpc.call(
            child.childEntityId,
            "getModelExecutionEvidence",
            [child.taskChannelId],
          ),
        });
      }
      evidence["subagents"] = children;
    } catch (error) {
      result.error ??= "Subagent evidence capture failed: " + String(error);
    }
    try {
      result.snapshot = session.snapshot();
    } catch (error) {
      result.error ??= "Session snapshot failed: " + String(error);
    }
    result.messages = [...session.messages];
    const cleanup = await Promise.allSettled(
      handles.reverse().map((h) => h.archive()),
    );
    result.cleanupErrors = cleanup.flatMap((r) =>
      r.status === "rejected" ? [String(r.reason)] : [],
    );
    try {
      const after = await snapshotVisiblePanelTree(tree);
      const { createdIds } = panelTreeDifference(before, after);
      for (const root of createdPanelRoots(createdIds, after))
        await tree.get(root.id, root.kind).archive();
    } catch (error) {
      result.cleanupErrors.push(String(error));
    }
    try {
      await session.close();
    } catch (error) {
      result.cleanupErrors.push("Session close failed: " + String(error));
    }
    result.duration = Date.now() - started;
  }
  return result;
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function validateTrelloLiveImport(result: TestExecutionResult) {
  if (result.error) return { passed: false, reason: result.error };
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  if (!publishedCommits(result).length)
    return { passed: false, reason: "No committed and published app" };
  const records = walkRecords(base.evidence.evalValues);
  const sources = (
    (result.diagnostics?.["trelloImport"] as any)?.inputs ?? []
  ).map((input: any) => input.source);
  const observedSources = records.filter(
    (r) => r["browser"] === "firefox" && typeof r["sourceId"] === "string",
  );
  if (
    !sources.length ||
    sources.some(
      (source: any) =>
        !observedSources.some(
          (observed) => observed["sourceId"] === source.sourceId,
        ),
    )
  )
    return { passed: false, reason: "No Firefox source discovery evidence" };
  const completedImports = records.filter(
    (r) =>
      r["state"] === "complete" &&
      Array.isArray(r["counts"]) &&
      (r["counts"] as any[]).some(
        (c) => c.dataType === "cookies" && c.errors === 0,
      ),
  );
  if (
    new Set(completedImports.map((r) => r["operationId"])).size <
    new Set(sources.map((r: Record<string, unknown>) => r["sourceId"])).size
  )
    return {
      passed: false,
      reason:
        "Missing completed sealed cookie import for a discovered Firefox installation",
    };
  const imports = [
    ...new Map(completedImports.map((r) => [r["operationId"], r])).values(),
  ];
  const expectedReads = (
    (result.diagnostics?.["trelloImport"] as any)?.inputs ?? []
  )
    .map(
      (input: any) =>
        input.preview.dataTypes.find((c: any) => c.dataType === "cookies")
          ?.totalItems ?? 0,
    )
    .sort((a: number, b: number) => a - b);
  const actualReads = imports
    .map(
      (r) =>
        (r["counts"] as any[]).find((c) => c.dataType === "cookies")?.read ?? 0,
    )
    .sort((a, b) => a - b);
  const availableReads = [...actualReads];
  for (const count of expectedReads) {
    const index = availableReads.findIndex((read) => read >= count);
    if (index < 0)
      return {
        passed: false,
        reason:
          "Completed cookie imports do not cover the independent Firefox preview counts",
      };
    availableReads.splice(index, 1);
  }
  const e = result.diagnostics?.["trelloImport"] as any;
  const observedTabs = new Set(
    (e?.browserTabs ?? [])
      .flatMap((tab: any) => [tab.source, tab.url])
      .map((url: any) =>
        typeof url === "string" ? trelloTabIdentity(url) : null,
      ),
  );
  const missingTabs = (e?.inputs ?? [])
    .flatMap((input: any) => input.tabs)
    .filter((tab: any) => !observedTabs.has(trelloTabIdentity(tab.url)));
  if (missingTabs.length)
    return {
      passed: false,
      reason: "Not all Firefox Trello tabs were imported as browser panels",
      details: { missingTabCount: missingTabs.length },
    };
  if (!e?.source?.cards?.length)
    return {
      passed: false,
      reason: "Independent source export was empty or unavailable",
    };
  // A generic app may paginate or virtualize its board. Compare visible source
  // content across reload without prescribing the subject's DOM or storage schema.
  const sourceCards = e.source.cards.map((c: any) => normalizedText(c.name));
  for (const phase of ["beforeReload", "afterReload"]) {
    const text = normalizedText(String(e[phase] ?? ""));
    if (
      !text.includes(normalizedText(e.source.title)) ||
      !sourceCards.some((name: string) => name && text.includes(name))
    )
      return {
        passed: false,
        reason: `${phase}: no independently observed imported board and source card`,
      };
  }
  return {
    passed: true,
    details: {
      sourceActiveCards: e.source.cards.length,
      source: e.source,
      panelPath: e.panelPath,
    },
  };
}

export const trelloLiveImportTests: TestCase[] = [
  {
    name: "trello-firefox-live-migration",
    description:
      "Opt-in live Firefox cookie/tab migration, Trello app delivery, and durable board import",
    category: "live-migrations",
    explicitOnly: true,
    requiresUnits: ["extensions/browser-data", "workers/browser-data"],
    timeoutMs: null,
    workspaceRepoFixture: CREATED_PANEL_STORE_WORKSPACE_REPO_FIXTURE,
    resources: [PANEL_AUTOMATION_RESOURCE, "browser:live-firefox-import"],
    authorityPolicy: panelControlAuthorityPolicy("inspect-trello-migration", [
      // The application authors its service name at runtime. Local worker
      // service admission is an expected effect of this isolated app-building
      // case; method effects still enforce their own contracts. Critical
      // maintenance and external capabilities are not covered by this rule.
      {
        ruleId: "use-local-worker-services",
        capability: { kind: "prefix", prefix: "workspace-service:" },
        resource: { kind: "prefix", prefix: "do:workers/" },
        tier: "gated",
        decision: "once",
      },
      ...[
        "listImportHosts",
        "listImportSources",
        "listImportOpenTabs",
        "previewSensitiveImport",
        "startSensitiveImport",
        "observeSensitiveImport",
        "cancelSensitiveImport",
      ].map((method) => ({
        ruleId: "trello-browser-" + method,
        capability: {
          kind: "exact" as const,
          key: "service:browserEnvironment." + method,
        },
        resource: {
          kind: "exact" as const,
          key: "service:browserEnvironment." + method,
        },
        tier: "gated" as const,
        decision: "once" as const,
      })),
    ]),
    prompt,
    orchestrate,
    validate: validateTrelloLiveImport,
  },
];
