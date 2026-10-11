import { parse } from "@babel/parser";
import {
  evalRpcCallObservationSchema,
  evalWorkerLifecycleObservationSchema,
  evalOperationJournalSchema,
  fingerprintEvalRpcValue,
  type EvalRpcCallObservation,
  type EvalWorkerLifecycleObservation,
} from "@vibestudio/service-schemas/eval";
import {
  BUILDABLE_REGULAR_WORKER_WORKSPACE_REPO_FIXTURE,
  BUILDABLE_WORKER_WORKSPACE_REPO_FIXTURE,
  type TestCase,
  type TestExecutionResult,
} from "../types.js";
import {
  completedScenarioEvidence,
  hasNonEmptyStructuredResult,
  invocationConsoleOutput,
  invocationReturnValue,
  requireCodeOperations,
  type ScenarioEvidence,
  walkArrays,
  walkRecords,
} from "./_scenario-evidence.js";

type SyntaxNode = { type: string; [key: string]: unknown };
type ProbeBinding = { tainted: boolean };
type ProbeScope = { parent: ProbeScope | null; bindings: Map<string, ProbeBinding> };
const FUNCTION_NODE_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

function isSyntaxNode(value: unknown): value is SyntaxNode {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function childSyntaxNodes(node: SyntaxNode): SyntaxNode[] {
  return Object.values(node).flatMap((value) => {
    if (isSyntaxNode(value)) return [value];
    if (!Array.isArray(value)) return [];
    return value.filter(isSyntaxNode);
  });
}

function probeSyntax(root: SyntaxNode): {
  nodes: SyntaxNode[];
  scopeByNode: WeakMap<SyntaxNode, ProbeScope>;
  bindingByDeclaration: WeakMap<SyntaxNode, ProbeBinding>;
} {
  const nodes: SyntaxNode[] = [];
  const scopeByNode = new WeakMap<SyntaxNode, ProbeScope>();
  const bindingByDeclaration = new WeakMap<SyntaxNode, ProbeBinding>();
  const rootScope: ProbeScope = { parent: null, bindings: new Map() };
  const visit = (node: SyntaxNode, parentScope: ProbeScope, isRoot = false): void => {
    const scope =
      !isRoot &&
      ["BlockStatement", "CatchClause", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement"].includes(node.type)
        ? { parent: parentScope, bindings: new Map<string, ProbeBinding>() }
        : parentScope;
    nodes.push(node);
    scopeByNode.set(node, scope);
    if (!isRoot && FUNCTION_NODE_TYPES.has(node.type)) return;
    if (node.type === "VariableDeclarator") {
      const name = isSyntaxNode(node["id"]) ? identifierName(node["id"]) : undefined;
      if (name) {
        const binding: ProbeBinding = { tainted: false };
        scope.bindings.set(name, binding);
        bindingByDeclaration.set(node, binding);
      }
    }
    for (const child of childSyntaxNodes(node)) visit(child, scope);
  };
  visit(root, rootScope, true);
  nodes.sort((left, right) => {
    const leftStart = left["start"];
    const rightStart = right["start"];
    return (typeof leftStart === "number" ? leftStart : 0) - (typeof rightStart === "number" ? rightStart : 0);
  });
  return { nodes, scopeByNode, bindingByDeclaration };
}

function containsSyntaxNode(
  root: SyntaxNode,
  predicate: (node: SyntaxNode) => boolean
): boolean {
  return (
    predicate(root) ||
    (!FUNCTION_NODE_TYPES.has(root.type) &&
      childSyntaxNodes(root).some((child) => containsSyntaxNode(child, predicate)))
  );
}

function identifierName(node: SyntaxNode | undefined): string | undefined {
  return node?.type === "Identifier" && typeof node["name"] === "string"
    ? node["name"]
    : undefined;
}

function resolveProbeBinding(scope: ProbeScope | undefined, name: string): ProbeBinding | undefined {
  for (let current = scope; current; current = current.parent ?? undefined) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
  }
  return undefined;
}

function memberName(node: SyntaxNode | undefined): string | undefined {
  if (node?.type !== "MemberExpression") return undefined;
  const property = node["property"];
  if (isSyntaxNode(property) && property.type === "Identifier")
    return identifierName(property);
  if (isSyntaxNode(property) && property.type === "StringLiteral")
    return typeof property["value"] === "string" ? property["value"] : undefined;
  return undefined;
}

function workerTargetExpression(node: SyntaxNode, code: string): string | undefined {
  if (node.type === "Identifier") return code.slice(Number(node["start"]), Number(node["end"]));
  return node.type === "MemberExpression" && memberName(node) === "targetId"
    ? code.slice(Number(node["start"]), Number(node["end"]))
    : undefined;
}

function ownerMethodDescriptor(
  method: SyntaxNode,
  methodName: string,
  contractBindings: ReadonlySet<string>
): boolean {
  if (method.type !== "MemberExpression") return false;
  const table = method["object"];
  return (
    isSyntaxNode(table) &&
    table.type === "Identifier" &&
    contractBindings.has(identifierName(table) ?? "") &&
    memberName(method) === methodName
  );
}

function workerProbeCall(
  node: SyntaxNode,
  methodName?: string,
  options?: { code: string; contractBindings: ReadonlySet<string>; targetExpression?: string }
): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = node["callee"];
  if (!isSyntaxNode(callee)) return false;
  const args = node["arguments"];
  const firstArgument = Array.isArray(args) && isSyntaxNode(args[0]) ? args[0] : undefined;
  if (!firstArgument) return false;
  const targetsWorker = options
    ? workerTargetExpression(firstArgument, options.code) !== undefined
    : containsSyntaxNode(firstArgument, (child) => memberName(child) === "targetId");
  if (!targetsWorker) return false;
  if (methodName) {
    const method = Array.isArray(args) && isSyntaxNode(args[1]) ? args[1] : undefined;
    if (
      !method ||
      !options ||
      !ownerMethodDescriptor(method, methodName, options.contractBindings)
    ) {
      return false;
    }
    if (
      options.targetExpression &&
      options.code.slice(Number(firstArgument["start"]), Number(firstArgument["end"])) !==
        options.targetExpression
    ) {
      return false;
    }
  }
  if (
    callee.type === "MemberExpression" &&
    memberName(callee) === "call"
  ) {
    const receiver = callee["object"];
    return (
      isSyntaxNode(receiver) &&
      (identifierName(receiver) === "rpc" || memberName(receiver) === "rpc")
    );
  }
  return false;
}

