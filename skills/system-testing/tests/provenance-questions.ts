/**
 * Agentic coverage for the question-shaped provenance surfaces.
 *
 * The unit suites for walks, `prov_*` queries, and search run against the
 * sql.js fallback, so they cannot fail on anything the deployed engine decides:
 * SQLite deployment limits, FTS5 availability, `EXPLAIN QUERY PLAN` behavior,
 * or the host↔authority dispatch seam. These cases run a real agent against a
 * real workspace authority, which is the only instrument that observes those.
 *
 * Every case therefore carries one shared liveness assertion beyond its user
 * outcome: a provenance surface may refuse, but it may not be *dead*. A surface
 * that fails closed on every call looks identical to a healthy one from the
 * agent's final answer, and identical to a passing unit suite.
 */

import type { ChatMessage } from "@workspace/agentic-core";
import type {
  HeadlessSession,
  SessionSnapshot,
} from "@workspace/agentic-session";
import {
  CONTENT_WORKSPACE_REPO_FIXTURE,
  PROVENANCE_RECORD_WORKSPACE_REPO_FIXTURE,
  type TestCase,
  type TestExecutionResult,
  type TestOrchestrationContext,
  type TestResult,
} from "../types.js";
import {
  findLastAgentMessage,
  getToolCalls,
  hasAgentResponse,
} from "./_helpers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type ToolCall = ReturnType<typeof getToolCalls>[number];

function protocolText(call: ToolCall): string {
  const envelope = isRecord(call.execution?.result)
    ? call.execution.result
    : null;
  return Array.isArray(envelope?.["protocolContent"])
    ? envelope["protocolContent"]
        .filter(isRecord)
        .map((content) =>
          typeof content["text"] === "string" ? content["text"] : "",
        )
        .join("\n")
    : "";
}

function provenanceDetails(call: ToolCall): Record<string, unknown> | null {
  if (
    call.name !== "provenance" ||
    call.execution?.status !== "complete" ||
    call.execution.isError === true ||
    !isRecord(call.execution.result)
  ) {
    return null;
  }
  const details = call.execution.result["details"];
  return isRecord(details) ? details : null;
}

/** Completed provenance calls, paired with their rendered block. */
function provenanceCalls(
  result: TestExecutionResult,
): Array<{ call: ToolCall; details: Record<string, unknown>; text: string }> {
  return getToolCalls(result).flatMap((call) => {
    const details = provenanceDetails(call);
    return details ? [{ call, details, text: protocolText(call) }] : [];
  });
}

/**
 * A content-addressed identity as the record actually spells one: a typed kind
 * followed by a long digest. The compact `@r3-9c1a` grammar is deliberately not
 * matched, and neither is a blob digest passed as the literal argument of a
 * read, which §2.1 keeps as an argument rather than a rendered subject.
 */
const RENDERED_IDENTITY =
  /\b(?:work-unit|change|applied-change|application|decision|command|workspace-event|external-delta|repository|file):[0-9a-f]{24,}/u;

/**
 * The liveness gate. A refusal is a legitimate answer (that is the whole point
 * of the layered budget), but a surface that never once executed is a dead
 * surface, and a transport-level failure is never a legitimate answer.
 */
function provenanceSurfacesAreLive(result: TestExecutionResult): TestResult {
  const attempted = getToolCalls(result).filter(
    (call) => call.name === "provenance",
  );
  if (attempted.length === 0) {
    return {
      passed: false,
      reason:
        "The agent answered without consulting workspace provenance, so the scenario did not exercise the surface it claims to verify",
    };
  }
  const broken = getToolCalls(result).filter(
    (call) =>
      call.name === "provenance" &&
      (call.execution?.status === "error" || call.execution?.isError === true),
  );
  if (broken.length > 0) {
    return {
      passed: false,
      reason: `The provenance surface failed rather than answered or refused: ${broken
        .map((call) =>
          String(call.execution?.error ?? "unknown failure").slice(0, 200),
        )
        .join(" | ")}`,
    };
  }
  // A refusal is only evidence of death when it comes from the surface rather
  // than from the statement. `engine-error` means the engine read the query and
  // objected to it — the agent wrote something wrong, which is its own problem
  // and not a dead mechanism. `plan-unavailable` on everything is the shape a
  // genuinely dead query surface has, and it is the one worth failing on.
  const queries = provenanceCalls(result).filter(
    (entry) => entry.details["rowCount"] !== undefined,
  );
  if (
    queries.length > 0 &&
    queries.every((entry) => entry.details["refused"] === "plan-unavailable")
  ) {
    return {
      passed: false,
      reason:
        "Every relational query was refused before execution; a surface that always fails closed is indistinguishable from a dead one",
    };
  }
  return { passed: true };
}

