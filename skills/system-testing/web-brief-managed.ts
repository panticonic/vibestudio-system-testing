import { requireAssignedWorld } from "./assigned-world.js";
import { isDeepStrictEqual } from "node:util";
import { readVerifiedCachedPage } from "./verified-web-cache.js";
import { web } from "@workspace/runtime";
import { bindAssignedResearch } from "@workspace-skills/web-research-bindings";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import {
  managedResearchIntakeWorlds,
  managedWebBriefWorlds,
} from "./web-brief-worlds.js";

type Services = ReturnType<typeof bindAssignedResearch>["services"];
type Page = Awaited<ReturnType<Services["web"]["fetch"]>>;
type Range = Awaited<ReturnType<Services["web"]["read"]>>;
type Citation = {
  url: string;
  title: string;
  quote: string;
  retrieved: string;
  published: string | null;
};
type Brief = {
  question: string;
  status: "answered" | "insufficient";
  statements: { text: string; cites: Citation[] }[];
  notRead: unknown[];
  rejected: number;
};
const collapse = (value: string) => value.replace(/\s+/gu, " ").trim();

export function prepareManagedWebBrief(contextId: string, caseId: string) {
  const world = requireAssignedWorld(managedWebBriefWorlds, caseId, "Unknown assigned web brief");
  const retrievedAt = Date.now();
  const retrieved = new Date(retrievedAt).toISOString().slice(0, 10);
  const bound = bindAssignedResearch({
    goal: world.goal,
    sources: world.sources,
    retrievedAt,
  });
  const reads: { requested: string; page: Page }[] = [];
  const tails: Range[] = [];
  const services: Services = {
    web: {
      ...bound.services.web,
      async fetch(options) {
        const page = await bound.services.web.fetch(options);
        reads.push({ requested: options.url, page: structuredClone(page) });
        return page;
      },
      async read(options) {
        const range = await bound.services.web.read(options);
        tails.push(structuredClone(range));
        return range;
      },
    },
  };

  async function verify(report: Brief | null) {
    const cache = await Promise.all(
      reads.map(async ({ requested, page }) => {
        const entire = await readVerifiedCachedPage(input => web.read(input), page);
        const tail = tails.find(({ digest }) => digest === page.digest);
        return {
          requested,
          digest: page.digest,
          size: page.size,
          verified: entire.exact,
          visible: (page.head + (tail?.text ?? "")).slice(0, 9000),
        };
      }),
    );
    const cites =
      report?.statements.flatMap((statement) => statement.cites) ?? [];
    const checks = {
      assigned:
        isDeepStrictEqual(
          reads.map(({ requested }) => requested),
          world.sources,
        ) &&
        reads.every(
          ({ page }) =>
            page.session === "public" && /^[a-f0-9]{64}$/u.test(page.digest),
        ),
      continuations:
        tails.length ===
          reads.filter(({ page }) => page.truncated && page.head.length < 9000)
            .length &&
        tails.every((tail) =>
          reads.some(
            ({ page }) =>
              page.digest === tail.digest &&
              page.truncated &&
              tail.offset === page.headBytes &&
              tail.nextOffset === tail.offset + tail.bytes &&
              tail.limit === 9000 - page.head.length,
          ),
        ),
      cache:
        cache.length === world.sources.length &&
        cache.every(({ verified }) => verified),
      outcome:
        report?.question === world.goal &&
        report.status === (world.facts.length ? "answered" : "insufficient") &&
        (world.facts.length
          ? report.statements.length > 0
          : report.statements.length === 0) &&
        report.notRead.length === 0,
      citations:
        report?.statements.every(
          (statement) =>
            !!statement.text.trim() &&
            statement.cites.length > 0 &&
            statement.cites.every((cite) =>
              reads.some(
                ({ page }, index) =>
                  page.url === cite.url &&
                  page.title === cite.title &&
                  cite.retrieved === retrieved &&
                  collapse(cite.quote).length >= 20 &&
                  collapse(cache[index]?.visible ?? "").includes(
                    collapse(cite.quote),
                  ),
              ),
            ),
        ) === true &&
        world.facts.every(({ source, pattern }) => {
          const actual = reads.find(
            ({ requested }) => requested === source,
          )?.page;
          return cites.some(
            (cite) =>
              cite.url === actual?.url &&
              collapse(cite.quote).toLowerCase().includes(pattern),
          );
        }),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId,
      caseId,
      request: bound.request,
      reads,
      tails,
      cache,
      checks,
    };
  }

  async function qualify() {
    let rejectedUnassignedUrl = false;
    let rejectedForeignDigest = false;
    try {
      await services.web.fetch({
        url: "https://invalid.example/",
        session: "public",
      });
    } catch (error) {
      rejectedUnassignedUrl =
        error instanceof Error &&
        /next assigned public URL/.test(error.message);
    }
    for (const url of world.sources) {
      const page = await services.web.fetch({ url, session: "public" });
      if (page.truncated && page.head.length < 9000)
        await services.web.read({
          digest: page.digest,
          offset: page.headBytes,
          limit: 9000 - page.head.length,
        });
    }
    try {
      await services.web.read({ digest: "0".repeat(64), offset: 0, limit: 40 });
    } catch (error) {
      rejectedForeignDigest =
        error instanceof Error && /assigned public page/.test(error.message);
    }
    const statements = world.facts.map(({ source, pattern }) => {
      const { page } = reads.find(({ requested }) => requested === source)!;
      const visible = collapse(
        page.head +
          (tails.find(({ digest }) => digest === page.digest)?.text ?? ""),
      );
      const start = visible.toLowerCase().indexOf(pattern);
      if (start < 0)
        throw new Error(
          "Assigned public source no longer supplies the expected fact",
        );
      const quote = visible.slice(start, start + pattern.length);
      return {
        text: quote,
        cites: [
          {
            url: page.url,
            title: page.title,
            quote,
            retrieved,
            published: null,
          },
        ],
      };
    });
    return {
      verification: await verify({
        question: world.goal,
        status: statements.length ? "answered" : "insufficient",
        statements,
        notRead: [],
        rejected: 0,
      }),
      rejectedUnassignedUrl,
      rejectedForeignDigest,
    };
  }
  return { request: bound.request, services, verify, qualify };
}