/** Check syntax-level value flow, then let the eval owner’s recorded return/log prove the value. */
function observesWorkerProbeResult(
  code: string,
  methodName?: string,
  returnedProperties?: Set<string>,
  contractBindings?: ReadonlySet<string>,
  targetExpression?: string
): boolean {
  let root: SyntaxNode;
  try {
    const parsedProgram: unknown = parse(code, {
      sourceType: "unambiguous",
      plugins: ["typescript"],
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }).program;
    if (!isSyntaxNode(parsedProgram)) return false;
    root = parsedProgram;
  } catch {
    return false;
  }
  const { nodes, scopeByNode, bindingByDeclaration } = probeSyntax(root);
  const probeCalls = new Set(nodes.filter((node) =>
    workerProbeCall(
      node,
      methodName,
      methodName && contractBindings
        ? { code, contractBindings, targetExpression }
        : undefined
    )
  ));
  if (probeCalls.size === 0) return false;

  const dependsOnProbe = (node: SyntaxNode): boolean =>
    containsSyntaxNode(
      node,
      (child) => {
        if (probeCalls.has(child)) return true;
        const name = identifierName(child);
        return name !== undefined && resolveProbeBinding(scopeByNode.get(child), name)?.tainted === true;
      }
    );

  for (const node of nodes) {
    if (node.type === "VariableDeclarator") {
      const binding = bindingByDeclaration.get(node);
      const init = node["init"];
      if (binding) binding.tainted = isSyntaxNode(init) && dependsOnProbe(init);
    } else if (node.type === "AssignmentExpression") {
      const name = isSyntaxNode(node["left"]) ? identifierName(node["left"]) : undefined;
      const value = node["right"];
      const binding = name ? resolveProbeBinding(scopeByNode.get(node), name) : undefined;
      if (binding && isSyntaxNode(value)) binding.tainted = dependsOnProbe(value);
    } else if (node.type === "ReturnStatement") {
      const argument = node["argument"];
      if (!isSyntaxNode(argument)) continue;
      if (!returnedProperties) {
        if (dependsOnProbe(argument)) return true;
        continue;
      }
      if (argument.type === "ObjectExpression" && Array.isArray(argument["properties"])) {
        for (const property of argument["properties"]) {
          if (!isSyntaxNode(property) || property.type !== "ObjectProperty") continue;
          const key = property["key"];
          const value = property["value"];
          const name = isSyntaxNode(key)
            ? identifierName(key) ?? (typeof key["value"] === "string" ? key["value"] : undefined)
            : undefined;
          if (name && isSyntaxNode(value) && dependsOnProbe(value)) returnedProperties.add(name);
        }
        if (returnedProperties.size > 0) return true;
      } else if (dependsOnProbe(argument)) {
        returnedProperties.add("*");
        return true;
      }
    } else if (node.type === "CallExpression") {
      const callee = node["callee"];
      const args = node["arguments"];
      if (
        isSyntaxNode(callee) &&
        memberName(callee) === "log" &&
        isSyntaxNode(callee["object"]) &&
        identifierName(callee["object"]) === "console" &&
        Array.isArray(args) &&
        args.some((argument) => isSyntaxNode(argument) && dependsOnProbe(argument))
      )
        return true;
    }
  }
  return false;
}