/**
 * Acceptance 4 is about behavior, not availability: rejections must be consulted
 * *before* work is repeated. Any route to the counteraction record counts — the
 * walk, or a query that joins it — because the criterion is that the agent
 * looked, not that it looked one way.
 */
function consultedNegativeEvidence(result: TestExecutionResult): TestResult {
  const consulted = provenanceCalls(result).some((entry) => {
    if (entry.details["walk"] === "rejections") return true;
    const query = entry.call.arguments?.["query"];
    if (typeof query === "string" && /prov_counteractions/u.test(query))
      return true;
    // A `cause` walk over a coordinate whose history contains the undoing
    // surfaces the same evidence. The criterion is that the agent reached the
    // record of what was undone, not that it reached it by one route.
    return /undone|revert|counteract/iu.test(entry.text);
  });
  return consulted
    ? { passed: true }
    : {
        passed: false,
        reason:
          "The agent repeated work at a coordinate carrying rejected attempts without ever consulting the record of what was undone there",
      };
}

/**
 * Did the surface hand over the evidence?
 *
 * Every case here has two independent halves: the mechanism delivered what the
 * question needs, and the agent used it. Grading only the final prose collapses
 * them, so a red test cannot tell you whether the walk broke or the reasoning
 * did — and it tempts the validator into demanding a phrasing, which grades the
 * sentence rather than the capability. This half is observable in the tool
 * result, so it is exact; the prose half is deliberately kept to one
 * discriminating token.
 */
function walkDelivered(
  result: TestExecutionResult,
  walk: "cause" | "cohort" | "rejections",
  carried: RegExp,
): TestResult {
  const delivered = provenanceCalls(result).some(
    (entry) => entry.details["walk"] === walk && carried.test(entry.text),
  );
  return delivered
    ? { passed: true }
    : {
        passed: false,
        reason: `No \`${walk}\` walk returned the evidence this question needs (${carried.source}); the mechanism failed before the agent's reasoning was tested`,
      };
}

/** How many distinct coordinates a cohort actually put in front of the agent. */
function cohortBreadth(result: TestExecutionResult): number {
  return Math.max(
    0,
    ...provenanceCalls(result)
      .filter((entry) => entry.details["walk"] === "cohort")
      .map(
        (entry) =>
          entry.text
            .split("\n")
            .filter((line) => /·\s*\d+\s*change/u.test(line)).length,
      ),
  );
}

/**
 * Entry by content is graded on what the surface returned, not on the wording
 * of the sentence the agent wrapped around it.
 */
function foundTheSubject(
  result: TestExecutionResult,
  subject: RegExp,
): TestResult {
  const hit = provenanceCalls(result).find(
    (entry) =>
      typeof entry.details["hitCount"] === "number" &&
      Number(entry.details["hitCount"]) > 0 &&
      subject.test(entry.text),
  );
  return hit
    ? { passed: true }
    : {
        passed: false,
        reason:
          "No content search returned the subject carrying the constraint; entry by content is the capability under test",
      };
}

/**
 * A set answer is graded on coverage, not on transcription.
 *
 * Requiring an exact list of filenames grades the fixture author's naming and
 * the reader's phrasing rather than whether the set-shaped question was
 * answered. What matters is that the reader reached the whole set: several
 * distinct coordinates named, and a count that matches what the record holds.
 */
