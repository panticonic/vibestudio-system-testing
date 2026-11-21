import { panelTree, rpc, vcs } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { evalInPanel, waitFor } from "@workspace/testkit";
import { bindLiveTendril } from "@workspace-skills/tendrils/live";
import type {
  TendrilPage,
  TendrilPresentation,
  TendrilReport,
} from "@workspace-skills/tendrils/workflow/types";
import {
  hasTendrilBuildSteps,
  managedTendrilWorlds,
  type ManagedTendrilWorld,
  tendrilCandidateBuild,
  tendrilPanel,
} from "./tendril-worlds.js";

const fields = ["minutes", "phase", "confirmed", "label"];
const functions = [
  "acknowledge",
  "clearReview",
  "startReview",
  "returnToIntake",
  "clearTimer",
];
const boardHeadings = new Map([
  ["board-v1", "Handoff board"],
  ["board-review", "Review handoff"],
  ["board-incident", "Incident handoff"],
  ["board-broken", "Unreleased handoff"],
]);
const observeBoard = `(() => {
  const board = document.querySelector("[data-tendril-build]");
  if (board?.dataset.tendrilStatus === "error") throw new Error(board.querySelector("[role=alert]")?.textContent);
  if (board?.dataset.tendrilStatus !== "ready") return null;
  return {
    build: board.dataset.tendrilBuild,
    heading: board.querySelector("h1")?.textContent,
    displayed: Array.from(board.querySelectorAll("[data-tendril-field]"), (field) => ({
      key: field.dataset.tendrilField,
      value: JSON.parse(field.textContent),
    })),
  };
})()`;

