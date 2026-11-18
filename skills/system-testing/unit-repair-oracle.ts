import { createUnitRepair } from "@workspace/natlang-services";
export { createUnitRepair };
export { verifyUnit } from "@workspace/harness/unit-verification";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { expectedBuildUnitName } from "@vibestudio/workspace-contracts/sourceDirs";

import { workerRepairWorlds } from "./unit-repair-worlds.js";

export type UnitRepairFault =
  | "type-mismatch"
  | "missing-helper"
  | (typeof workerRepairWorlds)[number]["id"];

function workerTests(
  name: string,
  assertions: readonly (readonly [string, string])[],
) {
  return `import { describe, it, expect } from "@workspace/test-runtime";
import { rpc } from "@workspace/runtime";
import { ${name} } from "./index.js";

describe("assigned worker contract", () => {
  it("uses the actual injected runtime", () => { expect(typeof rpc.call).toBe("function"); });
${assertions.map(([description, code]) => `  it(${JSON.stringify(description)}, () => { ${code}; });`).join("\n")}
});
`;
}

export function unitRepairSeedFiles(repoName: string, fault: UnitRepairFault) {
  const world = workerRepairWorlds.find(({ id }) => id === fault);
  const failedSource =
    world?.source ??
    (fault === "type-mismatch"
      ? `export function normalizeLabels(values: string[]): string[] {
  return values.map(value => {
    const trimmed: number = value.trim();
    return trimmed;
  });
}`
      : `import { trimLabel } from "./removed-helper.js";
export function normalizeLabels(values: string[]): string[] {
  return values.map(trimLabel);
}`);
  return [
    {
      path: "package.json",
      content:
        JSON.stringify(
          {
            name: expectedBuildUnitName(`workers/${repoName}`),
            version: "0.0.0",
            private: true,
            type: "module",
            vibestudio: {
              title: world
                ? "Worker repair fixture"
                : "Label normalizer fixture",
              kind: "worker",
              entry: "index.ts",
              authority: { requests: [], serviceRequests: [], provides: [] },
              tests: [
                { name: "unit", runtime: "workerd", include: ["**/*.test.ts"] },
              ],
            },
            dependencies: {
              "@workspace/test-runtime": "workspace:*",
              "@workspace/runtime": "workspace:*",
            },
          },
          null,
          2,
        ) + "\n",
    },
    {
      path: "index.ts",
      content: `${failedSource}
export default { fetch() { return new Response(${JSON.stringify(world ? "Worker repair fixture" : "Label normalizer")}); } };
`,
    },
    {
      path: "index.test.ts",
      content: world
        ? workerTests(world.name, world.assertions)
        : `import { describe, it, expect } from "@workspace/test-runtime";
import { rpc } from "@workspace/runtime";
import { normalizeLabels } from "./index.js";

describe("normalize user labels in the complete worker runtime", () => {
  it("uses the actual injected runtime", () => { expect(typeof rpc.call).toBe("function"); });
  it("trims and removes blank values", () => { expect(normalizeLabels([" team ", "", "  ", "inbox"])).toEqual(["team", "inbox"]); });
  it("deduplicates ignoring case while preserving first spelling and order", () => { expect(normalizeLabels([" Urgent ", "urgent", "TEAM", " team ", "follow up"])).toEqual(["Urgent", "TEAM", "follow up"]); });
  it("keeps the caller's input unchanged", () => { const input=[" A ", "a"]; normalizeLabels(input); expect(input).toEqual([" A ","a"]); });
  it("handles an empty collection", () => { expect(normalizeLabels([])).toEqual([]); });
});
`,
    },
  ];
}

type Oracle = ReturnType<typeof createUnitRepair>;
type BuildObservation = Awaited<ReturnType<Oracle["unitRepair"]["observe"]>>;
type ProtectedSource = Awaited<ReturnType<Oracle["unitRepair"]["readSource"]>>;

/** Rebuild and run the retained original workerd suite independently after the authored root settles. */
export async function verifyUnitRepairOutcome(
  oracle: Oracle,
  baseline: BuildObservation,
  protectedPaths: string[],
  protectedBefore: ProtectedSource,
) {
  const candidate = await oracle.unitRepair.observe();
  const protectedAfter = await oracle.unitRepair.readSource(
    candidate.revision,
    protectedPaths,
  );
  let evidence = candidate;
  let executionError: string | null = null;
  if (candidate.build.status === "ok") {
    try {
      evidence = await oracle.unitRepairEdit.test(candidate.revision);
    } catch (error) {
      executionError = error instanceof Error ? error.message : String(error);
    }
  }
  const tests = evidence.tests;
  const manifestAndTests = (files: ProtectedSource) =>
    files.map((file) => ({
      path: file.path,
      sha256: sha256HexSyncText(file.text),
    }));
  const protectedSource = {
    before: manifestAndTests(protectedBefore),
    after: manifestAndTests(protectedAfter),
  };
  const checks = {
    changedRevision: evidence.revision !== baseline.revision,
    sourceBuild:
      candidate.build.status === "ok" &&
      !candidate.build.diagnostics.some((d) => d.severity === "error"),
    originalManifestAndTests:
      JSON.stringify(protectedSource.after) ===
      JSON.stringify(protectedSource.before),
    originalWorkerdSuite:
      tests?.status === "passed" &&
      tests.report.total === 5 &&
      tests.report.failed === 0 &&
      tests.report.passed === 5 &&
      tests.truncatedFiles === 0 &&
      tests.truncatedErrors === 0,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    evidence: { ...evidence, protectedSource, executionError },
  };
}
