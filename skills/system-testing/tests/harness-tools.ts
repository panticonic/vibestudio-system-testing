import { CONTENT_WORKSPACE_REPO_FIXTURE, type TestCase } from "../types.js";
import {
  findLastAgentMessage,
  getToolCalls,
  noIncompleteInvocations,
} from "./_helpers.js";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Validate the public compact graph, whose exact identities remain in the reference store. */
function requireProvenanceRoots(
  result: Parameters<typeof noIncompleteInvocations>[0],
) {
  const kinds = new Set([
    "event", "application", "work-unit", "applied-change", "change", "decision", "command",
    "trajectory", "trajectory-invocation", "trajectory-turn", "trajectory-message", "file", "repository",
  ]);
  const observedRoots = new Set<string>();
  let edgeCount = 0;
  for (const call of getToolCalls(result)) {
    if (call.name !== "provenance" || call.execution?.status !== "complete" || call.execution.isError === true) continue;
    const returned = record(call.execution.result);
    const details = record(returned?.["details"]);
    const ref = details?.["ref"];
    const kind = details?.["subjectKind"];
    if (typeof ref !== "string" || !/^@[\w-]+$/u.test(ref) || typeof kind !== "string" || !kinds.has(kind)) continue;
    const count = details?.["adjacencyCount"];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) continue;
    const blocks = returned?.["protocolContent"];
    if (!Array.isArray(blocks)) continue;
    const text = blocks.flatMap((block) => {
      const entry = record(block);
      return entry?.["type"] === "text" && typeof entry["text"] === "string" ? [entry["text"]] : [];
    }).join("\n");
    const edges = [...text.matchAll(/^\s*([\w-]+) (@[\w-]+) —([\w-]+)→ ([\w-]+) (@[\w-]+)\s*$/gmu)]
      .filter((edge) => kinds.has(edge[1]!) && kinds.has(edge[4]!) &&
        ((edge[2] === ref && edge[1] === kind) || (edge[5] === ref && edge[4] === kind)));
    if (edges.length === 0 || edges.length > count) continue;
    observedRoots.add(ref);
    edgeCount += edges.length;
  }
  if (edgeCount === 0) return {
    passed: false,
    reason: "Completed provenance results contained no identity-joined compact graph edges",
  };
  const final = findLastAgentMessage(result);
  const citedRoots = new Set<string>(final.match(/@[\w-]+/gu) ?? []);
  if (!/(root|trajectory|turn|message|invocation)/iu.test(final) ||
      !/(edge|caus|trigger|origin|context|relation)/iu.test(final) ||
      ![...observedRoots].some((ref) => citedRoots.has(ref))) return {
    passed: false,
    reason: "Final response did not explain and cite the observed provenance roots and relationships",
  };
  return noIncompleteInvocations(result);
}

function requireMemoryRecall(
  result: Parameters<typeof noIncompleteInvocations>[0],
) {
  const calls = getToolCalls(result).filter(
    (call) =>
      call.name === "memory_recall" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true,
  );
  if (calls.length === 0) {
    return {
      passed: false,
      reason:
        "No completed workspace memory recall supplied canonical evidence",
    };
  }
  if (
    calls.some((call) => {
      const limit = call.arguments?.["limit"];
      return (
        limit !== undefined &&
        (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50)
      );
    })
  ) {
    return { passed: false, reason: "Workspace memory recall was not bounded" };
  }
  const final = findLastAgentMessage(result);
  if (
    !/(build|failure)/iu.test(final) ||
    !/(found|result|nothing|no prior|memory)/iu.test(final)
  ) {
    return {
      passed: false,
      reason:
        "Final response did not semantically report the memory-search outcome",
    };
  }
  return noIncompleteInvocations(result);
}

export const harnessToolTests: TestCase[] = [
  {
    name: "workspace-image-generation",
    description: "Generate a raster illustration as a tracked workspace asset",
    category: "harness-tools",

    workspaceRepoFixture: CONTENT_WORKSPACE_REPO_FIXTURE,
    timeoutMs: 240_000,
    prompt:
      "Create a small raster illustration of a blue ceramic fish on a white background for this project's assets. Save it as fish.png in the provided project repository and show me the image.",
    validate: (result) => {
      const calls = getToolCalls(result);
      const generated = calls.some((call) => {
        if (
          call.name !== "imagegen" ||
          call.execution?.status !== "complete" ||
          call.execution.isError
        )
          return false;
        const details = record(record(call.execution.result)?.["details"]);
        const mutation = record(details?.["mutation"]);
        return (
          mutation?.["status"] === "applied" && mutation["storage"] === "vcs"
        );
      });
      return generated
        ? noIncompleteInvocations(result)
        : {
            passed: false,
            reason:
              "No generated image was saved as a semantic workspace asset",
          };
    },
  },
  {
    name: "provenance-orientation",
    description: "Orient in the session using the provenance surface",
    category: "harness-tools",
    prompt:
      "Orient me to this session: where did it come from, what context does it carry, and which reusable provenance roots support that explanation?",
    validate: requireProvenanceRoots,
  },
  {
    name: "memory-search",
    description:
      "Search workspace memory with provenance before re-deriving knowledge",
    category: "harness-tools",
    prompt:
      "Has this workspace dealt with build failures before? Check its memory of prior conversations and committed knowledge, and tell me what you find with provenance. Finding nothing is a valid outcome.",
    validate: requireMemoryRecall,
  },
];