export function prepareManagedTendril(input: {
  caseId: string;
  contextId: string;
  channelId: string;
}, override?: ManagedTendrilWorld) {
  const assigned = override ?? managedTendrilWorlds.find(({ id }) => id === input.caseId);
  if (!assigned || assigned.id !== input.caseId) throw new Error("Unknown Tendril assignment");
  const world = assigned;
  const { request } = world;
  const buildWorld = hasTendrilBuildSteps(request);
  let originalSource: string | undefined;
  const edits: { candidate: string; commandId: string }[] = [];

  async function stageCandidate(candidate: string) {
    const key = Object.keys(tendrilCandidateBuild).find(
      (entry) => entry === candidate,
    );
    if (!key) throw new Error("Unknown staged Tendril build");
    const { workingHead } = await vcs.status({ contextId: input.contextId });
    const repository = await vcs.resolveRepository({
      state: workingHead,
      repoPath: tendrilPanel,
    });
    if (!repository)
      throw new Error("Tendril fixture repository is unavailable");
    const file = await vcs.readFile({
      state: workingHead,
      repositoryId: repository.repositoryId,
      file: { kind: "path", path: "index.tsx" },
    });
    if (file?.content.kind !== "text")
      throw new Error("Tendril entry source is unavailable");
    originalSource ??= file.content.text;
    if (!originalSource.includes('data-tendril-build="board-v1"'))
      throw new Error("Tendril board build marker is unavailable");
    const marker =
      tendrilCandidateBuild[key as keyof typeof tendrilCandidateBuild];
    const heading = boardHeadings.get(marker);
    if (!heading || !originalSource.includes("<h1>Handoff board</h1>"))
      throw new Error("Tendril board heading is unavailable");
    let text = originalSource
      .replace(
        'data-tendril-build="board-v1"',
        `data-tendril-build="${marker}"`,
      )
      .replace("<h1>Handoff board</h1>", `<h1>${heading}</h1>`);
    if (key === "broken-boot")
      text +=
        '\nthrow new Error("Assigned Tendril candidate failed at boot");\n';
    const commandId = `tendril-candidate:${crypto.randomUUID()}`;
    const edited = await vcs.edit({
      contextId: input.contextId,
      expectedWorkingHead: workingHead,
      commandId,
      intentSummary: `Prepare the assigned Tendril candidate ${key}`,
      changes: [
        {
          kind: "content-replace",
          repositoryId: repository.repositoryId,
          fileId: file.fileId,
          content: { kind: "text", text },
        },
      ],
    });
    if (
      edited.commandId !== commandId ||
      edited.contextId !== input.contextId ||
      edited.changeCount !== 1
    )
      throw new Error(
        "Tendril source edit did not establish the assigned candidate",
      );
    edits.push({ candidate, commandId });
  }
  const bound = bindLiveTendril(request, {
    tendril: {
      contextId: input.contextId,
      channelId: input.channelId,
      source: tendrilPanel,
      name: "Tendril workflow handoff board",
      ref: `ctx:${input.contextId}`,
    },
    fields,
    functions,
    async readPage(tendril, slotId, expected) {
      await waitFor(
        async () => {
          const description = await tendril.describe();
          return (
            description.functions.filter((fn) => fn.slotId === slotId)
              .length === functions.length || undefined
          );
        },
        { label: "the live board registers its exposed controls" },
      );
      return await waitFor(
        async () => {
          const page = (await tendril.eval(observeBoard, { slotId })) as
            | (Pick<TendrilPage, "build" | "displayed"> & { heading: string })
            | null;
          if (!page) return undefined;
          if (page.heading !== boardHeadings.get(page.build))
            throw new Error(
              "The Tendril board does not show its assigned layout",
            );
          if (expected) {
            const { state, rev } = await tendril.state.get();
            const { key, value } = expected.field;
            if (
              rev < expected.minRevision ||
              state[key] !== value ||
              !page.displayed.some(
                (entry) => entry.key === key && entry.value === value,
              )
            )
              return undefined;
          }
          return page;
        },
        { label: "the rendered and durable board agree" },
      );
    },
    stageCandidate,
  });

  let presentation: TendrilPresentation | null = null;
  const observed: TendrilPage[] = [];
  type Proof = {
    entryKey: string;
    buildKey: string | null;
    state: "unproven" | "proven" | "failed";
  };
  const panels: { buildKey: string; proof: Proof[] }[] = [];
  const outcomes: {
    pageId: string;
    outcome: "proven" | "failed" | "pending-device" | "restored";
  }[] = [];
  const read = async (result: Promise<TendrilPage>) => {
    const page = await result;
    if (buildWorld) {
      const panel = await panelTree.get(page.slotId).observe();
      if (
        panel.contextId !== input.contextId ||
        panel.source !== tendrilPanel ||
        panel.phase !== "ready" ||
        !panel.buildKey
      )
        throw new Error(
          "Tendril build readback does not identify a ready assigned presentation",
        );
      const proof = await rpc.call(
        "main",
        mainRpcMethods["panelRuntime.historyProof"],
        [page.slotId],
      );
      panels.push({
        buildKey: panel.buildKey,
        proof: proof.map(({ entryKey, buildKey, state }) => ({
          entryKey,
          buildKey,
          state,
        })),
      });
    }
    observed.push(structuredClone(page));
    return page;
  };
  const services = {
    tendrilBuild: {
      async update(candidate: string) {
        const result = await bound.services.tendrilBuild.update(candidate);
        if (result.page) {
          await read(Promise.resolve(result.page));
          outcomes.push({ pageId: result.page.id, outcome: result.outcome });
        }
        return result;
      },
      async back() {
        const page = await read(bound.services.tendrilBuild.back());
        outcomes.push({ pageId: page.id, outcome: "restored" });
        return page;
      },
    },
    tendrilPresentation: {
      ...bound.services.tendrilPresentation,
      async present(deviceId: string) {
        presentation =
          await bound.services.tendrilPresentation.present(deviceId);
        if (presentation.state === "presented") {
          // The headless device demand-loads the assigned panel when its test driver observes it.
          await evalInPanel(
            panelTree.get(presentation.slotId),
            "document.readyState",
          );
        }
        return presentation;
      },
    },
    tendrilPage: {
      inspect: () => read(bound.services.tendrilPage.inspect()),
      write: (field: Parameters<typeof bound.services.tendrilPage.write>[0]) =>
        read(bound.services.tendrilPage.write(field)),
      invoke: (name: string) => read(bound.services.tendrilPage.invoke(name)),
    },
  };

  const rolledBack = (step: (typeof request.steps)[number]) =>
    step.kind === "update" && step.candidate === "broken-boot";

  function verifyBuilds() {
    const expectedEdits = request.steps.flatMap((step) =>
      step.kind === "update" ? [step.candidate] : [],
    );
    if (
      panels.length !== observed.length ||
      edits.length !== expectedEdits.length ||
      !edits.every(
        ({ candidate }, index) => candidate === expectedEdits[index],
      ) ||
      new Set(edits.map(({ commandId }) => commandId)).size !== edits.length
    )
      return false;
    const transitions = request.steps.flatMap((step, index) =>
      step.kind === "update" || step.kind === "restore"
        ? [{ step, index }]
        : [],
    );
    if (transitions.length !== outcomes.length) return false;
    return transitions.every(({ step, index }, sequence) => {
      const before = panels[index];
      const after = panels[index + 1];
      const evidence = outcomes[sequence];
      if (
        !before ||
        !after ||
        !evidence ||
        evidence.pageId !== observed[index + 1]?.id ||
        !before.proof.some(
          (entry) =>
            entry.buildKey === before.buildKey && entry.state === "proven",
        ) ||
        !after.proof.some(
          (entry) =>
            entry.buildKey === after.buildKey && entry.state === "proven",
        )
      )
        return false;
      if (step.kind === "restore") {
        return (
          evidence.outcome === "restored" &&
          before.buildKey !== after.buildKey &&
          before.proof.some(
            (entry) =>
              entry.buildKey === after.buildKey && entry.state === "proven",
          )
        );
      }
      const previousEntries = new Set(
        before.proof.map(({ entryKey }) => entryKey),
      );
      const added = after.proof.filter(
        ({ entryKey }) => !previousEntries.has(entryKey),
      );
      if (rolledBack(step)) {
        return (
          evidence.outcome === "failed" &&
          before.buildKey === after.buildKey &&
          added.some(
            (entry) =>
              entry.state === "failed" &&
              entry.buildKey &&
              entry.buildKey !== before.buildKey,
          )
        );
      }
      return (
        evidence.outcome === "proven" &&
        before.buildKey !== after.buildKey &&
        added.some(
          (entry) =>
            entry.state === "proven" && entry.buildKey === after.buildKey,
        )
      );
    });
  }

  function verify(report: TendrilReport | null) {
    const baseline = observed[0];
    const state = new Map<string, unknown>();
    const sameFields = (rows: TendrilPage["stored"]) =>
      rows.length === state.size &&
      rows.every(
        ({ key, value }) => state.has(key) && state.get(key) === value,
      );
    const checks = {
      presentation:
        presentation?.state === "presented" &&
        report?.presentation?.slotId === presentation.slotId &&
        report.presentation.deviceId === presentation.deviceId &&
        report.presentation.state === presentation.state,
      baseline:
        baseline?.revision === 0 &&
        baseline.build === "board-v1" &&
        baseline.stored.length === 0 &&
        baseline.displayed.length === 0 &&
        baseline.exposed.length === functions.length,
      exactEffects:
        observed.length === request.steps.length + 1 &&
        request.steps.every((step, index) => {
          const before = observed[index]!;
          const after = observed[index + 1]!;
          const changed =
            step.kind === "write"
              ? step.field
              : step.kind === "invoke"
                ? step.expected
                : null;
          if (changed) state.set(changed.key, changed.value);
          return (
            after.slotId === presentation?.slotId &&
            after.build ===
              (step.kind === "restore" ||
              (step.kind === "update" && !rolledBack(step))
                ? step.expectedBuild
                : before.build) &&
            after.revision === before.revision + Number(Boolean(changed)) &&
            before.id !== after.id &&
            sameFields(after.stored) &&
            sameFields(after.displayed)
          );
        }),
      report:
        report?.state === "verified" &&
        report.findings.length === request.steps.length &&
        report.findings.every(
          (finding, index) =>
            finding.status ===
              (rolledBack(request.steps[index]!)
                ? "rolled-back"
                : "verified") &&
            finding.evidence.length === 2 &&
            finding.evidence[0] === observed[index]?.id &&
            finding.evidence[1] === observed[index + 1]?.id &&
            JSON.stringify(finding.page) ===
              JSON.stringify(observed[index + 1]),
        ),
      ...(buildWorld ? { nativeBuilds: verifyBuilds() } : {}),
    };
    return {
      caseId: world.id,
      contextId: input.contextId,
      presentation,
      observed,
      ...(buildWorld ? { builds: { panels, outcomes, edits } } : {}),
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  async function reference(): Promise<TendrilReport> {
    const target = (await services.tendrilPresentation.devices()).find(
      ({ online }) => online,
    );
    if (!target)
      throw new Error(
        "No online headless presentation device for the Tendril board",
      );
    const delivered = await services.tendrilPresentation.present(target.id);
    let before = await services.tendrilPage.inspect();
    const findings: TendrilReport["findings"] = [];
    for (const step of request.steps) {
      const stepPage = async () => {
        switch (step.kind) {
          case "read":
            return services.tendrilPage.inspect();
          case "write":
            return services.tendrilPage.write(step.field);
          case "invoke":
            return services.tendrilPage.invoke(step.name);
          case "restore":
            return services.tendrilBuild.back();
          case "update": {
            const result = await services.tendrilBuild.update(step.candidate);
            if (!result.page)
              throw new Error(
                "The Tendril update did not leave a live presentation",
              );
            return result.page;
          }
        }
      };
      const after = await stepPage();
      findings.push({
        status: rolledBack(step) ? "rolled-back" : "verified",
        evidence: [before.id, after.id],
        page: after,
      });
      before = after;
    }
    return { state: "verified", presentation: delivered, findings };
  }
  return { request, services, verify, reference, close: bound.close };
}