function lifecycleEvidence(
  result: TestExecutionResult,
  operations: readonly (readonly string[])[]
) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const exercised = requireCodeOperations(base.evidence.evalCode, operations);
  if (!exercised.passed) return exercised;
  return { passed: true as const, evidence: base.evidence };
}

type CleanupObservation = "absent" | "proved" | "contradicted" | "inconclusive";

function explicitCleanupProof(values: readonly unknown[]): CleanupObservation {
  let present = false;
  let contradicted = false;

  const inventoryIdentity = (entry: unknown): string | undefined => {
    if (typeof entry === "string") return entry;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const id = (entry as Record<string, unknown>)["id"];
    return typeof id === "string" && id.length > 0 ? id : undefined;
  };

  const inventoriesMatch = (before: readonly unknown[], after: readonly unknown[]): boolean => {
    if (before.length !== after.length) return false;
    const beforeIds = before.map(inventoryIdentity);
    const afterIds = after.map(inventoryIdentity);
    if (beforeIds.every((id) => id !== undefined) && afterIds.every((id) => id !== undefined)) {
      return [...beforeIds].sort().every((id, index) => id === [...afterIds].sort()[index]);
    }
    return before.every((entry, index) => Object.is(entry, after[index]));
  };

  const proved = walkRecords(values).some((record) => {
    if (
      "createdId" in record ||
      "retiredId" in record ||
      "destroyedId" in record ||
      "before" in record ||
      "after" in record ||
      "beforeCount" in record ||
      "afterCreateCount" in record ||
      "afterDestroyCount" in record ||
      "existsAfterCreate" in record ||
      "existsAfterDestroy" in record
    ) {
      present = true;
    }
    const createdId = record["createdId"];
    const retiredId = record["retiredId"] ?? record["destroyedId"];
    const identityMatched =
      typeof createdId === "string" && createdId.length > 0 && retiredId === createdId;
    if (
      typeof createdId === "string" &&
      createdId.length > 0 &&
      typeof retiredId === "string" &&
      retiredId.length > 0 &&
      retiredId !== createdId
    ) {
      contradicted = true;
    }
    const before = record["before"];
    const after = record["after"];
    const inventoryRestored =
      Array.isArray(before) && Array.isArray(after) && inventoriesMatch(before, after);
    if (Array.isArray(before) && Array.isArray(after) && !inventoryRestored) {
      contradicted = true;
    }
    const observedLifecycle =
      record["existsAfterCreate"] === true && record["existsAfterDestroy"] === false;
    if (record["existsAfterDestroy"] === true) contradicted = true;
    const beforeCount = record["beforeCount"];
    const afterCreateCount = record["afterCreateCount"];
    const afterDestroyCount = record["afterDestroyCount"];
    const countRestored =
      typeof beforeCount === "number" &&
      Number.isSafeInteger(beforeCount) &&
      typeof afterCreateCount === "number" &&
      Number.isSafeInteger(afterCreateCount) &&
      typeof afterDestroyCount === "number" &&
      Number.isSafeInteger(afterDestroyCount) &&
      afterCreateCount > beforeCount &&
      afterDestroyCount === beforeCount;
    if (
      typeof beforeCount === "number" &&
      Number.isSafeInteger(beforeCount) &&
      typeof afterCreateCount === "number" &&
      Number.isSafeInteger(afterCreateCount) &&
      typeof afterDestroyCount === "number" &&
      Number.isSafeInteger(afterDestroyCount) &&
      (!countRestored || afterCreateCount <= beforeCount)
    ) {
      contradicted = true;
    }
    return identityMatched || inventoryRestored || observedLifecycle || countRestored;
  });
  if (contradicted) return "contradicted";
  if (proved) return "proved";
  return present ? "inconclusive" : "absent";
}

function requireCleanup(evidence: ScenarioEvidence, result: TestExecutionResult) {
  const observation = result.diagnostics?.["fixtureRuntimeEntities"];
  if (!observation || typeof observation !== "object" || Array.isArray(observation))
    return {
      passed: false,
      reason: "The harness did not observe the fixture runtime inventory before cleanup",
    };
  const { source, entities } = observation as { source?: unknown; entities?: unknown };
  if (typeof source !== "string" || !source.startsWith("workers/") || !Array.isArray(entities))
    return { passed: false, reason: "The fixture runtime inventory was malformed" };
  if (entities.length > 0)
    return {
      passed: false,
      reason: "The canonical runtime inventory still contains a fixture instance",
    };
  if (explicitCleanupProof(evidence.evalValues) === "contradicted")
    return { passed: false, reason: "The reported runtime lifecycle contradicts cleanup" };
  return { passed: true, reason: undefined };
}

