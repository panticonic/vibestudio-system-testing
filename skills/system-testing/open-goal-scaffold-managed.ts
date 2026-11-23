import type { InvocationObservations } from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import {
  sha256HexSyncText,
  stableSha256Hex,
} from "@vibestudio/content-addressing";
import { CURRENT_HOST_ABI } from "@vibestudio/workspace-contracts/clients";
import { contextId, vcs } from "@workspace/runtime";
import type {
  prepareProjects,
  preflightProjectFiles,
  PrepareProjectParams,
} from "@workspace-skills/workspace-dev";
import type {
  ScaffoldKind,
  ScaffoldWorld,
} from "./open-goal-scaffold-worlds.js";

type Installed = {
  prepareProjects: typeof prepareProjects;
  preflightProjectFiles: typeof preflightProjectFiles;
};
type Ports = {
  contextId: string | null;
  vcs: Pick<
    typeof vcs,
    "status" | "resolveRepository" | "listFiles" | "readFile"
  >;
};
type State = Awaited<ReturnType<typeof vcs.status>>["workingHead"];
type Plan = {
  disposition: ScaffoldWorld["disposition"];
  kinds: ScaffoldKind[];
  finding: string;
};
type Journal = {
  service: string;
  method: string;
  args: unknown[];
  result: unknown;
};
const kinds: ScaffoldKind[] = [
  "react",
  "react-site",
  "svelte",
  "svelte-site",
  "stateless",
  "agentic",
  "package",
  "skill",
  "content",
  "web-client",
  "terminal-client",
  "native-client",
];
const typeOf = {
  react: "panel",
  "react-site": "panel",
  svelte: "panel",
  "svelte-site": "panel",
  stateless: "worker",
  agentic: "worker",
  package: "package",
  skill: "skill",
  content: "project",
  "web-client": "client",
  "terminal-client": "client",
  "native-client": "client",
} as const;
const read = "scaffoldRead";
const write = "scaffoldPrepare";
const scope = "owned-scaffold-draft";

function parameters(
  kind: ScaffoldKind,
  name: string,
  title: string,
): PrepareProjectParams {
  const empty = { requests: [], provides: [] };
  const base = { name, title };
  switch (kind) {
    case "react":
    case "react-site":
    case "svelte":
    case "svelte-site":
      return {
        ...base,
        projectType: "panel",
        authority: empty,
        authorityReason:
          "The draft contains a local starter without downstream workspace calls.",
        ...(kind.startsWith("svelte") ? { template: "svelte" } : {}),
        ...(kind.endsWith("-site") ? { website: true } : {}),
      };
    case "stateless":
    case "agentic":
      return {
        ...base,
        projectType: "worker",
        authority: empty,
        authorityReason:
          "Only authority intrinsic to the selected generated starter is in scope.",
        ...(kind === "agentic" ? { template: "agentic" } : {}),
      };
    case "web-client":
      return { ...base, projectType: "client", runtime: CURRENT_HOST_ABI.web };
    case "terminal-client":
      return {
        ...base,
        projectType: "client",
        runtime: CURRENT_HOST_ABI.terminal,
      };
    case "native-client":
      return {
        ...base,
        projectType: "client",
        runtime: CURRENT_HOST_ABI["react-native"],
      };
    case "package":
    case "skill":
      return { ...base, projectType: kind };
    case "content":
      return { ...base, projectType: "project" };
  }
}

