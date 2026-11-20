import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { parseExpression } from "@babel/parser";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type {
  RuntimeFs,
  VcsClient,
  rpc as RuntimeRpc,
} from "@workspace/runtime";
import { createWorkspaceIntegration } from "@workspace/natlang-services";
import {
  bindManagedScratchHandoff,
  readWorkspaceBytes,
} from "./scratch-handoff-managed.js";
import { integrationHandoffWorlds } from "./integration-handoff-worlds.js";
import type { OwnedIntegrationWorld } from "./vcs-integration-fixture-contract.js";
import { verifyWorkspaceIntegration } from "./vcs-integration-oracle.js";
import { exerciseWorkspaceIntegration } from "./vcs-integration-qualification.js";
import { workspaceIntegrationWorlds } from "./vcs-integration-worlds.js";

type Ports = {
  fs: RuntimeFs;
  rpc: Pick<typeof RuntimeRpc, "call">;
  vcs: VcsClient;
};
const stageName = /^evidence-handoff-[a-f0-9]{32}$/u;
type Excerpt = {
  sourceId: string;
  firstLine: number;
  lastLine: number;
  text: string;
};

export async function prepareIntegrationHandoff(
  ports: Ports,
  world: OwnedIntegrationWorld,
  caseId: string,
) {
  const scenario = integrationHandoffWorlds.find((item) => item.id === caseId);
  const integration = workspaceIntegrationWorlds.find(
    (item) => item.id === scenario?.integration,
  );
  if (!scenario || !integration)
    throw new Error("Unknown assigned integration handoff");
  const { fs, vcs, rpc } = ports;
  const before = (await vcs.status()).workingHead;
  const initialScratch = await listOwnedScratchEntries(fs);
  const requestedFiles = [
    ...new Set(
      scenario.questions.flatMap(({ evidence }) =>
        evidence.map(({ file }) => file),
      ),
    ),
  ];
  const sources = requestedFiles.map((file, index) => {
    const assigned = world.files.find(({ path }) => path === file);
    if (!assigned)
      throw new Error(
        `Integration handoff path is outside the assignment: ${file}`,
      );
    return {
      id: `settings-${index + 1}`,
      path: "/" + assigned.workspacePath,
      file,
    };
  });
  const handoffRequest = {
    goal: "Once the integration is verified, prepare a scratch evidence handoff quoting the full requested settings and values from the assigned workspace files. Hold the handoff and identify any unanswered questions if the files do not support every answer.",
    questions: scenario.questions.map(({ text }) => text),
    sources: sources.map(({ id, path }) => ({ id, path })),
  };
  const integrationRequest = { goal: integration.goal };
  const work = [
    { kind: "integrateWorkspace" as const, input: integrationRequest },
    {
      kind: "domain" as const,
      domain: "scratchHandoff",
      operation: "assembleHandoff",
      input: handoffRequest,
    },
  ];
  const request = {
    goal: `${integration.goal} After verifying the integration, prepare the assigned handoff and stage it only if the resulting files support every answer.`,
    work,
  };

  let releasedHead:
    | Awaited<ReturnType<VcsClient["status"]>>["workingHead"]
    | undefined;
  async function ready() {
    if (!releasedHead) {
      const observed = await verifyWorkspaceIntegration(vcs, world.fixture);
      if (!observed.passed) return false;
      releasedHead = observed.head;
    }
    const current = await vcs.status();
    return (
      current.mainEventId === world.fixture.mainEventId &&
      isDeepStrictEqual(current.workingHead, releasedHead)
    );
  }

  const scratch = bindManagedScratchHandoff(fs, rpc, handoffRequest);
  const reads = new Set<string>();
  return {
    before,
    initialScratch,
    request,
    sources,
    scenario,
    services: {
      workspaceIntegration: createWorkspaceIntegration({
        vcs,
        contextId: world.fixture.contextId,
        source: world.fixture.source,
        files: world.files,
      }),
      scratchHandoffRead: {
        async read(id: string) {
          if (!(await ready())) return null;
          const observed = await scratch.scratchHandoffRead.read(id);
          if (observed) reads.add(id);
          return observed;
        },
      },
      scratchHandoffWrite: {
        async stage(body: string) {
          return (await ready())
            ? scratch.scratchHandoffWrite.stage(body)
            : null;
        },
      },
    },
    reads,
    releaseHead: () => releasedHead,
  };
}

