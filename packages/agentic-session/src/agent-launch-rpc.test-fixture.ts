import { durableObjectServiceFixture } from "@vibestudio/service-schemas/test-utils";

export const MODEL_SETTINGS_TARGET =
  "do:workers/model-settings:ModelSettingsDO:workspace";

type FixtureResult =
  | { handled: false }
  | { handled: true; value: unknown };

function methodName(method: unknown): string {
  if (typeof method === "string") return method;
  if (
    method !== null &&
    typeof method === "object" &&
    "name" in method &&
    typeof method.name === "string"
  ) {
    return method.name;
  }
  return String(method);
}

/**
 * Handle the workspace model-settings calls that precede every agent launch.
 *
 * The fixture deliberately recognizes exact target/method pairs and validates
 * their arguments. Callers must handle every other RPC explicitly so a new
 * lifecycle step cannot silently pass through a permissive mock.
 */
export function workspaceAgentConfigRpcFixture(
  target: string,
  method: unknown,
  args: unknown[],
): FixtureResult {
  const name = methodName(method);
  if (
    target === "main" &&
    name === "workers.resolveService" &&
    args[0] === "vibestudio.models.v1"
  ) {
    if (args.length !== 2 || args[1] !== null) {
      throw new Error(
        `Unexpected model-settings resolution arguments: ${JSON.stringify(args)}`,
      );
    }
    return {
      handled: true,
      value: durableObjectServiceFixture(MODEL_SETTINGS_TARGET, {
        source: "workers/model-settings",
        name: "model settings",
        protocols: ["vibestudio.models.v1"],
        className: "ModelSettingsDO",
        objectKey: "workspace",
      }),
    };
  }
  if (target === MODEL_SETTINGS_TARGET && name === "getSettings") {
    if (args.length !== 0) {
      throw new Error(
        `Unexpected model-settings read arguments: ${JSON.stringify(args)}`,
      );
    }
    return { handled: true, value: { defaultAgentConfig: {} } };
  }
  return { handled: false };
}