export async function prepareOpenScaffold(
  input: { contextId: string; caseId: string },
  world: ScaffoldWorld,
  installed: Installed,
  ports: Ports = { contextId, vcs },
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("Scaffold brief belongs to another context");
  const before = await ports.vcs.status({ contextId: input.contextId });
  const initial = before.workingHead;
  const ref = stableSha256Hex(initial);
  const key = crypto.randomUUID();
  const names = Array.from(
    { length: world.kinds.length },
    (_, index) =>
      world.occupied ?? "starter-" + key.slice(0, 12) + "-" + (index + 1),
  );
  const card = {
    id: key,
    label: world.label,
    names,
    event: ref,
    edition: "owned" as const,
    permission: world.canDraft ? ("draft" as const) : ("read-only" as const),
  };
  const archive = {
    ...card,
    id: crypto.randomUUID(),
    label: world.label + " archived",
    edition: "archived" as const,
    permission: "read-only" as const,
  };
  const journal: Journal[] = [];
  const keep = <T>(
    service: string,
    method: string,
    args: unknown[],
    result: T,
  ): T => {
    journal.push({
      service,
      method,
      args: structuredClone(args),
      result: structuredClone(result),
    });
    return result;
  };
  const assigned = (id: string) => {
    if (id !== key) throw new Error("Read only the owned scaffold brief");
  };
  const status = async () => {
    const value = await ports.vcs.status({ contextId: input.contextId });
    if (value.mainEventId !== before.mainEventId)
      throw new Error("Scaffold crossed protected main");
    return value;
  };
  const resolve = (state: State, repoPath: string) =>
    ports.vcs.resolveRepository({ state, repoPath });
  async function optionsFor(state: State) {
    const repository = await resolve(state, "templates/svelte");
    const framework = await resolve(state, "packages/svelte");
    const svelteManifest =
      repository &&
      framework &&
      (await ports.vcs.readFile({
        state,
        repositoryId: repository.repositoryId,
        file: { kind: "path", path: "template.json" },
      }));
    const frameworkManifest =
      framework &&
      (await ports.vcs.readFile({
        state,
        repositoryId: framework.repositoryId,
        file: { kind: "path", path: "package.json" },
      }));
    const svelteSource =
      svelteManifest?.content.kind === "text" &&
      frameworkManifest?.content.kind === "text" &&
      JSON.parse(svelteManifest.content.text).framework === "svelte" &&
      JSON.parse(frameworkManifest.content.text).name === "@workspace/svelte"
        ? svelteManifest.contentHash
        : null;
    const available = kinds.filter(
      (kind) => svelteSource || !kind.startsWith("svelte"),
    );
    const targets = [
      ...new Set(
        names.flatMap((name) =>
          Object.values(typeOf).map((type) => type + "s/" + name),
        ),
      ),
    ];
    const checks = await Promise.all(
      targets.map(
        async (target) => (await resolve(state, target))?.repoPath ?? null,
      ),
    );
    return {
      id: key,
      available,
      occupied: checks.filter((target) => target !== null).sort(),
      svelteSource,
      protectedMain: before.mainEventId,
    };
  }
  let options: Awaited<ReturnType<typeof optionsFor>> | undefined;
  let retained: Awaited<ReturnType<Installed["prepareProjects"]>> | null = null;
  let selected: ScaffoldKind[] | null = null;
  let after: State | null = null;

  async function inspectUnit(
    state: State,
    choice: ScaffoldKind,
    index: number,
  ) {
    const name = names[index]!;
    const projectType = typeOf[choice];
    const target = projectType + "s/" + name;
    const repository = await resolve(state, target);
    if (!repository || repository.repoPath !== target)
      throw new Error("No retained scaffold at the exact owned path " + target);
    const listed = await ports.vcs.listFiles({
      state,
      repositoryId: repository.repositoryId,
      limit: 80,
    });
    if (
      listed.repositoryId !== repository.repositoryId ||
      listed.nextCursor ||
      !isDeepStrictEqual(listed.state, state)
    )
      throw new Error("Incomplete retained scaffold inventory");
    let manifestDigest: string | null = null;
    const files = Object.fromEntries(
      await Promise.all(
        listed.files.map(async (item) => {
          const observed = await ports.vcs.readFile({
            state,
            repositoryId: repository.repositoryId,
            file: { kind: "id", fileId: item.fileId },
          });
          if (
            observed?.path !== item.path ||
            observed.content.kind !== "text" ||
            observed.contentHash !== item.contentHash ||
            sha256HexSyncText(observed.content.text) !== item.contentHash
          )
            throw new Error("Retained scaffold source hash mismatch");
          if (item.path === "package.json") manifestDigest = item.contentHash;
          return [item.path, observed.content.text];
        }),
      ),
    );
    const manifest = files["package.json"]
      ? JSON.parse(files["package.json"])
      : {};
    const metadata = manifest.vibestudio ?? {};
    const preflight = installed.preflightProjectFiles({
      projectType,
      name,
      files,
    });
    const nativeTests = (metadata.tests ?? [])
      .flatMap((suite: { runtime?: string; include?: string[] }) =>
        suite.runtime === "native" ? (suite.include ?? []) : [],
      )
      .sort() as string[];
    return {
      target,
      kind: choice,
      files: Object.keys(files).sort(),
      manifestDigest,
      entry: preflight.entry,
      portableEntry:
        typeof metadata.website?.entry === "string"
          ? (metadata.website.entry as string)
          : null,
      hostAbi:
        typeof metadata.client?.hostAbi === "string"
          ? (metadata.client.hostAbi as string)
          : null,
      authority: (metadata.authority?.requests ?? [])
        .map((request: { capability: string }) => request.capability)
        .sort() as string[],
      nativeTests,
      preflight,
      manifest,
    };
  }
  type Unit = Omit<
    Awaited<ReturnType<typeof inspectUnit>>,
    "preflight" | "manifest"
  >;
  type Receipt = {
    commandId: string;
    draft: string;
    publication: "unchanged";
    runtime: "unchanged";
    units: Unit[];
  };
  function projection({
    preflight,
    manifest,
    ...unit
  }: Awaited<ReturnType<typeof inspectUnit>>): Unit {
    return unit;
  }
  let receipt: Receipt | null = null;
  async function units() {
    return after && selected
      ? await Promise.all(
          selected.map((kind, index) => inspectUnit(after!, kind, index)),
        )
      : [];
  }
  const services = {
    scaffoldRead: {
      async discover() {
        return keep(read, "discover", [], [card, archive]);
      },
      async options(id: string) {
        assigned(id);
        options = await optionsFor(initial);
        return keep(read, "options", [id], options);
      },
      async readback(id: string, draft: string | null) {
        assigned(id);
        if (draft !== (receipt?.draft ?? null))
          throw new Error("Read back only the assigned scaffold draft");
        const end = await status();
        return keep(read, "readback", [id, draft], {
          main: end.mainEventId,
          draft: stableSha256Hex(end.workingHead),
          units: (await units()).map(projection),
        });
      },
    },
    scaffoldPrepare: {
      async prepare(id: string, event: string, choices: ScaffoldKind[]) {
        assigned(id);
        const targets = choices.map(
          (kind, index) => typeOf[kind] + "s/" + names[index],
        );
        if (
          retained ||
          !options ||
          event !== ref ||
          card.permission !== "draft" ||
          choices.length !== names.length ||
          choices.some((kind) => !options!.available.includes(kind)) ||
          targets.some((target) => options!.occupied.includes(target)) ||
          !isDeepStrictEqual((await status()).workingHead, initial)
        )
          return keep(write, "prepare", [id, event, choices], null);
        const commandId = "scaffold-review:" + key;
        retained = await installed.prepareProjects(
          choices.map((kind, index) =>
            parameters(kind, names[index]!, world.label),
          ),
          { commandId, expectedWorkingHead: initial },
        );
        after = (await status()).workingHead;
        if (
          isDeepStrictEqual(after, initial) ||
          retained.length !== targets.length ||
          retained.some(
            (unit, index) =>
              unit.created !== targets[index] ||
              unit.preparation.protocol !== "project-preparation.v1" ||
              unit.preparation.command.commandId !== commandId ||
              unit.preparation.command.contextId !== input.contextId ||
              !isDeepStrictEqual(unit.preparation.workingHead, after) ||
              unit.preparation.publication !== "unchanged" ||
              unit.preparation.liveRuntime !== "unchanged",
          )
        )
          throw new Error(
            "Native preparation did not retain the exact owned draft",
          );
        selected = [...choices];
        receipt = {
          commandId,
          draft: stableSha256Hex(after),
          publication: "unchanged",
          runtime: "unchanged",
          units: (await units()).map(projection),
        };
        return keep(write, "prepare", [id, event, choices], receipt);
      },
    },
  };
  type Readback = Awaited<ReturnType<typeof services.scaffoldRead.readback>>;

  async function verify(value: unknown, observations?: InvocationObservations) {
    const result = value as Receipt | {disposition:string;finding:string} | null;
    const final = await status();
    const current = await optionsFor(initial);
    const actual = await units();
    const draft = journal.findLast(row => row.service === write && row.method === "prepare");
    const disposition = result && "disposition" in result ? result : null;
    const readback = journal.find((row) => row.method === "readback")
      ?.result as Readback | undefined;
    const staging = world.disposition === "prepare";
    const exact = (
      service: string,
      method: string,
      args: unknown[],
      result: unknown,
    ) => {
      const rows = journal.filter(
        (row) => row.service === service && row.method === method,
      );
      return (
        rows.some(row => isDeepStrictEqual(row.args, args) && isDeepStrictEqual(row.result, result))
      );
    };
    const checks = {
      returnedScaffoldValue: staging ? !!receipt && isDeepStrictEqual(result,receipt) :
        disposition?.disposition === world.disposition && !!disposition.finding?.trim(),
      scopedOwnedScaffoldBrief: Boolean(

        exact(read, "discover", [], [card, archive]),
      ),
      observedInstalledScaffoldChoices: Boolean(

        exact(read, "options", [key], current) &&
        current.protectedMain === before.mainEventId &&
        (world.workspace === "examples") === Boolean(current.svelteSource) &&
        (world.occupied
          ? current.occupied.includes(
              typeOf[world.kinds[0]!] + "s/" + world.occupied,
            )
          : !current.occupied.length),
      ),
      selectedOutcomeAppropriateStarter: staging ? !!draft&&isDeepStrictEqual(draft.args[2],world.kinds) : true,
      exactNativeScaffoldDraft: Boolean(

        (staging
          ? receipt &&
            retained &&
            actual.length === world.kinds.length &&
            isDeepStrictEqual(receipt.units, actual.map(projection)) &&
            actual.every((unit, i) => {
              const prepared = retained![i]!;
              return (
                unit.kind === world.kinds[i] &&
                isDeepStrictEqual(unit.files, [...prepared.files].sort()) &&
                isDeepStrictEqual(unit.preflight, prepared.preflight) &&
                Boolean(unit.portableEntry) === unit.kind.endsWith("-site") &&
                (unit.kind === "agentic"
                  ? unit.nativeTests.length === 1 &&
                    unit.authority.includes("workspace-service:models")
                  : !unit.nativeTests.length) &&
                (unit.kind === "native-client"
                  ? unit.hostAbi === CURRENT_HOST_ABI["react-native"] &&
                    unit.files.includes("App.tsx") &&
                    unit.authority.includes("context.boundary")
                  : true) &&
                (unit.kind === "web-client"
                  ? unit.hostAbi === CURRENT_HOST_ABI.web &&
                    unit.files.includes("index.html")
                  : true) &&
                (unit.kind === "terminal-client"
                  ? unit.hostAbi === CURRENT_HOST_ABI.terminal &&
                    unit.files.includes("src/index.ts")
                  : true) &&
                (unit.kind === "stateless"
                  ? unit.manifest.vibestudio.durable === undefined &&
                    !unit.authority.length
                  : true) &&
                (unit.kind === "package" || unit.kind === "skill"
                  ? unit.manifest.exports?.["."] === "./index.ts"
                  : true) &&
                (unit.kind === "content"
                  ? unit.manifestDigest === null &&
                    unit.files.includes("README.md")
                  : Boolean(unit.manifestDigest)) &&
                (unit.kind === "skill" ? unit.files.includes("SKILL.md") : true)
              );
            }) &&
            exact(write, "prepare", [key, ref, world.kinds], receipt)
          : !receipt &&
            !actual.length &&
            !retained &&
            journal.every((row) => row.service !== write)),
      ),
      independentVcsReadbackAndMain: Boolean(
        readback &&
        exact(read, "readback", [key, receipt?.draft ?? null], readback) &&
        readback.main === before.mainEventId &&
        readback.draft === stableSha256Hex(final.workingHead) &&
        isDeepStrictEqual(readback.units, actual.map(projection)) &&
        (staging
          ? isDeepStrictEqual(after, final.workingHead)
          : isDeepStrictEqual(initial, final.workingHead)),
      ),
    };
    return {
      outcomeContract: {
        effects: {checks:["scopedOwnedScaffoldBrief", "observedInstalledScaffoldChoices", "selectedOutcomeAppropriateStarter", "exactNativeScaffoldDraft", "independentVcsReadbackAndMain"],rationale:"The owned native draft and its persisted units establish preparation."},
        returnedValue: {checks:["returnedScaffoldValue"],required:!staging,rationale:"Advice-only goals require the scaffold finding; a returned draft handle is optional when the draft exists."},
        incidentalValues: {checks:[],rationale:"A known incorrect emitted application value is excluded using the actual root definition."},
      },
      incorrectReturnValues: result!==undefined&&!(checks.returnedScaffoldValue) ? [{
        required:!staging,definition:observations?.calls.find(call=>call.parentCallId===null)?.definition??{name:"prepareOwnedScaffold",source:"prepareOwnedScaffold.nl"},value:result,
      }] : [],
      contextId: input.contextId,
      caseId: world.id,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      card,
      options: current,
      receipt,
      readback,
      journal: structuredClone(journal),
    };
  }
  async function qualify() {
    await services.scaffoldRead.discover();
    let denied = false;
    try {
      await services.scaffoldRead.options(archive.id);
    } catch {
      denied = true;
    }
    const inventory = await services.scaffoldRead.options(key);
    const plan: Plan = {
      disposition: world.disposition,
      kinds: [...world.kinds],
      finding: "Use the exact installed scaffold and owned draft scope.",
    };
    const staged =
      world.disposition === "prepare"
        ? await services.scaffoldPrepare.prepare(key, ref, plan.kinds)
        : null;
    const readback = await services.scaffoldRead.readback(
      key,
      staged?.draft ?? null,
    );
    const report = staged ?? {disposition:plan.disposition,finding:plan.finding};
    const verification = await verify(report);
    const altered = structuredClone(report);
    if ("draft" in altered) altered.draft = "foreign-draft";
    else altered.disposition = "invented" as typeof altered.disposition;
    const rejectedChangedMain = !(await verify(altered)).passed;
    const rejectedUnapprovedDraft = staged
      ? true
      : (await services.scaffoldPrepare.prepare(key, ref, plan.kinds)) ===
          null && isDeepStrictEqual((await status()).workingHead, initial);
    const rejectedAlteredEvidence = denied && rejectedChangedMain && rejectedUnapprovedDraft;
    return {
      ...verification,
      outcomeContract:{...verification.outcomeContract,effects:{...verification.outcomeContract.effects,checks:[...verification.outcomeContract.effects.checks,"rejectedAlteredEvidence"]}},
      passed: verification.passed && rejectedAlteredEvidence,
      checks: { ...verification.checks, rejectedAlteredEvidence },
      referenceReport: report,
    };
  }
  return { services, verify, qualify };
}