type Prepared = ReturnType<typeof prepareManagedWebBrief>;
type Input = { contextId: string; caseId: string };

export function prepareManagedResearchIntake(
  contextId: string,
  caseId: string,
) {
  const world = requireAssignedWorld(
    managedResearchIntakeWorlds,
    caseId,
    "Unknown assigned research intake",
  );
  const request = { goal: world.goal, operationId: crypto.randomUUID() };
  const { services } = bindAssignedResearch({
    goal: world.goal,
    sources: [...world.sources],
    retrievedAt: Date.now(),
  });
  let started = false;
  let projection: Awaited<ReturnType<typeof read>> | undefined;
  async function collect() {
    const pages = [];
    for (const requestedUrl of world!.sources) {
      const page = await services.web.fetch({
        url: requestedUrl,
        session: "public",
      });
      const entire = await readVerifiedCachedPage(input => web.read(input), page);
      if (page.session !== "public" || !entire.exact)
        throw new Error(
          "Research source did not match the actual cached bytes",
        );
      const reads =
        page.truncated && page.head.length < 9000
          ? [
              await services.web.read({
                digest: page.digest,
                offset: page.headBytes,
                limit: 9000 - page.head.length,
              }),
            ]
          : [];
      pages.push({
        id: `source-${pages.length + 1}`,
        requestedUrl,
        finalUrl: page.url,
        title: page.title,
        authority: "primary",
        outcome: "fetched",
        session: page.session,
        browserApproved: false,
        digest: page.digest,
        size: page.size,
        head: page.head,
        headBytes: page.headBytes,
        truncated: page.truncated,
        reads,
        publicationDate: null,
        eventDate: null,
      });
    }
    return {
      goal: world!.goal,
      checks: [world!.check],
      suppliedUrls: [...world!.sources],
      search: [],
      pages,
      integration: null,
    };
  }
  async function read(
    operationId: string,
  ): Promise<Awaited<ReturnType<typeof collect>>> {
    if (operationId !== request.operationId || started)
      throw new Error("Read only the assigned research evidence once");
    started = true;
    projection = await collect();
    return structuredClone(projection);
  }
  type IntakeReport = {
    findings?: {
      check: string;
      disposition: string;
      evidenceIds: string[];
      citations: {
        sourceId: string;
        url: string;
        quote: string;
        date: string | null;
      }[];
      detail: string;
    }[];
  };
  function verify(report: IntakeReport | null) {
    const finding = report?.findings?.[0];
    const first = projection?.pages[0];
    const cite = finding?.citations?.[0];
    const visible = collapse(first?.head + (first?.reads[0]?.text ?? ""));
    const checks = {
      exactAcquisition:
        projection?.pages.length === world!.sources.length &&
        isDeepStrictEqual(
          projection.pages.map(({ requestedUrl }) => requestedUrl),
          world!.sources,
        ),
      evidenceDisposition:
        report?.findings?.length === 1 &&
        finding?.check === world!.check &&
        finding.disposition === world!.disposition &&
        typeof finding.detail === "string" &&
        Boolean(finding.detail.trim()) &&
        isDeepStrictEqual(
          finding.evidenceIds,
          projection?.pages.map(({ id }) => id),
        ),
      exactCitation: world!.quotePattern
        ? finding?.citations?.length === 1 &&
          cite?.sourceId === first?.id &&
          cite?.url === first?.finalUrl &&
          cite?.date === null &&
          typeof cite.quote === "string" &&
          visible.includes(collapse(cite.quote)) &&
          collapse(cite.quote).toLowerCase().includes(world!.quotePattern)
        : finding?.citations?.length === 0,
    };
    return {
      contextId,
      caseId,
      request,
      projection,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }
  function reference() {
    const receipts = projection;
    if (!receipts) return null;
    const first = receipts.pages[0]!;
    const text = collapse(first.head + (first.reads[0]?.text ?? ""));
    const start = world.quotePattern
      ? text.toLowerCase().indexOf(world.quotePattern)
      : -1;
    const citations =
      world.quotePattern && start >= 0
        ? [
            {
              sourceId: first.id,
              url: first.finalUrl,
              quote: text.slice(start, start + world.quotePattern.length),
              date: null,
            },
          ]
        : [];
    return {
      findings: [
        {
          check: world.check,
          disposition: world.disposition,
          evidenceIds: receipts.pages.map(({ id }) => id),
          citations,
          detail: world.goal,
        },
      ],
    };
  }
  return {
    request,
    services: { assignedResearchIntake: { read } },
    verify,
    reference,
    async qualify() {
      const rejectedWrongOperation = await read("foreign-operation").then(
        () => false,
        () => true,
      );
      await read(request.operationId);
      return {
        verification: verify(reference()),
        rejectedWrongOperation,
      };
    },
  };
}

type Intake = ReturnType<typeof prepareManagedResearchIntake>;
export interface ManagedWebBriefReceiver {
  runManagedWebBriefTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedWebBrief(input: Input): ReturnType<Prepared["qualify"]>;
  runManagedResearchIntakeTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Intake["verify"]>;
  }>;
  qualifyManagedResearchIntake(input: Input): ReturnType<Intake["qualify"]>;
}
export const managedWebBriefMethods =
  createReceiverRpcMethods<ManagedWebBriefReceiver>([
    "runManagedWebBriefTeacher",
    "qualifyManagedWebBrief",
    "runManagedResearchIntakeTeacher",
    "qualifyManagedResearchIntake",
  ]);