function isRowCollection(value: unknown): value is Array<{ id: string; value: string }> {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(
      (row) =>
        row !== null &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        typeof (row as Record<string, unknown>)["id"] === "string" &&
        typeof (row as Record<string, unknown>)["value"] === "string"
    ) &&
    new Set(value.map((row) => (row as Record<string, unknown>)["id"])).size === value.length
  );
}

function observedRows(
  values: readonly unknown[],
  properties: ReadonlySet<string>
): Array<Array<{ id: string; value: string }>> {
  const candidates = properties.has("*")
    ? walkArrays(values)
    : walkRecords(values).flatMap((record) => [...properties].map((property) => record[property]));
  return candidates.filter(isRowCollection);
}

function completedEvalJournalGroups(calls: ScenarioEvidence["calls"]) {
  return calls.flatMap((call) => {
    if (
      call.name !== "eval" ||
      call.execution?.status !== "complete" ||
      call.execution.isError === true
    ) return [];
    const result = call.execution.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) return [];
    const details = (result as Record<string, unknown>)["details"];
    if (!details || typeof details !== "object" || Array.isArray(details)) return [];
    const parsed = evalOperationJournalSchema.safeParse(
      (details as Record<string, unknown>)["operationJournal"]
    );
    return parsed.success ? [{ call, entries: parsed.data.entries }] : [];
  });
}

type LocatedLifecycleReceipt = {
  receipt: EvalWorkerLifecycleObservation;
  call: EvalRpcCallObservation;
};

function sameRpcOwner(left: EvalRpcCallObservation, right: EvalRpcCallObservation): boolean {
  return left.ownerId === right.ownerId && left.ownerGeneration === right.ownerGeneration;
}

function rpcCallReceipts(entries: readonly Record<string, unknown>[]) {
  return entries.flatMap((entry) => {
    if (entry["type"] !== "rpc.call") return [];
    const parsed = evalRpcCallObservationSchema.safeParse(entry["receipt"]);
    return parsed.success ? [parsed.data] : [];
  });
}

function workerLifecycleReceipts(entries: readonly Record<string, unknown>[]) {
  return entries.flatMap((entry) => {
    if (entry["type"] !== "worker.lifecycle") return [];
    const parsed = evalWorkerLifecycleObservationSchema.safeParse(entry["receipt"]);
    return parsed.success ? [parsed.data] : [];
  });
}

function workerLifecycleCallReceipts(
  groups: ReturnType<typeof completedEvalJournalGroups>
): Array<{
  group: (typeof groups)[number];
  receipt: EvalWorkerLifecycleObservation;
  call: EvalRpcCallObservation;
}> {
  return groups.flatMap((group) => {
    const calls = rpcCallReceipts(group.entries);
    return workerLifecycleReceipts(group.entries).flatMap((receipt) => {
      const method =
        receipt.operation === "create" ? "runtime.createEntity" :
        receipt.operation === "resolve" ? "workers.resolveDurableObject" :
        receipt.operation === "resolve-service" ? "workers.resolveService" :
        "runtime.retireEntity";
      const call = calls.find((candidate) =>
        candidate.callId === receipt.callId && candidate.targetId === "main" &&
        candidate.method === method && candidate.outcome === "fulfilled"
      );
      return call ? [{ group, receipt, call }] : [];
    });
  });
}

function returnedValueContainsFingerprint(value: unknown, fingerprint: string): boolean {
  const seen = new Set<object>();
  const visit = (candidate: unknown): boolean => {
    const observed = fingerprintEvalRpcValue(candidate);
    if (observed.available && observed.fingerprint === fingerprint) return true;
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) return false;
    seen.add(candidate);
    return (Array.isArray(candidate) ? candidate : Object.values(candidate))
      .some(visit);
  };
  return visit(value);
}

function createdWorkerReceiverCallObserved(
  groups: ReturnType<typeof completedEvalJournalGroups>,
  source: string,
  kind: "worker" | "do",
  methodName: string
): boolean {
  const lifecycle = workerLifecycleCallReceipts(groups);
  const creations = lifecycle.filter(
    (entry): entry is typeof entry & {
      receipt: Extract<EvalWorkerLifecycleObservation, { operation: "create" }>;
    } => {
      const receipt = entry.receipt;
      if (receipt.operation !== "create" || receipt.source !== source) return false;
      return kind === "do"
        ? receipt.kind === "do" && receipt.className === "FixtureWorkerDO"
        : receipt.kind === "worker";
    }
  );
  const retirements = lifecycle.filter(
    (entry): entry is typeof entry & {
      receipt: Extract<EvalWorkerLifecycleObservation, { operation: "retire" }>;
    } => entry.receipt.operation === "retire"
  );
  return creations.some((creation) => {
    const receiverCalls = groups.flatMap((group) =>
      rpcCallReceipts(group.entries)
        .filter((receipt) => receipt.targetId === creation.receipt.targetId &&
          receipt.method === methodName && receipt.outcome === "fulfilled")
        .map((receipt) => ({ group, receipt }))
    );
    return receiverCalls.some(({ group, receipt }) => {
      if (!sameRpcOwner(creation.call, receipt) ||
        creation.call.settlementOrder >= receipt.admissionOrder ||
        receipt.result?.available !== true) return false;
      const retiredAfterCall = retirements.some(({ receipt: retired, call }) =>
        retired.entityId === creation.receipt.entityId &&
        sameRpcOwner(receipt, call) && receipt.settlementOrder < call.admissionOrder
      );
      if (!retiredAfterCall) return false;
      const returned = invocationReturnValue(group.call);
      return returned.present && returnedValueContainsFingerprint(
        returned.value,
        receipt.result.fingerprint
      );
    });
  });
}

