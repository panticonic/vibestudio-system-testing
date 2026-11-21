import {
  sha256HexSyncText,
  stableSha256Hex,
} from "@vibestudio/content-addressing";
import {
  canonicalTemplateYaml,
  parseTemplateManifestContent,
  templateRepositories,
} from "@vibestudio/workspace/templateManifest";
import {
  mergeTemplateManifests,
  templateRepositoryOwners,
} from "@vibestudio/workspace/templateManifestMerge";
import { composeTemplateLayers } from "@vibestudio/workspace/templateComposition";
import { resolveTemplateClosure } from "@vibestudio/workspace/templateClosure";
import type { ExamplesAdoptionWorld } from "./open-goal-examples-adoption-worlds.js";

const rootManifest = "meta/vibestudio.yml";
const base = "https://fixtures.invalid/examples-adoption/base.git";
const examples = "https://fixtures.invalid/examples-adoption/examples.git";
const names = new Map([
  [base, "Base"],
  [examples, "Examples"],
]);
const text = new TextEncoder();
type Layer = { source: string; epoch: number; files: Record<string, string> };
export type AdoptionCompositionStatus =
  | "composed"
  | "conflict"
  | "bad-override"
  | "epoch"
  | "missing-unit"
  | "duplicate-source";

function packageFile(name: string, dependencies: string[] = []) {
  return JSON.stringify({
    name,
    version: "0.1.0",
    dependencies: Object.fromEntries(
      dependencies.map((dependency) => [dependency, "workspace:*"]),
    ),
  });
}

/** Minimal local source inputs. A fixture cannot choose the native composition result. */
export function adoptionReviewLayers(
  world: ExamplesAdoptionWorld,
  epoch: number,
  installedName: string,
): Layer[] {
  const { mode, unit } = world;
  const ownsParent = ["replace", "unclaimed", "wrong-owner", "parent"].includes(
    mode,
  );
  const replaces = mode === "replace" || mode === "wrong-owner";
  const lower: Record<string, unknown> = {};
  const upper: Record<string, unknown> = {};
  if (mode === "settings") {
    lower.defaultAgentConfig = {
      model: "openai-codex:gpt-6.1-sol",
      thinkingLevel: "low",
    };
    upper.defaultAgentConfig = { thinkingLevel: "medium" };
  }
  if (mode === "floor") {
    lower.minimumAppVersion = "0.1.120";
    upper.minimumAppVersion = "0.1.89";
  }
  if (mode === "duplicate") {
    lower.clients = upper.clients = [{ source: "clients/demo-rehearsal" }];
  }
  const baseFiles = {
    [rootManifest]: canonicalTemplateYaml({
      systemEpoch: epoch,
      ...lower,
      template: { name: "Base" },
    }),
    ...(ownsParent
      ? {
          [unit + "/package.json"]: packageFile(installedName),
          [unit + "/review-parent.ts"]:
            "export const origin = 'base review';\n",
        }
      : {}),
  };
  const topEpoch = mode === "epoch" ? epoch + 1 : epoch;
  const heldFiles = {
    [rootManifest]: canonicalTemplateYaml({
      systemEpoch: topEpoch,
      ...upper,
      template: {
        name: "Examples",
        dependencies: [{ url: base }],
        ...(replaces
          ? {
              overrides: [
                {
                  repoPath: unit,
                  source:
                    mode === "wrong-owner"
                      ? "https://fixtures.invalid/other-template.git"
                      : base,
                },
              ],
            }
          : {}),
      },
    }),
    ...(mode !== "parent"
      ? {
          [unit + "/package.json"]: packageFile(
            installedName,
            mode === "missing"
              ? ["@workspace/retired-demo-helper"]
              : mode === "transitive"
                ? ["@workspace/review-adapter"]
                : [],
          ),
          [unit + "/review-candidate.ts"]:
            "export const origin = 'examples review';\n",
        }
      : {}),
    ...(mode === "transitive"
      ? {
          "packages/review-adapter/package.json": packageFile(
            "@workspace/review-adapter",
            ["@workspace/review-types"],
          ),
          "packages/review-types/package.json": packageFile(
            "@workspace/review-types",
          ),
        }
      : {}),
  };
  return [
    { source: base, epoch, files: baseFiles },
    { source: examples, epoch: topEpoch, files: heldFiles },
  ];
}

