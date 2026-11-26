import { expect, it } from "vitest";
import { prepareOpenSpecialistHandoff } from "./open-goal-specialist-managed.js";
import { specialistHandoffWorlds } from "./open-goal-specialist-worlds.js";
import { sha256HexSyncText } from "@vibestudio/content-addressing";

// Component ports retain independent native-like events/bytes. These controls
// are not full Vibe qualification and are never teacher or corpus data.
function memoryPorts() {
  const rows: any[] = [],
    roster: any[] = [],
    blobs = new Map<string, string>(),
    files = new Map<string, string>(),
    directories: string[] = [];
  const lane = { key: "owned-specialist", target: "owned-target" };
  let sequence = 0;
  const fs = {
    mkdtemp: async (prefix: string) => {
      const path = `/.tmp/${prefix}-${directories.length}`;
      directories.push(path);
      return path;
    },
    writeFile: async (path: string, text: string) => {
      files.set(path, text);
    },
    rename: async (a: string, b: string) => {
      files.set(b, files.get(a)!);
      files.delete(a);
    },
    rm: async () => {},
    readdir: async () => directories.map((path) => path.split("/").at(-1)!),
  };
  const ports = {
    contextId: "owned",
    fs,
    status: async () => ({
      mainEventId: "current-head",
      workingHead: { revision: 1 },
    }),
    open: async () => lane,
    member: async (
      _lane: any,
      _context: string,
      handle: string,
      _name: string,
      availability: string,
    ) => {
      const id = `member:${handle}`;
      if (availability !== "absent")
        roster.push({
          participantId: availability === "conflict" ? "foreign" : id,
          metadata: { handle, type: "agent" },
        });
      return id;
    },
    roster: async () => structuredClone(roster),
    append: async (_lane: any, _context: string, records: any[]) =>
      records.map((record) => {
        const seq = ++sequence,
          messageId = `source:${seq}`;
        rows.push({ messageId, envelopeId: `envelope:${seq}`, seq, record });
        return messageId;
      }),
    read: async () => ({
      channelId: lane.key,
      through: sequence,
      rows: structuredClone(rows),
    }),
    put: async (text: string) => {
      const digest = sha256HexSyncText(text);
      blobs.set(digest, text);
      return digest;
    },
    get: async (digest: string) => blobs.get(digest) ?? null,
    readBytes: async (path: string) =>
      new TextEncoder().encode(files.get(path) ?? ""),
  };
  return ports;
}
it("retains actual current facts after one or repeated observations without reference-plan/report gates", async () => {
  const prepared = await prepareOpenSpecialistHandoff(
    { contextId: "owned", caseId: "specialist-ui-review-read-only" },
    memoryPorts() as never,
  );
  const index = await prepared.services.ownedSpecialistIndex.list();
  const scope = index.scope;
  await prepared.services.channelAgentRead.read({
    goal: prepared.goal,
    channelId: scope.channelId,
    contextId: scope.contextId,
    handle: "conversation-ui",
    action: "inspect",
    options: null,
  });
  const snapshot = await prepared.services.ownedSpecialistRun.read(
    scope.channelId,
  );
  const result = snapshot!.rows.find((row) => row.record.kind === "result")!;
  expect(
    await prepared.services.ownedSpecialistArtifact.read(
      scope.channelId,
      result.messageId,
    ),
  ).not.toBeNull();
  const answer = {
    plan: {
      explanation: "This CSS spacing proposal does not change stored replies.",
    },
  };
  const proof = await prepared.verify(answer);
  expect(proof.passed).toBe(true);
  expect(proof.semanticReviewRequired).toBe(true);
  expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(answer);
  expect(proof.observedChecks).not.toHaveProperty("exactSpecialistFrontiers");
  expect(proof.observedChecks).not.toHaveProperty("exactOriginalAttempt");
  expect(
    proof.semanticReviewInput.actual.observations.independent.every(
      (candidate: any) => !Object.hasOwn(candidate.nativeJoin, "action"),
    ),
  ).toBe(true);
  expect((await prepared.verify(null)).passed).toBe(false);
  await prepared.services.ownedSpecialistRun.read(scope.channelId);
  await prepared.services.ownedSpecialistRun.read(scope.channelId);
  expect((await prepared.verify(answer)).passed).toBe(true);
  const invented = await prepared.verify({
    plan: { explanation: "All stored history has been migrated." },
  });
  expect(invented.semanticReviewRequired).toBe(true);
  expect(
    invented.semanticReviewInput.actual.requestedReturn.plan.explanation,
  ).toContain("migrated");
});
it("stages only exact authorized originals after actual investigation, without two-read/one-artifact or prose-count gates", async () => {
  const prepared = await prepareOpenSpecialistHandoff(
    { contextId: "owned", caseId: "specialist-history-not-panel-proxy" },
    memoryPorts() as never,
  );
  const { scope } = await prepared.services.ownedSpecialistIndex.list();
  for (const handle of ["event-compat", "panel-help"])
    await prepared.services.channelAgentRead.read({
      goal: prepared.goal,
      channelId: scope.channelId,
      contextId: scope.contextId,
      handle,
      action: "inspect",
      options: null,
    });
  const current = (await prepared.services.ownedSpecialistRun.read(
    scope.channelId,
  ))!;
  const attempt = current.rows.find(
    (row) =>
      row.record.kind === "attempt" && row.record.handle === "event-compat",
  )!;
  const result = current.rows.find(
    (row) =>
      row.record.kind === "result" && row.record.handle === "event-compat",
  )!;
  const other = current.rows.find(
    (row) => row.record.kind === "result" && row.record.handle === "panel-help",
  )!;
  await prepared.services.ownedSpecialistArtifact.read(
    scope.channelId,
    other.messageId,
  );
  const artifact = await prepared.services.ownedSpecialistArtifact.read(
    scope.channelId,
    result.messageId,
  );
  const original = result.record as any;
  const plan = {
    handle: "event-compat",
    channelId: scope.channelId,
    taskId: scope.taskId,
    through: current.through,
    attemptMessage: attempt.messageId,
    resultMessage: result.messageId,
    sourceEvent: original.sourceEvent,
    artifact,
    reason: "verified",
    action: "stage",
    explanation:
      "Preserve the committed event and inspect retained reply compatibility.",
  };
  const history = {
    goal: artifact!.text,
    units: {
      owner: original.owner,
      consumers: original.consumers,
      blockers: [],
    },
    result: {
      persistedContract: true,
      retainedHistoryChecks: Array.from(
        { length: 8 },
        (_, i) =>
          `Native history check ${i}: ${"retained compatibility ".repeat(20)}`,
      ),
    },
  };
  expect(
    await prepared.services.ownedSpecialistHandoff.stage(
      { ...plan, taskId: "foreign" } as never,
      history,
    ),
  ).toBeNull();
  const handoff = await prepared.services.ownedSpecialistHandoff.stage(
    plan as never,
    history,
  );
  expect(handoff).not.toBeNull();
  const proof = await prepared.verify({ plan, history, handoff });
  expect(proof.passed).toBe(true);
  expect(proof.semanticReviewRequired).toBe(true);
  expect(proof.outcomeContract.returnedValue.required).toBe(false);
  expect(proof.observedChecks.exactAuthorizedSpecialistHandoff).toBe(true);
});

it.each(specialistHandoffWorlds)(
  "retains crisp native reference obligations for $id without treating its example answer as gold",
  async (world) => {
    const prepared = await prepareOpenSpecialistHandoff(
      { contextId: "owned", caseId: world.id },
      memoryPorts() as never,
    );
    const proof = await prepared.qualify();
    expect(proof.passed).toBe(true);
    expect(proof.semanticReviewRequired).toBe(true);
    expect(proof.outcomeContract.returnedValue.required).toBe(
      world.requestedAnswer,
    );
  },
);