function resolvedServiceReceiverCallObserved(
  groups: ReturnType<typeof completedEvalJournalGroups>,
  source: string,
  className: string
): boolean {
  const resolutions = workerLifecycleCallReceipts(groups).filter(
    (entry): entry is typeof entry & {
      receipt: Extract<EvalWorkerLifecycleObservation, { operation: "resolve-service" }>;
    } => {
      const receipt = entry.receipt;
      return receipt.operation === "resolve-service" && receipt.source === source &&
        receipt.className === className;
    }
  );
  return resolutions.some((resolution) => groups.some((group) => {
    const returned = invocationReturnValue(group.call);
    if (!returned.present) return false;
    return rpcCallReceipts(group.entries).some((receipt) => {
      if (receipt.targetId !== resolution.receipt.targetId || receipt.targetId === "main" ||
        receipt.outcome !== "fulfilled" || receipt.result?.available !== true ||
        !sameRpcOwner(resolution.call, receipt) ||
        resolution.call.settlementOrder >= receipt.admissionOrder) return false;
      return returnedValueContainsFingerprint(returned.value, receipt.result.fingerprint);
    });
  }));
}

function requireSqlPersistenceEvidence(result: TestExecutionResult) {
  const base = lifecycleEvidence(result, [
    ["workers.createDurableObject", "workers.destroy"],
    ["runtime.createEntity", "runtime.retireEntity"],
  ]);
  if (!base.passed) return base;
  const fixture = result.diagnostics?.["workspaceRepoFixture"];
  const repoName =
    fixture && typeof fixture === "object" && !Array.isArray(fixture) &&
    typeof (fixture as Record<string, unknown>)["repoName"] === "string"
      ? String((fixture as Record<string, unknown>)["repoName"])
      : undefined;
  if (!repoName) return { passed: false, reason: "The owner fixture identity was unavailable" };
  const groups = completedEvalJournalGroups(base.evidence.calls);
  const lifecycle: LocatedLifecycleReceipt[] = workerLifecycleCallReceipts(groups);
  const created = lifecycle.filter(
    (entry): entry is LocatedLifecycleReceipt & {
      receipt: Extract<EvalWorkerLifecycleObservation, { operation: "create" }>;
    } =>
      entry.receipt.operation === "create" &&
      entry.receipt.kind === "do" &&
      entry.receipt.source === `workers/${repoName}` &&
      entry.receipt.className === "FixtureWorkerDO"
  );
  const retired = lifecycle.filter(
    (entry): entry is LocatedLifecycleReceipt & {
      receipt: Extract<EvalWorkerLifecycleObservation, { operation: "retire" }>;
    } => entry.receipt.operation === "retire"
  );
  const rpcGroups = groups.map(({ entries, call }) => ({
    call,
    receipts: rpcCallReceipts(entries),
  }));
  const preservedRows = created.some((creation) => {
    if (!retired.some(({ receipt, call }) =>
      receipt.operation === "retire" && receipt.entityId === creation.receipt.entityId &&
      sameRpcOwner(creation.call, call) && creation.call.settlementOrder < call.admissionOrder
    )) return false;
    const writes = rpcGroups.flatMap(({ receipts }) => receipts
      .filter((receipt) => receipt.targetId === creation.receipt.targetId && receipt.method === "writeRows" && receipt.outcome === "fulfilled")
      .map((receipt) => ({ receipt })));
    const reads = rpcGroups.flatMap(({ call, receipts }) => receipts
      .filter((receipt) => receipt.targetId === creation.receipt.targetId && receipt.method === "readRows" && receipt.outcome === "fulfilled")
      .map((receipt) => ({ receipt, call })));
    return writes.some((write) => {
      const createdBeforeWrite = sameRpcOwner(creation.call, write.receipt) &&
        creation.call.settlementOrder < write.receipt.admissionOrder;
      const writeResult = write.receipt.result;
      if (!createdBeforeWrite || writeResult?.available !== true) return false;
      return reads.some((read) => {
        const writeBeforeRead = sameRpcOwner(write.receipt, read.receipt) &&
          write.receipt.settlementOrder < read.receipt.admissionOrder;
        const readResult = read.receipt.result;
        if (!writeBeforeRead || readResult?.available !== true) return false;
        const retiredAfterRead = retired.some(({ receipt, call }) =>
          receipt.operation === "retire" && receipt.entityId === creation.receipt.entityId &&
          sameRpcOwner(read.receipt, call) && read.receipt.settlementOrder < call.admissionOrder
        );
        if (!retiredAfterRead || writeResult.fingerprint !== readResult.fingerprint) return false;
        const returned = invocationReturnValue(read.call);
        if (!returned.present) return false;
        return observedRows([returned.value], new Set(["*"])).some((rows) => {
          const fingerprint = fingerprintEvalRpcValue(rows);
          return fingerprint.available && fingerprint.fingerprint === readResult.fingerprint;
        });
      });
    });
  });
  if (
    !preservedRows ||
    walkRecords(base.evidence.evalValues).some((record) => record["persisted"] === false)
  ) {
    return {
      passed: false,
      reason: "The later object call did not return rows matching the write result",
    };
  }
  return requireCleanup(base.evidence, result);
}