function namedAtLeast(
  result: TestExecutionResult,
  candidates: readonly RegExp[],
  atLeast: number,
  /**
   * A second axis the same set can be named on.
   *
   * A question that asks for "every distinct piece of work, what each was for,
   * and how many files each touched" is answered by naming the work, not the
   * coordinates — and pushing the reader toward coordinates sends it to the
   * relational views, whose id columns `identityHygieneHolds` then refuses.
   * Reaching the whole set is the capability; which axis names it is not.
   */
  alternative: readonly RegExp[] = [],
): TestResult {
  const final = findLastAgentMessage(result);
  const count = (axis: readonly RegExp[]): number =>
    axis.filter((candidate) => candidate.test(final)).length;
  const named = count(candidates);
  if (named >= atLeast || count(alternative) >= atLeast) return { passed: true };
  return {
    passed: false,
    reason: `The answer named ${named} of the ${candidates.length} recorded coordinates; the question asks for the set, not a sample`,
  };
}

/** An inventory that never says how much there is has not inventoried. */
function reportedTheSize(
  result: TestExecutionResult,
  size: RegExp,
): TestResult {
  return size.test(findLastAgentMessage(result))
    ? { passed: true }
    : {
        passed: false,
        reason:
          "The inventory never reported how much work the record actually holds",
      };
}

/** Nothing outside the caller's basis may appear, in an answer or in a block. */
function withheld(result: TestExecutionResult, secret: RegExp): TestResult {
  if (secret.test(findLastAgentMessage(result))) {
    return {
      passed: false,
      reason: "The answer disclosed work outside the caller's visible basis",
    };
  }
  const leaked = provenanceCalls(result).find((entry) =>
    secret.test(entry.text),
  );
  return leaked
    ? {
        passed: false,
        reason:
          "A provenance block disclosed work outside the caller's visible basis",
      }
    : { passed: true };
}

/** No provenance surface may spell a content-addressed identity at the model. */
function identityHygieneHolds(result: TestExecutionResult): TestResult {
  const leaking = provenanceCalls(result).find((entry) =>
    RENDERED_IDENTITY.test(entry.text),
  );
  return leaking
    ? {
        passed: false,
        reason: `A provenance block rendered a content-addressed identity: ${
          leaking.text.match(RENDERED_IDENTITY)?.[0] ?? ""
        }`,
      }
    : { passed: true };
}

function answered(
  result: TestExecutionResult,
  patterns: readonly RegExp[],
): TestResult {
  if (!hasAgentResponse(result))
    return { passed: false, reason: "No agent response received" };
  const final = findLastAgentMessage(result);
  if (!final.trim())
    return { passed: false, reason: "The final agent response was empty" };
  const missing = patterns.filter((pattern) => !pattern.test(final));
  return missing.length === 0
    ? { passed: true }
    : {
        passed: false,
        reason: `The recovered answer did not establish ${missing
          .map((pattern) => pattern.source)
          .join(", ")}`,
      };
}

function all(...checks: readonly TestResult[]): TestResult {
  return checks.find((check) => !check.passed) ?? { passed: true };
}

/** Phases run as independent sessions so the reader starts genuinely cold. */
interface Phase {
  readonly role: string;
  readonly prompt: (repoPath: string) => string;
  readonly note: string;
}

