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
  const initialScratch = (await fs.exists("/.tmp"))
    ? await fs.readdir("/.tmp")
    : [];
  const sources = scenario.questions.map(({ file }, index) => {
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
    goal: "Once the integration is verified, stage a scratch evidence handoff quoting these assigned workspace files. Include the lines with the full requested settings and values.",
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
    goal: `${integration.goal} Only after the integration succeeds, stage a scratch evidence handoff from the resulting files.`,
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
          return (await ready()) ? scratch.scratchHandoffRead.read(id) : null;
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
    if (!property?.loc)
      throw new Error(`The joined result has no field ${key}`);
    return { first: property.loc.start.line, last: property.loc.end.line };
  });
}

function coversSpans(
  excerpts: Excerpt[],
  spans: ReturnType<typeof spansForKeys>,
) {
  return spans.every(({ first, last }) =>
    Array.from(
      { length: last - first + 1 },
      (_, offset) => first + offset,
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
        artifact?: { path: string; bytes: number };
      };
    }[];
  } | null;
  const integrated = await verifyWorkspaceIntegration(vcs, world.fixture);
  const stage = report?.results?.[1]?.report;
  const paired =
    report?.results?.length === 2 &&
    report.results[0]?.report?.status === "integrated" &&
    report.results[0].report.head === JSON.stringify(integrated.head) &&
    stage?.status === "staged";
  const added = (await fs.readdir("/.tmp").catch(() => [])).filter(
    (name) => stageName.test(name) && !assignment.initialScratch.includes(name),
  );
  let evidenceMatches = false;
  let artifact: { path: string; bytes: number; sha256: string } | null = null;
  if (added.length === 1) {
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
        const matches = await Promise.all(
          assignment.scenario.questions.map(async ({ text, keys }, index) => {
            const source = assignment.sources[index]!;
            const file = world.fixture.files.find(
              ({ path }) => path === source.file,
            );
            if (!file) return false;
            const observed = await vcs.readFile({
              state: integrated.head,
              repositoryId: world.fixture.repositoryId,
              file: { kind: "id", fileId: file.fileId },
            });
            if (!observed || observed.content.kind !== "text") return false;
            const lines = observed.content.text.split(/\r?\n/u);
            const answer = answers[index];
            return (
              answer?.question === text &&
              Array.isArray(answer.evidence) &&
              answer.evidence.length >= 1 &&
              answer.evidence.length <= 4 &&
              answer.evidence.every(
                ({ sourceId, firstLine, lastLine, text }) =>
                  sourceId === source.id &&
                  Number.isInteger(firstLine) &&
                  Number.isInteger(lastLine) &&
                  firstLine >= 1 &&
                  lastLine >= firstLine &&
                  lastLine <= lines.length &&
                  lastLine - firstLine < 8 &&
                  text === lines.slice(firstLine - 1, lastLine).join("\n"),
              ) &&
              coversSpans(
                answer.evidence,
                spansForKeys(observed.content.text, keys),
              )
            );
          }),
        );
        evidenceMatches =
          answers.length === matches.length &&
          matches.every(Boolean) &&
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
    exactClaims: evidenceMatches,
    pairedReports: paired,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    artifact,
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
  const answers = await Promise.all(
    assigned.scenario.questions.map(async ({ text, keys }, index) => {
      const source = assigned.sources[index]!;
      const observed = await assigned.services.scratchHandoffRead.read(
        source.id,
      );
      if (!observed) throw new Error("Integrated file could not be read");
      const spans = spansForKeys(observed.lines.join("\n"), keys);
      const firstLine = Math.min(...spans.map((span) => span.first));
      const lastLine = Math.max(...spans.map((span) => span.last));
      const evidence = [
        {
          sourceId: source.id,
          firstLine,
          lastLine,
          text: observed.lines.slice(firstLine - 1, lastLine).join("\n"),
        },
      ];
      return { question: text, evidence };
    }),
  );
  const artifact = await assigned.services.scratchHandoffWrite.stage(
    JSON.stringify({ answers }) + "\n",
  );
  const verified = await verifyIntegrationHandoff(ports, world, assigned, {
    results: [
      {
        report: { status: "integrated", head: JSON.stringify(integrated.head) },
      },
      { report: { status: "staged", artifact } },
    ],
  });
  return {
    verified,
    earlyReadDenied: earlyRead === null,
    earlyStageDenied: earlyStage === null,
  };
}
