import { isDeepStrictEqual } from "node:util";
import { bindMobileScenario } from "../mobile-system-testing/bindings.js";
import type { MobileReport } from "../mobile-system-testing/scenario/types.js";
import type { MobileWorld } from "./worlds.js";

export function createMobileScenarioFixture(world: MobileWorld) {
  const operations: string[] = [];
  const bindings = bindMobileScenario(world.request, {
    async inventory() {
      operations.push("inventory");
      return structuredClone(world.inventory);
    },
    async pair(id, provider) {
      operations.push(`pair:${id}:${provider}`);
      return { ...world.pair };
    },
    async workspace(id) {
      operations.push(`workspace:${id}`);
      return { ...world.workspace };
    },
    async install(id, reset) {
      operations.push(`install:${id}:${reset}`);
      return { ...world.install };
    },
    async app(id, name) {
      operations.push(`app:${id}:${name}`);
      return { ...world.app, issues: [...world.app.issues] };
    },
  });
  return {
    bindings,
    verify(value: unknown) {
      const report = structuredClone(value) as MobileReport | null;
      const expected = world.expected;
      if (
        !report ||
        report.status !== expected.status ||
        report.deviceId !== expected.deviceId ||
        !isDeepStrictEqual(operations, expected.operations)
      )
        return false;
      if (report.status === "paired-ready")
        return (
          isDeepStrictEqual(report.receipt, world.pair) &&
          isDeepStrictEqual(report.readback, world.workspace)
        );
      if (report.status === "development-ready")
        return (
          isDeepStrictEqual(report.receipt, world.install) &&
          isDeepStrictEqual(report.readback, world.app)
        );
      if (report.status === "blocked") {
        if (
          report.blocker !== expected.blocker ||
          typeof report.next !== "string" ||
          !report.next.trim()
        )
          return false;
        if (
          report.blocker === "workspace-opening" ||
          report.blocker === "workspace-failed"
        )
          return report.next.includes(world.workspace.message);
        if (report.blocker === "app-unverified")
          return world.app.issues.every((issue) => report.next.includes(issue));
      }
      return true;
    },
  };
}
