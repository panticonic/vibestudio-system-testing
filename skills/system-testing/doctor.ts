/** Infrastructure checks consume real registry names; fixture execution belongs to the registry owner. */
import {modelSettingsRpcMethods} from "@workspace/model-catalog/rpc-contract";
import {mainRpcMethods} from "@vibestudio/service-schemas/mainRpc";
import {rpc,workers} from "@workspace/runtime";
import {SYSTEM_TEST_AGENT_MODEL,systemTestModelRoute} from "./config.js";
import {systemTestDoctorResultSchema,type SystemTestDoctorResult} from "@vibestudio/service-schemas/systemTestRunner";

/**
 * Say what to do about an unusable agent model, not only that it is unusable.
 *
 * A missing provider credential is the one doctor failure an operator is
 * expected to resolve themselves, and it is reached before any test can run —
 * so the check has to name the exact command rather than leave the remedy to
 * be rediscovered in the host's source.
 */
export function unusableModelDetail(unusable: {
  model: string;
  availability: string;
  detail?: string;
}): string {
  const provider = unusable.model.split(":")[0] ?? unusable.model;
  const connect =
    `connect it from the host CLI with \`vibestudio model connect ${provider}\`` +
    " (add `--manual` to print the authorization URL when this host has no browser)";
  if (unusable.detail === "no-credential") {
    return `model ${unusable.model} has no connected credential for provider "${provider}": ${connect}`;
  }
  if (unusable.detail === "credential-expired") {
    return `model ${unusable.model} has an expired credential for provider "${provider}" that cannot refresh: ${connect}`;
  }
  if (unusable.detail === "not-installed") {
    return `model ${unusable.model} is not installed on this host`;
  }
  return `model ${unusable.model} is not usable (${unusable.availability}${
    unusable.detail ? `: ${unusable.detail}` : ""
  })`;
}

export async function systemTestDoctor(
  expectedModel: string | null | undefined,
  catalogNames: readonly string[],
): Promise<SystemTestDoctorResult> {
  const primaryModel = expectedModel ?? SYSTEM_TEST_AGENT_MODEL;
  const checks: SystemTestDoctorResult["checks"] = [];
  const capture = async (
    name: string,
    operation: () => Promise<unknown>,
    detail: string,
  ) => {
    try {
      const data = await operation();
      checks.push({ name, ok: true, detail, data });
    } catch (error) {
      checks.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  checks.push({
    name: "test-catalog",
    ok: catalogNames.length > 0 && new Set(catalogNames).size === catalogNames.length && catalogNames.every(name => typeof name === "string" && name.length > 0),
    detail: `${catalogNames.length} tests discovered`,
  });
  await capture(
    "server",
    () => rpc.call("main", mainRpcMethods["auth.getConnectionInfo"], []),
    "server identity and workspace are reachable",
  );
  await capture(
    "system-testing-build",
    () =>
      rpc.call("main", mainRpcMethods["build.inspectBuildProvenance"], [
        "@workspace-skills/system-testing",
      ]),
    "system-testing package is importable",
  );
  await capture(
    "agent-worker",
    async () => {
      const units = await rpc.call("main", mainRpcMethods["build.listUnits"], []);
      const agentUnit = units.find(
        (unit) =>
          unit.name === "workers/agent-worker" ||
          unit.name.includes("agent-worker"),
      );
      if (!agentUnit) throw new Error("workers/agent-worker is not declared");
      if (agentUnit.status === "approval-required") {
        throw new Error("workers/agent-worker is awaiting source approval");
      }
      if (agentUnit.status === "error") {
        throw new Error(
          agentUnit.lastError || "workers/agent-worker is in error state",
        );
      }
      return agentUnit;
    },
    "agent worker source is declared and approved for on-demand activation",
  );
  await capture(
    "required-extensions",
    async () => {
      const [units, config] = await Promise.all([
        rpc.call("main", mainRpcMethods["build.listUnits"], []),
        rpc.call("main", mainRpcMethods["workspace.getConfig"], []),
      ]);
      const declared = (config.extensions ?? []).map(({ source }) => ({
        source,
        unit: units.find(
          (candidate) =>
            candidate.kind === "extension" && candidate.source === source,
        ),
      }));
      const unready = declared.flatMap(({ source, unit }) => {
        if (!unit) return [`${source}=missing`];
        return unit.status !== "approval-required" && unit.status !== "error"
          ? []
          : [
              `${unit.name}=${unit.status}${unit.lastError ? ` (${unit.lastError})` : ""}`,
            ];
      });
      if (unready.length > 0) {
        throw new Error(
          `declared workspace extensions are not ready: ${unready.join(
            ", ",
          )}. Complete the startup unit review before running agentic tests.`,
        );
      }
      return declared.map(({ source, unit }) => ({
        source,
        name: unit?.name,
        status: unit?.status,
      }));
    },
    "declared workspace extensions are approved and build-ready",
  );
  await capture(
    "workspace-configuration",
    async () => {
      const fileContent = await rpc.call(
        "main",
        mainRpcMethods["fs.readFile"],
        ["meta/vibestudio.yml", "utf8"],
      );
      const source =
        typeof fileContent === "string"
          ? fileContent
          : new TextDecoder("utf-8", { fatal: true }).decode(fileContent);
      return rpc.call("main", mainRpcMethods["workspace.validateConfig"], [
        {
          manifest: source,
          serviceManifests: {},
        },
      ]);
    },
    "the workspace has a valid standalone runtime configuration",
  );
  await capture(
    "model",
    async () => {
      const modelRoute = systemTestModelRoute(
        primaryModel,
        typeof expectedModel !== "string",
      );
      const service = await workers.resolveService(
        "vibestudio.models.v1",
        null,
      );
      if (service.kind !== "durable-object" || !service.targetId) {
        throw new Error(
          "vibestudio.models.v1 did not resolve to a Durable Object",
        );
      }
      const required = [
        modelRoute.primaryModel,
        ...(modelRoute.fallbackModel ? [modelRoute.fallbackModel] : []),
      ];
      const inspected = (await rpc.call(
        service.targetId,
        modelSettingsRpcMethods["inspectModels"],
        [required],
      )) as {
        models?: Array<{
          ref?: string;
          availability?: { state?: string; detail?: string };
        }>;
      };
      const availability = required.map((modelRef) => {
        const found = inspected.models?.find(
          (model) => model.ref === modelRef,
        )?.availability;
        return {
          model: modelRef,
          availability: found?.state ?? "unknown",
          ...(found?.detail ? { detail: found.detail } : {}),
        };
      });
      const unusable = availability.find(
        (entry) =>
          entry.availability !== "ready" && entry.availability !== "startable",
      );
      if (unusable) {
        throw new Error(unusableModelDetail(unusable));
      }
      return {
        primary: availability[0],
        usageLimitFallback:
          modelRoute.fallbackModel === null
            ? null
            : {
                ...availability[1],
                thinkingLevel: modelRoute.fallbackThinkingLevel,
                scope: modelRoute.fallbackScope,
              },
      };
    },
    "system-test agent models are configured and credentialed",
  );

  return systemTestDoctorResultSchema.parse({
    ok: checks.every((check) => check.ok),
    checks,
  });
}