type Assignment = Awaited<ReturnType<typeof prepareIntegrationHandoff>>;
function spansForKeys(content: string, keys: string[]) {
  const parsed = parseExpression(content);
  if (parsed.type !== "ObjectExpression")
    throw new Error("Expected an assigned JSON object");
  return keys.map((key) => {
    const property = parsed.properties.find(
      (item) =>
        item.type === "ObjectProperty" &&
        item.key.type === "StringLiteral" &&
        item.key.value === key,
    );
    return property?.loc
      ? { first: property.loc.start.line, last: property.loc.end.line }
      : null;
  });
}

function coversSpans(
  excerpts: Excerpt[],
  spans: ReturnType<typeof spansForKeys>,
) {
  return spans.every(
    (span) =>
      span &&
      Array.from(
        { length: span.last - span.first + 1 },
        (_, offset) => span.first + offset,
      ).every((line) =>
        excerpts.some(
          ({ firstLine, lastLine }) => firstLine <= line && line <= lastLine,
        ),
      ),
  );
}

export async function verifyIntegrationHandoff(
  { fs, rpc, vcs }: Ports,
  world: OwnedIntegrationWorld,
  assignment: Assignment,
  reported: unknown,
) {
  const report = reported as {
    results?: {
      report?: {
        status: string;
        head?: string;
        artifact?: { path: string; bytes: number } | null;
        unanswered?: string[];
        missingSources?: string[];
      };
    }[];
  } | null;
  const integrated = await verifyWorkspaceIntegration(vcs, world.fixture);
  const stage = report?.results?.[1]?.report;
  const unanswered = assignment.scenario.questions
    .filter((question) => question.unanswered)
    .map(({ text }) => text);
  const expectedStatus = unanswered.length ? "unanswered" : "staged";
  const sources = new Map(
    await Promise.all(
      assignment.sources.map(async ({ file, id }) => {
        const assigned = world.fixture.files.find(({ path }) => path === file);
        if (!assigned)
          throw new Error("Handoff source is outside the integration");
        const observed = await vcs.readFile({
          state: integrated.head,
          repositoryId: world.fixture.repositoryId,
          file: { kind: "id", fileId: assigned.fileId },
        });
        return [
          file,
          {
            id,
            text:
              observed?.content.kind === "text" ? observed.content.text : null,
          },
        ] as const;
      }),
    ),
  );
  const expectedCoverage =
    assignment.scenario.questions.every((question) => {
      const available = question.evidence.map(({ file, keys }) => {
        const text = sources.get(file)?.text;
        return text != null && spansForKeys(text, keys).every(Boolean);
      });
      return question.unanswered
        ? available.includes(false)
        : available.every(Boolean);
    }) && [...sources.values()].every(({ text }) => text !== null);
  const paired =
    report?.results?.length === 2 &&
    report.results[0]?.report?.status === "integrated" &&
    report.results[0].report.head === JSON.stringify(integrated.head) &&
    stage?.status === expectedStatus &&
    isDeepStrictEqual(stage.unanswered, unanswered) &&
    isDeepStrictEqual(stage.missingSources, []);
  const added = (await listOwnedScratchEntries(fs)).filter(
    (name) => stageName.test(name) && !assignment.initialScratch.includes(name),
  );
  let evidenceMatches =
    expectedStatus === "unanswered" &&
    added.length === 0 &&
    stage?.artifact === null;
  let artifact: { path: string; bytes: number; sha256: string } | null = null;
  if (expectedStatus === "staged" && added.length === 1) {
    const directory = `/.tmp/${added[0]}`;
    const path = `${directory}/handoff.json`;
    const entries = await fs.readdir(directory);
    if (entries.length === 1 && entries[0] === "handoff.json") {
      try {
        const bytes = await readWorkspaceBytes(rpc, path, 64 * 1024);
        const text = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
        artifact = {
          path,
          bytes: bytes.length,
          sha256: sha256HexSyncText(text),
        };
        const { answers } = JSON.parse(text) as {
          answers: { question: string; evidence: Excerpt[] }[];
        };
        evidenceMatches =
          Array.isArray(answers) &&
          answers.length === assignment.scenario.questions.length &&
          assignment.scenario.questions.every(({ text, evidence }, index) => {
            const answer = answers[index];
            if (
              answer?.question !== text ||
              !Array.isArray(answer.evidence) ||
              answer.evidence.length < 1 ||
              answer.evidence.length > 4
            )
              return false;
            let accountedExcerpts = 0;
            for (const { file, keys } of evidence) {
              const source = sources.get(file);
              if (!source || source.text === null) return false;
              const excerpts = answer.evidence.filter(
                ({ sourceId }) => sourceId === source.id,
              );
              const lines = source.text.split(/\r?\n/u);
              if (
                !excerpts.every(
                  ({ firstLine, lastLine, text }) =>
                    Number.isInteger(firstLine) &&
                    Number.isInteger(lastLine) &&
                    firstLine >= 1 &&
                    lastLine >= firstLine &&
                    lastLine <= lines.length &&
                    lastLine - firstLine < 8 &&
                    text === lines.slice(firstLine - 1, lastLine).join("\n"),
                ) ||
                !coversSpans(excerpts, spansForKeys(source.text, keys))
              )
                return false;
              accountedExcerpts += excerpts.length;
            }
            return accountedExcerpts === answer.evidence.length;
          }) &&
          stage?.artifact?.path === artifact.path &&
          stage.artifact.bytes === artifact.bytes;
      } catch {
        // Malformed output or an unavailable source cannot verify an artifact.
      }
    }
  }
  const checks = {
    persistedIntegration: integrated.passed,
    beforeChanged: !isDeepStrictEqual(assignment.before, integrated.head),
    handoffUsedIntegratedHead: isDeepStrictEqual(
      assignment.releaseHead(),
      integrated.head,
    ),
    exactClaims: expectedCoverage && evidenceMatches,
    allSourcesRead: assignment.sources.every(({ id }) =>
      assignment.reads.has(id),
    ),
    pairedReports: paired,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    artifact,
    expectedStatus,
    unanswered,
    before: JSON.stringify(assignment.before),
    after: JSON.stringify(integrated.head),
    seed: world.fixture.commonSeedEvent,
    source: world.fixture.source,
    verificationPaths: integrated.verificationPaths,
  };
}

