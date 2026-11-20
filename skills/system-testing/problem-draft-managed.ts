import { requireAssignedWorld } from "./assigned-world.js";
import { isDeepStrictEqual } from "node:util";
import { problemReports } from "@workspace/runtime";
import { bindLocalProblemDraft } from "@workspace-skills/problem-reporting/workflow";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { managedProblemDraftWorlds } from "./problem-draft-worlds.js";

type Binding = ReturnType<typeof bindLocalProblemDraft>;
type Services = Binding["services"];
type OpenedDraft = Awaited<ReturnType<Services["problemDraftOpen"]["create"]>>;
type Source = Awaited<ReturnType<Services["problemDraftRead"]["observe"]>>;
type Confirmation = Awaited<
  ReturnType<Services["problemDraftRead"]["confirm"]>
>;
type Plan = {
  defect: string;
  status: string;
  next: string;
  saved: Confirmation | null;
};

export async function prepareManagedProblemDraft(
  contextId: string,
  caseId: string,
) {
  const world = requireAssignedWorld(
    managedProblemDraftWorlds,
    caseId,
    "Unknown managed problem draft case",
  );
  const { account } = world;
  const opened =
    world.mode === "new"
      ? null
      : await problemReports.create({
          category: "quality",
          component: "unknown",
          operation: account.operation,
          code: null,
          kind: "unknown",
          frames: [],
          externalFramesOmitted: 0,
          symptom: account.observed,
          expected: account.expected,
        });
  const seeded =
    opened &&
    (await problemReports.appendNarrative(opened.id, opened.revision, [
      {
        section: "symptom",
        claims: "unverified",
        markdown: account.observed,
        authorLabel: "Reporter",
        evidenceIds: [],
      },
    ]));
  const baseline = seeded && (await problemReports.get(seeded.id));
  const before = new Set((await problemReports.history()).map(({ id }) => id));
  const bound = bindLocalProblemDraft({
    goal: world.goal,
    account,
    existing:
      seeded && opened
        ? {
            id: seeded.id,
            basisRevision:
              world.mode === "stale" ? opened.revision : seeded.revision,
          }
        : null,
  });
  const observations: Source[] = [];
  const openings: OpenedDraft[] = [];
  const confirmations: Confirmation[] = [];
  const services: Services = {
    ...bound.services,
    problemDraftOpen: {
      async create(operationId) {
        const opening =
          await bound.services.problemDraftOpen.create(operationId);
        openings.push(structuredClone(opening));
        return opening;
      },
    },
    problemDraftRead: {
      async observe(operationId) {
        const observation =
          await bound.services.problemDraftRead.observe(operationId);
        observations.push(structuredClone(observation));
        return observation;
      },
      async confirm(write) {
        const confirmation =
          await bound.services.problemDraftRead.confirm(write);
        confirmations.push(structuredClone(confirmation));
        return confirmation;
      },
    },
  };

  async function verify(report: Plan | null) {
    const [source] = observations;
    const [created] = openings;
    const [saved] = confirmations;
    const expectedId = seeded?.id ?? saved?.id;
    const history = await problemReports.history();
    const historyRow = history.find(({ id }) => id === expectedId);
    const current = historyRow && (await problemReports.get(historyRow.id));
    const priorSections = baseline?.value.narrative ?? [];
    const written = current?.value.narrative.slice(priorSections.length) ?? [];
    const held = world.mode === "stale";
    const expectedNew = world.mode === "new" && saved ? [saved.id] : [];
    const checks = {
      source:
        observations.length === 1 &&
        source !== undefined &&
        isDeepStrictEqual(source.review.account, account) &&
        source.review.consent === "save" &&
        (baseline
          ? source.draft?.id === baseline.id &&
            source.draft.revision === baseline.revision
          : source.draft === null),
      result:
        report?.defect === world.defect &&
        (held
          ? report.status === "held" &&
            report.next === "refresh-own-edit" &&
            report.saved === null &&
            confirmations.length === 0
          : report.status === "saved-local" &&
            report.next === "keep-local" &&
            confirmations.length === 1 &&
            isDeepStrictEqual(report.saved, saved)),
      opening:
        world.mode === "new"
          ? openings.length === 1 &&
            created !== undefined &&
            created.id === expectedId &&
            created.revision < (saved?.revision ?? 0)
          : openings.length === 0,
      retention:
        isDeepStrictEqual(
          history.filter(({ id }) => !before.has(id)).map(({ id }) => id),
          expectedNew,
        ) &&
        current?.value.intent === "manual-problem" &&
        current.value.problem.symptom === account.observed &&
        current.value.problem.expected === account.expected &&
        isDeepStrictEqual(
          current.value.narrative.slice(0, priorSections.length),
          priorSections,
        ),
      persisted: held
        ? current?.revision === baseline?.revision && written.length === 0
        : current?.revision === saved?.revision &&
          isDeepStrictEqual(
            written.map(({ id }) => id),
            saved?.sectionIds,
          ) &&
          isDeepStrictEqual(
            written.map(({ section, claims, markdown }) => ({
              section,
              claims,
              markdown,
            })),
            saved?.sections,
          ) &&
          written.length === (world.mode === "new" ? 2 : 1) &&
          written.every(({ evidenceIds }) => evidenceIds.length === 0) &&
          written.at(-1)?.section === "verification" &&
          written.at(-1)?.markdown.includes(account.expected),
      localOnly:
        historyRow?.state === null &&
        current?.value.evidence.length === 0 &&
        current.value.attachments.length === 0,
    };
    return {
      passed: Object.values(checks).every(Boolean),
      caseId,
      contextId,
      request: bound.request,
      source,
      created: created ?? null,
      saved: saved ?? null,
      checks,
    };
  }

  async function qualify() {
    let rejectedForeignScope = false;
    let rejectedWrongRevision = false;
    try {
      await services.problemDraftRead.observe("foreign");
    } catch (error) {
      rejectedForeignScope =
        error instanceof Error && /assigned problem/.test(error.message);
    }
    const source = await services.problemDraftRead.observe(
      bound.request.operationId,
    );
    const draft =
      source.draft ??
      (await services.problemDraftOpen.create(bound.request.operationId));
    const sections: Parameters<Services["problemDraftAppend"]["append"]>[1] = [
      ...(source.draft
        ? []
        : [
            {
              section: "symptom" as const,
              claims: "unverified" as const,
              markdown: [account.goal, account.observed, account.expected].join(
                "\n",
              ),
            },
          ]),
      {
        section: "verification",
        claims: "unverified",
        markdown:
          "Repeat the assigned operation and compare with the expected result: " +
          account.expected,
      },
    ];
    if (world.mode === "stale") {
      try {
        await services.problemDraftAppend.append(draft, sections);
      } catch (error) {
        rejectedWrongRevision =
          error instanceof Error && /observed revision/.test(error.message);
      }
      return {
        verification: await verify({
          defect: world.defect,
          status: "held",
          next: "refresh-own-edit",
          saved: null,
        }),
        rejectedForeignScope,
        rejectedWrongRevision,
      };
    }
    try {
      await services.problemDraftAppend.append(
        { ...draft, revision: draft.revision + 1 },
        sections,
      );
    } catch (error) {
      rejectedWrongRevision =
        error instanceof Error && /observed revision/.test(error.message);
    }
    const write = await services.problemDraftAppend.append(draft, sections);
    const saved = await services.problemDraftRead.confirm(write);
    return {
      verification: await verify({
        defect: world.defect,
        status: "saved-local",
        next: "keep-local",
        saved,
      }),
      rejectedForeignScope,
      rejectedWrongRevision,
    };
  }
  return { request: bound.request, services, verify, qualify };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedProblemDraft>>;
type Input = { contextId: string; caseId: string };
export interface ManagedProblemDraftReceiver {
  runManagedProblemDraftTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedProblemDraft(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedProblemDraftMethods =
  createReceiverRpcMethods<ManagedProblemDraftReceiver>([
    "runManagedProblemDraftTeacher",
    "qualifyManagedProblemDraft",
  ]);