function orchestratePhases(
  phases: readonly Phase[],
  phaseContext: "fork" | "task" = "fork",
) {
  return async function orchestrate(
    context: TestOrchestrationContext,
  ): Promise<TestExecutionResult> {
    const startedAt = Date.now();
    const fixtureName = context.runner.workspaceRepoName;
    if (!fixtureName)
      throw new Error("this provenance scenario requires a repository fixture");
    const repoPath = `projects/${fixtureName}`;
    const sessions: Array<{ role: string; session: HeadlessSession }> = [];
    const cleanupErrors: string[] = [];
    let error: string | undefined;

    try {
      for (const phase of phases) {
        const session = await context.runner.spawn({ context: phaseContext });
        sessions.push({ role: phase.role, session });
        await context.sendAndWait(session, phase.prompt(repoPath), phase.note);
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    const last = sessions.at(-1)?.session;
    // Earlier phases establish the fixture observed by the final actor. Their
    // transcripts are not part of that actor's observable result: combining
    // them here lets validators "see" private setup that the final context
    // correctly cannot reach. Grade the final phase, while retaining bounded
    // phase metadata for orchestration diagnostics.
    const messages = (last?.messages ?? []) as ChatMessage[];
    let snapshot: SessionSnapshot | undefined;
    try {
      snapshot = last?.snapshot();
    } catch {
      snapshot = undefined;
    }

    const execution: TestExecutionResult = {
      messages,
      duration: Date.now() - startedAt,
      ...(error ? { error } : {}),
      ...(snapshot ? { snapshot } : {}),
      diagnostics: {
        orchestrated: true,
        repoPath,
        phases: sessions.map(({ role }) => role),
        phaseMessageCounts: sessions.map(({ role, session }) => ({
          role,
          count: session.messages.length,
        })),
      },
    };

    for (const { role, session } of [...sessions].reverse()) {
      try {
        await session.close();
        cleanupErrors.push(
          ...session
            .snapshot()
            .cleanupErrors.map(
              (entry) => `${role} ${entry.phase}: ${entry.message}`,
            ),
        );
      } catch (cause) {
        cleanupErrors.push(
          `${role}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
    if (cleanupErrors.length > 0) {
      execution.cleanupErrors = cleanupErrors;
      execution.error ??= `Headless cleanup failed: ${cleanupErrors.join("; ")}`;
    }
    return execution;
  };
}

/**
 * Fixture discipline: the reason exists only in the record.
 *
 * Every author phase below states its reason in the *request* and is told to
 * leave the file bare, so the reason reaches the store as intent, trigger
 * evidence, and commit message — and never as bytes an agent could grep. A
 * reader that produces the reason therefore proves a provenance surface worked,
 * rather than proving it can read a comment. Fixtures that leak the answer into
 * content grade retrieval as if it were recovery.
 */
const RELAY_REASON =
  "the Pelagic relay drops any export payload above 512 KiB, so batches must stay small";

const BARE_FILE =
  "Keep the file to just that one exported constant — no comments and no notes file.";

const CANONICAL_QUESTION_CASES: TestCase[] = [
  {
    name: "provenance-recovers-the-originating-request",
    description:
      "A fresh agent recovers what a prior collaborator was actually asked to do, from the artifact alone",
    category: "provenance-questions",
    workspaceRepoFixture: CONTENT_WORKSPACE_REPO_FIXTURE,
    validation: "agent-evidence",
    timeoutMs: 15 * 60_000,
    prompt: "Harness-orchestrated recovery of an originating request.",
    // The only case that still needs a live author: the chain under test ends
    // at a trajectory message, and a seeded import has no human turn to reach.
    orchestrate: orchestratePhases(
      [
        {
          role: "author",
          note: "author records a constrained batch size",
          prompt: (repoPath) =>
            [
              `In ${repoPath}, create src/export-batching.ts with a small exported exportBatchSize constant set to 64.`,
              `Please keep it at 64 because ${RELAY_REASON}.`,
              BARE_FILE,
              "Commit that change and report the path and the resulting clean state.",
            ].join(" "),
        },
        {
          role: "reader",
          note: "cold reader recovers the request behind the constant",
          prompt: (repoPath) =>
            `Someone set exportBatchSize in ${repoPath}/src/export-batching.ts. I need to know what they were actually asked to do — the original request behind that value, not just who touched the line. Tell me what was being attempted and how far back the recorded evidence actually reaches.`,
        },
      ],
      // This scenario deliberately asks a second session to inspect work the
      // first session committed on the same local line. The visibility-boundary
      // scenario below uses the ordinary forked phase contexts instead.
      "task",
    ),
    validate: (result) =>
      all(
        provenanceSurfacesAreLive(result),
        // The mechanism must reach the statement and render it intact — this is
        // the half that regressed when the terminal excerpt was truncated.
        walkDelivered(result, "cause", /512\s*KiB|512KiB/iu),
        // The agent must then actually use it. One token, not a phrasing.
        answered(result, [/512|pelagic|relay/iu]),
        identityHygieneHolds(result),
      ),
  },
  {
    name: "provenance-recovers-the-cohort-of-one-request",
    description:
      "A fresh agent lists everything else that changed under one prior request",
    category: "provenance-questions",
    workspaceRepoFixture: PROVENANCE_RECORD_WORKSPACE_REPO_FIXTURE,
    validation: "agent-evidence",
    prompt:
      "I need to change the socket ping interval in the disposable project's src/socket-policy.ts. Whatever piece of work put that value there also touched other things, and I want the full list before I touch anything. What else was done as part of that same work, and what was it for?",
    validate: (result) => {
      const live = provenanceSurfacesAreLive(result);
      if (!live.passed) return live;
      // The capability is breadth: reaching everything one request touched
      // rather than the one coordinate the reader already had. That is a count
      // in the surface's own output, not a list of names in the prose.
      const breadth = cohortBreadth(result);
      if (breadth < 2) {
        return {
          passed: false,
          reason: `The cohort put ${breadth} coordinate(s) in front of the agent; a request that touched three should not read as one`,
        };
      }
      return all(
        namedAtLeast(
          result,
          [/retry-policy/iu, /upload-policy/iu, /socket-policy/iu],
          2,
        ),
        identityHygieneHolds(result),
      );
    },
  },
  {
    name: "provenance-consults-rejections-before-repeating-them",
    description:
      "A fresh agent finds that the change it was asked to make was already tried and undone, and says why",
    category: "provenance-questions",
    workspaceRepoFixture: PROVENANCE_RECORD_WORKSPACE_REPO_FIXTURE,
    validation: "agent-evidence",
    prompt:
      "Retries are churning in the disposable project. Raise backoffCeilingSeconds in src/retry-policy.ts to 300 so we back off harder. Before you change anything, check whether this workspace already has something to say about that value, and tell me what you find.",
    validate: (result) =>
      all(
        provenanceSurfacesAreLive(result),
        consultedNegativeEvidence(result),
        // Grade the facts the answer must carry, not the sentence shape it
        // carries them in: that this exact value was raised before, that the
        // raise was undone, and why.
        answered(result, [
          /300/u,
          /(?:revert|undone|undid|counteract|rolled back|put back)/iu,
          /staging|cut the link|before the retry/iu,
        ]),
        identityHygieneHolds(result),
      ),
  },
  {
    name: "provenance-finds-a-subject-by-its-prose",
    description:
      "A fresh agent finds recorded reasoning it cannot name, starting from a hunch",
    category: "provenance-questions",
    workspaceRepoFixture: PROVENANCE_RECORD_WORKSPACE_REPO_FIXTURE,
    validation: "agent-evidence",
    prompt:
      "Somebody once recorded something about staging cutting a connection before a wait finished — I do not know which project, file, or change it was attached to. Find it and tell me what happened and which value it concerns.",
    validate: (result) =>
      all(
        provenanceSurfacesAreLive(result),
        // What the mechanism must do is return the right subject from a hunch.
        // That is observable in the surface's own result; how the reader then
        // spells the finding in prose is not the capability under test.
        foundTheSubject(result, /staging|cut the link|backoff/iu),
        answered(result, [/backoff|retry|30|300/iu]),
        identityHygieneHolds(result),
      ),
  },
  {
    name: "provenance-answers-a-set-shaped-question",
    description:
      "A fresh agent answers a counting question over the record instead of crawling it edge by edge",
    category: "provenance-questions",
    workspaceRepoFixture: PROVENANCE_RECORD_WORKSPACE_REPO_FIXTURE,
    validation: "agent-evidence",
    prompt:
      "Give me an inventory of the recorded work in the disposable project: every distinct piece of work so far, what each one was for, and how many files each touched. I want the whole set in one view, not a tour of it.",
    validate: (result) =>
      all(
        provenanceSurfacesAreLive(result),
        namedAtLeast(
          result,
          [
            /retry-policy/iu,
            /socket-policy/iu,
            /upload-policy/iu,
            /cache-policy/iu,
          ],
          2,
          // The same four pieces of work, named by what each one was for.
          [/retry|backoff/iu, /socket|ping/iu, /upload|chunk/iu, /cache|feed/iu],
        ),
        reportedTheSize(result, /\b(?:4|four|5|five)\b/iu),
        identityHygieneHolds(result),
      ),
  },
];

const EXTENDED_CASES: TestCase[] = [
  {
    name: "provenance-recovers-an-unstated-constraint",
    description:
      "A fresh agent recovers a constraint nobody ever wrote down, from the shape of past requests and undone work",
    category: "provenance-questions",
    /**
     * The flagship, and the case the seeded record was designed around: three
     * timeouts all kept short, and one attempt at a long one that was undone
     * with its reason. Nothing anywhere says "this environment kills long-lived
     * connections" — that is the constraint the agent has to abduce before
     * adding a ten-minute keepalive.
     */
    workspaceRepoFixture: PROVENANCE_RECORD_WORKSPACE_REPO_FIXTURE,
    validation: "agent-evidence",
    prompt:
      "Reconnect churn is hurting us in the disposable project. Add a keepalive that holds one connection open for ten minutes instead of reconnecting. Before you write anything, check what this workspace already knows about how this project behaves, and tell me whether the plan is a good idea here.",
    validate: (result) =>
      all(
        provenanceSurfacesAreLive(result),
        // Half one, exact: the evidence reached the agent. If this fails the
        // finding is a broken mechanism. If it passes and the next check
        // fails, the finding is that cheap evidence did not produce abduction —
        // which is the thing this scenario exists to measure.
        walkDelivered(result, "rejections", /undone|revert|counteract/iu),
        // Half two, deliberately loose: the agent has to say that holding a
        // connection open conflicts with what this environment does to them.
        // Any wording carrying both halves of that conflict counts.
        answered(result, [
          /ten minutes|10 minutes|600 seconds|long[- ]lived|keep(?:ing|s)? (?:the |one )?connection open|keepalive/iu,
          /(?:drop|dropped|cut|kill|killed|sever|terminat|die|died|closed|reconnect)/iu,
        ]),
        identityHygieneHolds(result),
      ),
  },
  {
    name: "provenance-holds-the-visibility-boundary",
    description:
      "A fresh agent asking about another context's uncommitted work is told nothing, rather than shown it",
    category: "provenance-questions",
    workspaceRepoFixture: CONTENT_WORKSPACE_REPO_FIXTURE,
    validation: "agent-evidence",
    timeoutMs: 6 * 60_000,
    prompt: "Harness-orchestrated visibility parity.",
    orchestrate: orchestratePhases([
      {
        // The boundary this system actually has is around *uncommitted* working
        // state: sibling task contexts deliberately share committed history, so
        // a committed-but-unpublished change is not the boundary to test — a
        // fixture built on that premise measures nothing.
        role: "private-author",
        note: "work left in one task context's working state",
        prompt: (repoPath) =>
          [
            `In ${repoPath}, create src/request-policy.ts exporting requestTimeoutSeconds set to 37,`,
            "because the Northstar ingress cuts streams after 40 seconds.",
            "Keep the file to that one constant, and leave the change uncommitted —",
            "I want to look at it before it goes any further.",
          ].join(" "),
      },
      {
        role: "outsider",
        note: "an independent context asks a question the private work would answer",
        // Name the coordinate a user is investigating, but not the private
        // value or rationale. This asks the real product question—"why did this
        // setting change?"—without turning the scenario into a workspace-wide
        // source-code scavenger hunt.
        prompt: (repoPath) =>
          `A teammate mentioned a possible change to requestTimeoutSeconds in ${repoPath}/src/request-policy.ts. What recorded workspace history explains that change? Check the workspace provenance for that coordinate; if no recorded change is visible, say so.`,
      },
    ]),
    validate: (result) =>
      all(
        // The parity property, end to end: what a walk cannot reach, a query
        // and a search must not return either.
        withheld(
          result,
          /northstar|requestTimeoutSeconds\s*(?:=|is|to)\s*37|40[- ]second/iu,
        ),
        provenanceSurfacesAreLive(result),
        identityHygieneHolds(result),
      ),
  },
];

export const provenanceQuestionTests: TestCase[] = [
  ...CANONICAL_QUESTION_CASES,
  ...EXTENDED_CASES,
];
