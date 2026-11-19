import { panelTree } from "@workspace/runtime";
import { evalInPanel, waitFor } from "@workspace/testkit";
import { bindLiveTendril } from "@workspace-skills/tendrils/live";
import type {
  TendrilPage,
  TendrilPresentation,
  TendrilReport,
} from "@workspace-skills/tendrils/workflow/types";
import { managedTendrilWorlds, tendrilPanel } from "./tendril-worlds.js";

const fields = ["minutes", "phase", "confirmed", "label"];
const functions = [
  "acknowledge",
  "clearReview",
  "startReview",
  "returnToIntake",
  "clearTimer",
];
const observeBoard = `(() => {
  const board = document.querySelector("[data-tendril-build]");
  if (board?.dataset.tendrilStatus === "error") throw new Error(board.querySelector("[role=alert]")?.textContent);
  if (board?.dataset.tendrilStatus !== "ready") return null;
  return {
    build: board.dataset.tendrilBuild,
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
}) {
  const world = managedTendrilWorlds.find(({ id }) => id === input.caseId);
  if (!world) throw new Error("Unknown Tendril assignment");
  const { request } = world;
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
          const page = (await tendril.eval(observeBoard, { slotId })) as Pick<
            TendrilPage,
            "build" | "displayed"
          > | null;
          if (!page) return undefined;
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
    async stageCandidate() {
      throw new Error("This board assignment does not include a source edit");
    },
  });

  let presentation: TendrilPresentation | null = null;
  const observed: TendrilPage[] = [];
  const read = async (result: Promise<TendrilPage>) => {
    const page = await result;
    observed.push(structuredClone(page));
    return page;
  };
  const services = {
    ...bound.services,
    tendrilPresentation: {
      ...bound.services.tendrilPresentation,
      async present(deviceId: string) {
        presentation =
          await bound.services.tendrilPresentation.present(deviceId);
        if (presentation.state === "presented") {
          // The headless device demand-loads the assigned panel when its test driver observes it.
          await evalInPanel(panelTree.get(presentation.slotId), "document.readyState");
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
            after.build === "board-v1" &&
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
            finding.status === "verified" &&
            finding.evidence.length === 2 &&
            finding.evidence[0] === observed[index]?.id &&
            finding.evidence[1] === observed[index + 1]?.id &&
            JSON.stringify(finding.page) ===
              JSON.stringify(observed[index + 1]),
        ),
    };
    return {
      caseId: world.id,
      contextId: input.contextId,
      presentation,
      observed,
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
      const after =
        step.kind === "read"
          ? await services.tendrilPage.inspect()
          : step.kind === "write"
            ? await services.tendrilPage.write(step.field)
            : await services.tendrilPage.invoke(step.name);
      findings.push({
        status: "verified",
        evidence: [before.id, after.id],
        page: after,
      });
      before = after;
    }
    return { state: "verified", presentation: delivered, findings };
  }
  return { request, services, verify, reference, close: bound.close };
}