function requireDynamicWorkspaceServiceEvidence(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;

  const discovered = base.evidence.calls.some((call) => {
    if (call.name === "docs_search" || call.name === "docs_open") {
      return call.execution?.status === "complete" && call.execution.isError !== true;
    }
    if (call.name !== "eval" || call.execution?.status !== "complete") return false;
    return /docs\.(?:search|describe)\s*\(/u.test(String(call.arguments?.["code"] ?? ""));
  });
  if (!discovered) {
    return {
      passed: false,
      reason: "The agent did not consult the live caller-context service documentation",
    };
  }

  const repoName = result.diagnostics?.["workspaceRepoFixture"] &&
    typeof result.diagnostics["workspaceRepoFixture"] === "object" &&
    !Array.isArray(result.diagnostics["workspaceRepoFixture"])
    ? (result.diagnostics["workspaceRepoFixture"] as Record<string, unknown>)["repoName"]
    : undefined;
  if (
    typeof repoName !== "string" ||
    !resolvedServiceReceiverCallObserved(
      completedEvalJournalGroups(base.evidence.calls),
      `workers/${repoName}`,
      "FixtureWorkerDO"
    )
  ) {
    return {
      passed: false,
      reason: "No native receipt linked the resolved service target to its returned RPC result",
    };
  }

  const authored = base.evidence.calls.some((call) => {
    if (call.name === "workspace_service") {
      return (
        call.execution?.status === "complete" &&
        call.execution.isError !== true &&
        call.arguments?.["operation"] === "upsert"
      );
    }
    const serialized = JSON.stringify(call.arguments ?? {});
    return (
      /meta\/vibestudio\.yml/u.test(serialized) &&
      /services\s*:|singletonObjects\s*:/u.test(serialized)
    );
  });
  if (!authored) {
    return {
      passed: false,
      reason: "The trajectory did not author a service declaration in meta/vibestudio.yml",
    };
  }

  const staticCatalogWorkaround = base.evidence.calls.some((call) =>
    /(?:generated|AuthorityGrantCatalog|productAuthorityGrantCatalog|capability-catalog)/iu.test(
      JSON.stringify(call.arguments ?? {})
    )
  );
  return staticCatalogWorkaround
    ? {
        passed: false,
        reason: "The agent attempted to make workspace authority work through a static catalog",
      }
    : { passed: true, reason: undefined };
}

function requireInstalledWorkspaceServiceConsumerEvidence(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;

  const serializedCalls = base.evidence.calls.map((call) => JSON.stringify(call.arguments ?? {}));
  if (
    !base.evidence.calls.some(
      (call) =>
        (call.name === "docs_search" || call.name === "docs_open") &&
        call.execution?.status === "complete" &&
        call.execution.isError !== true
    ) &&
    !base.evidence.evalCode.match(/docs\.(?:search|describe)\s*\(/u)
  ) {
    return { passed: false, reason: "The agent did not consult live capability documentation" };
  }

  const manifestEdits = serializedCalls.filter((value) => /package\.json/u.test(value));
  if (!manifestEdits.some((value) => /workspace-service:[A-Za-z0-9._/-]+/u.test(value))) {
    return {
      passed: false,
      reason: "No installed-unit manifest edit declared an exact workspace service request",
    };
  }
  if (manifestEdits.some((value) => /workspace-service:\*/u.test(value))) {
    return {
      passed: false,
      reason: "Installed code requested the eval-only workspace service wildcard",
    };
  }
  if (!serializedCalls.some((value) => /index\.ts/u.test(value) && /resolveService/u.test(value))) {
    return { passed: false, reason: "The installed consumer did not resolve a live service" };
  }

  const createdHandles = [
    ...base.evidence.evalCode.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+(?:workers\.create|runtime\.createEntity)\s*\(/gu
    ),
  ].map((match) => match[1]!);
  const calledCreatedTarget = createdHandles.some((handle) => {
    const escaped = handle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(
      `\\brpc\\.call(?:<[^>]*>)?\\s*\\(\\s*${escaped}\\.(?:id|targetId)\\s*,`,
      "u"
    ).test(base.evidence.evalCode);
  });
  if (createdHandles.length === 0 || !calledCreatedTarget) {
    return {
      passed: false,
      reason: "The proof did not execute and call the context-built installed unit",
    };
  }
  const repoName = result.diagnostics?.["workspaceRepoFixture"] &&
    typeof result.diagnostics["workspaceRepoFixture"] === "object" &&
    !Array.isArray(result.diagnostics["workspaceRepoFixture"])
    ? (result.diagnostics["workspaceRepoFixture"] as Record<string, unknown>)["repoName"]
    : undefined;
  if (
    typeof repoName !== "string" ||
    !createdWorkerReceiverCallObserved(
      completedEvalJournalGroups(base.evidence.calls),
      `workers/${repoName}`,
      "worker",
      "consumeTestkitService"
    )
  ) {
    return {
      passed: false,
      reason: "The installed consumer call was not observed on its created worker target",
    };
  }
  if (!hasNonEmptyStructuredResult(base.evidence.evalValues)) {
    return {
      passed: false,
      reason: "The installed consumer returned no observable service result",
    };
  }
  const cleanup = requireCleanup(base.evidence, result);
  if (!cleanup.passed) return cleanup;

  if (
    serializedCalls.some((value) =>
      /(?:generated|AuthorityGrantCatalog|productAuthorityGrantCatalog|capability-catalog)/iu.test(
        value
      )
    )
  ) {
    return {
      passed: false,
      reason: "The agent tried to approve dynamic authority through a static catalog",
    };
  }
  return { passed: true, reason: undefined };
}

export const workerTests: TestCase[] = [
  {
    name: "list-sources",
    description: "List available worker types",
    category: "workers",
    prompt: "Which workers can I start here?",
    validate: (result) => {
      const base = lifecycleEvidence(result, [["workers.listSources"], ["build.listUnits"]]);
      if (!base.passed) return base;
      const returnedRows = walkArrays(base.evidence.evalValues).some((value) => value.length > 0);
      const loggedRows = base.evidence.calls.some((call) => {
        if (
          call.name !== "eval" ||
          call.execution?.status !== "complete" ||
          call.execution.isError === true ||
          !String(call.arguments?.["code"] ?? "").includes("workers.listSources")
        ) {
          return false;
        }
        const output = invocationConsoleOutput(call) ?? "";
        return (
          /\bsourcesCount\s+[1-9]\d*\b/u.test(output) || /"source"\s*:\s*"workers\//u.test(output)
        );
      });
      return returnedRows || loggedRows
        ? { passed: true, reason: undefined }
        : { passed: false, reason: "The completed source listing returned no source rows" };
    },
  },
  {
    name: "create-worker",
    description: "Create a worker instance",
    category: "workers",
    workspaceRepoFixture: BUILDABLE_REGULAR_WORKER_WORKSPACE_REPO_FIXTURE,
    prompt: "Temporarily start a worker, confirm that it exists, and leave no instance behind.",
    validate: (result) => {
      const base = lifecycleEvidence(result, [
        ["workers.create", "workers.destroy"],
        ["runtime.createEntity", "runtime.retireEntity"],
      ]);
      return base.passed ? requireCleanup(base.evidence, result) : base;
    },
  },
  {
    name: "list-workers",
    description: "List running worker instances",
    category: "workers",
    prompt: "Inspect the worker instances that are currently running and summarize what you found.",
    validate: (result) => {
      const base = lifecycleEvidence(result, [
        ["workers.list"],
        ["runtime.listEntities"],
        ["runtime.supervision.list"],
      ]);
      return base.passed && walkArrays(base.evidence.evalValues).length > 0
        ? { passed: true, reason: undefined }
        : base.passed
          ? { passed: false, reason: "The completed worker listing returned no array" }
          : base;
    },
  },
  {
    name: "create-destroy",
    description: "Create a worker and then destroy it",
    category: "workers",
    workspaceRepoFixture: BUILDABLE_REGULAR_WORKER_WORKSPACE_REPO_FIXTURE,
    prompt: "Check that a harmless temporary worker can be started successfully.",
    validate: (result) => {
      const base = lifecycleEvidence(result, [
        ["workers.create", "workers.list", "workers.destroy"],
        ["runtime.createEntity", "runtime.listEntities", "runtime.retireEntity"],
      ]);
      return base.passed ? requireCleanup(base.evidence, result) : base;
    },
  },
  {
    name: "call-do-method",
    description: "Call a method on a Durable Object worker",
    category: "workers",
    workspaceRepoFixture: BUILDABLE_WORKER_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Start the provided disposable Durable Object worker with a non-secret probe value, call its harmless probe method, report the observed result, and leave no instance behind.",
    validate: (result) => {
      const base = lifecycleEvidence(result, [
        ["workers.createDurableObject", "rpc.call", "workers.destroy"],
        ["runtime.createEntity", "rpc.call", "runtime.retireEntity"],
      ]);
      if (!base.passed) return base;
      const repoName = result.diagnostics?.["workspaceRepoFixture"] &&
        typeof result.diagnostics["workspaceRepoFixture"] === "object" &&
        !Array.isArray(result.diagnostics["workspaceRepoFixture"])
        ? (result.diagnostics["workspaceRepoFixture"] as Record<string, unknown>)["repoName"]
        : undefined;
      if (
        typeof repoName !== "string" ||
        !createdWorkerReceiverCallObserved(
          completedEvalJournalGroups(base.evidence.calls),
          `workers/${repoName}`,
          "do",
          "inspectProbe"
        )
      ) {
        return {
          passed: false,
          reason: "The probe call was not observed on the created object's receiver target",
        };
      }
      if (
        !walkRecords(base.evidence.evalValues).some(
          (value) => value["probe"] !== undefined && value["probe"] !== null
        )
      ) {
        return {
          passed: false,
          reason: "The completed object call returned no non-null probe value",
        };
      }
      return requireCleanup(base.evidence, result);
    },
  },
  {
    name: "worker-do-sql-persistence",
    description: "A Durable Object's own storage persists data across separate calls",
    category: "workers",
    workspaceRepoFixture: BUILDABLE_WORKER_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Check whether a tiny disposable Durable Object preserves a couple of stored rows into a later call.",
    validate: requireSqlPersistenceEvidence,
  },
  {
    name: "worker-env",
    description: "Create a worker with environment variables",
    category: "workers",
    workspaceRepoFixture: BUILDABLE_REGULAR_WORKER_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Run a disposable worker with a non-secret probe setting and tell me what the worker itself observes.",
    validate: (result) => {
      const base = lifecycleEvidence(result, [
        ["workers.create", "env", "workers.destroy"],
        ["runtime.createEntity", "env", "runtime.retireEntity"],
      ]);
      if (!base.passed) return base;
      const probeInvocation = base.evidence.calls.find((call) => {
        if (
          call.name !== "eval" ||
          call.execution?.status !== "complete" ||
          call.execution.isError === true
        ) {
          return false;
        }
        return observesWorkerProbeResult(
          String(call.arguments?.["code"] ?? "")
        );
      });
      if (!probeInvocation) {
        return { passed: false, reason: "The worker-side probe result was not observed" };
      }
      const returned = invocationReturnValue(probeInvocation);
      const logged = invocationConsoleOutput(probeInvocation)?.trim() ?? "";
      if (
        (!returned.present || !hasNonEmptyStructuredResult([returned.value])) &&
        logged.length === 0
      ) {
        return { passed: false, reason: "The worker-side probe returned no evidence" };
      }
      return requireCleanup(base.evidence, result);
    },
  },
  {
    name: "dynamic-workspace-service",
    description: "Author and consume a private RPC service in the task context",
    category: "workers",
    workspaceRepoFixture: BUILDABLE_WORKER_WORKSPACE_REPO_FIXTURE,
    authorityPolicy: ({ workspaceRepoFixture }) => {
      const repoName = workspaceRepoFixture?.repoName;
      if (!repoName) {
        throw new Error("dynamic-workspace-service requires a named worker fixture");
      }
      return {
        authority: [
          {
            ruleId: "consume-authored-fixture-service",
            capability: { kind: "prefix", prefix: "workspace-service:" },
            resource: {
              kind: "prefix",
              prefix: `do:workers/${repoName}:FixtureWorkerDO:`,
            },
            tier: "gated",
            decision: "once",
          },
        ],
      };
    },
    prompt:
      "Give the disposable worker in this task a small private context-local RPC service that reports a value, discover it the same way another workspace unit would, call it, and tell me what answered. Do not publish anything.",
    validate: requireDynamicWorkspaceServiceEvidence,
  },
  {
    name: "installed-workspace-service-consumer",
    description: "Installed workspace code consumes a context-local userland service",
    category: "workers",
    workspaceRepoFixture: BUILDABLE_REGULAR_WORKER_WORKSPACE_REPO_FIXTURE,
    authorityPolicy: {
      authority: [
        {
          ruleId: "consume-installed-testkit-service",
          capability: { kind: "exact", key: "workspace-service:testkit-driver" },
          resource: {
            kind: "exact",
            key: "do:workers/testkit-driver:TestkitDriverDO:workspace-testkit-driver",
          },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    prompt:
      "Have the disposable worker in this task consume the testkit workspace service already visible in its context through the normal installed-unit path, prove the result, and keep everything local.",
    validate: requireInstalledWorkspaceServiceConsumerEvidence,
  },
];