function nativeIssue(error: unknown): {
  status: Exclude<AdoptionCompositionStatus, "composed">;
  issue: string;
} {
  if (!(error instanceof Error)) throw error;
  const { message } = error;
  const reason = [
    ["Composed templates both declare repository ", "conflict"],
    ["Invalid override ", "bad-override"],
    ["Composed templates disagree about the workspace system epoch:", "epoch"],
    ["No owned package ", "missing-unit"],
    ["Composed templates both declare source ", "duplicate-source"],
  ] as const;
  const found = reason.find(([prefix]) => message.startsWith(prefix));
  if (!found) throw error;
  return { status: found[1], issue: message };
}

export function evaluateAdoption(unit: string, layers: Layer[]) {
  const inputs = layers.map((layer) => ({
    label: layer.source,
    repositories: templateRepositories(Object.keys(layer.files)),
    manifest: parseTemplateManifestContent(
      layer.files[rootManifest]!,
      layer.epoch,
    ),
  }));
  try {
    const owners = templateRepositoryOwners(inputs);
    const manifest = mergeTemplateManifests(inputs).document;
    const composed = composeTemplateLayers({
      composedPaths: [rootManifest],
      layers: layers.map((layer) => ({
        label: layer.source,
        files: Object.entries(layer.files)
          .filter(([file]) =>
            [...owners].some(
              ([repoPath, owner]) =>
                owner.label === layer.source && file.startsWith(repoPath + "/"),
            ),
          )
          .map(([path, source]) => ({
            path,
            size: text.encode(source).byteLength,
            contentHash: sha256HexSyncText(source),
            mode: 0o644 as const,
          })),
        readFile: (file) =>
          layer.files[file] === undefined
            ? null
            : text.encode(layer.files[file]),
      })),
    });
    const packages = new Map(
      [...owners.keys()]
        .filter((path) => path !== "meta")
        .flatMap((path) => {
          const data = composed.readFile(path + "/package.json");
          return data
            ? [
                [
                  path,
                  JSON.parse(
                    new TextDecoder("utf-8", { fatal: true }).decode(data),
                  ) as { name: string; dependencies?: Record<string, string> },
                ] as const,
              ]
            : [];
        }),
    );
    const closure = resolveTemplateClosure({
      roots: [unit],
      packageDependenciesOf: (path) =>
        Object.keys(packages.get(path)?.dependencies ?? {}),
      ownerOfPackage: (name, dependent) => {
        const matching = [...packages].filter(([, pkg]) => pkg.name === name);
        if (matching.length !== 1)
          throw new Error("No owned package " + name + " for " + dependent);
        return matching[0]![0];
      },
    });
    const selected = [...composed.files].filter((file) =>
      closure.included.some((path) => file.path.startsWith(path + "/")),
    );
    const privateFiles = selected.map((file) => file.path);
    const readFiles = selected.map((file) => {
      const bytes = composed.readFile(file.path);
      if (
        !bytes ||
        sha256HexSyncText(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ) !== file.contentHash
      )
        throw new Error("Missing exact composed source " + file.path);
      return file;
    });
    const agent = manifest.defaultAgentConfig as
      | Record<string, unknown>
      | undefined;
    const settings = Object.entries(agent ?? {})
      .map(([key, value]) => "defaultAgentConfig." + key + "=" + String(value))
      .sort();
    const owner = names.get(owners.get(unit)?.label ?? "") ?? null;
    if (!owner) throw new Error("The owned composition lost its declared root");
    return {
      status: "composed" as const,
      issue: null,
      owner,
      privateFiles,
      settings,
      pulledUnits: closure.required,
      minimumAppVersion:
        typeof manifest.minimumAppVersion === "string"
          ? manifest.minimumAppVersion
          : null,
      digest: stableSha256Hex({ manifest, owner, source: readFiles }),
    };
  } catch (error) {
    return {
      ...nativeIssue(error),
      owner: null,
      privateFiles: [],
      settings: [],
      pulledUnits: [],
      minimumAppVersion: null,
      digest: null,
    };
  }
}