export async function qualifyIntegrationHandoff(
  ports: Ports,
  world: OwnedIntegrationWorld,
  caseId: string,
) {
  const assigned = await prepareIntegrationHandoff(ports, world, caseId);
  const earlyRead = await assigned.services.scratchHandoffRead.read(
    assigned.sources[0]!.id,
  );
  const earlyStage =
    await assigned.services.scratchHandoffWrite.stage('{"answers":[]}');
  const integrated = await exerciseWorkspaceIntegration(
    ports.vcs,
    world,
    "reference",
  );
  if (!integrated.passed) throw new Error("Reference integration failed");
  const readback = new Map();
  for (const { file, id } of assigned.sources) {
    const observed = await assigned.services.scratchHandoffRead.read(id);
    if (!observed) throw new Error("Integrated file could not be read");
    readback.set(file, observed);
  }
  const unanswered: string[] = [];
  const answers = [];
  for (const { text, evidence } of assigned.scenario.questions) {
    const excerpts: Excerpt[] = [];
    for (const { file, keys } of evidence) {
      const observed = readback.get(file)!;
      const spans = spansForKeys(observed.lines.join("\n"), keys);
      if (spans.some((span) => span === null)) break;
      const firstLine = Math.min(...spans.map((span) => span!.first));
      const lastLine = Math.max(...spans.map((span) => span!.last));
      excerpts.push({
        sourceId: observed.id,
        firstLine,
        lastLine,
        text: observed.lines.slice(firstLine - 1, lastLine).join("\n"),
      });
    }
    if (excerpts.length === evidence.length)
      answers.push({ question: text, evidence: excerpts });
    else unanswered.push(text);
  }
  const artifact = unanswered.length
    ? null
    : await assigned.services.scratchHandoffWrite.stage(
        JSON.stringify({ answers }) + "\n",
      );
  const verified = await verifyIntegrationHandoff(ports, world, assigned, {
    results: [
      {
        report: { status: "integrated", head: JSON.stringify(integrated.head) },
      },
      {
        report: {
          status: unanswered.length ? "unanswered" : "staged",
          artifact,
          unanswered,
          missingSources: [],
        },
      },
    ],
  });
  return {
    verified,
    earlyReadDenied: earlyRead === null,
    earlyStageDenied: earlyStage === null,
  };
}
