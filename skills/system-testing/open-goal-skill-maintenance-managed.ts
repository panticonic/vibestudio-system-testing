import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome=bindObservedContentReview(["journal","observation","authoring","gate","proof","final","changedPaths","nativeFacts"],[]);
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type {
  VcsEditChange,
  VcsStateNodeRef,
} from "@vibestudio/service-schemas/vcs";
import type { VcsClient } from "@workspace/runtime";
import type { ProgramDescription } from "@workspace/natlang/describe-types";
import type {
  AuthoringRequest,
  ProgramRole,
} from "@workspace-skills/natlang-authoring/types";
import {
  readAuthoringProgram,
  reviewCompilerReadbacks,
} from "./authoring-managed.js";
import {
  measureSkillContract,
  type Criterion,
  type NativeSkillCheck,
  type ownedSkillMaintenanceNative,
} from "./open-goal-skill-maintenance-native.js";
import type {
  SkillFunctionContract,
  SkillMaintenanceWorld,
} from "./open-goal-skill-maintenance-worlds.js";

type Ports = {
  contextId: string | null;
  vcs: Pick<
    VcsClient,
    "status" | "edit" | "resolveRepository" | "readFile" | "listFiles"
  >;
  describe(path: string): Promise<ProgramDescription>;
  native: ReturnType<typeof ownedSkillMaintenanceNative>;
};
type Change = { path: string; text: string | null };
type Journal = {
  service: string;
  method: string;
  args: unknown[];
  result: unknown;
};
const canary = "owner.json";

function textSource(input: SkillFunctionContract) {
  const args = Object.entries(input.args)
    .map(([key, type]) => `  ${key}: ${type}`)
    .join("\n");
  const body =
    input.path === "run.nl"
      ? "Read the user's goal and return the requested review. Preserve responsibility for each specialized helper."
      : `Carry out the narrow ${input.path.split("/").at(-1)!.replace(/\.nl$/u, "")} check using the supplied context and return its typed result.`;
  return `---\ndescription: Perform the assigned reusable review.\nargs:\n${args}\nreturns: ${input.returns}\n---\n${body}\n`;
}

function config(name: string, selectors?: string[]) {
  return (
    JSON.stringify(
      {
        schema: "natlang.package/v2",
        name,
        version: "0.1.0",
        serviceBinding: "explicit",
        targets: { main: { entry: "run.nl" } },
        ...(selectors
          ? { serviceScopes: { notificationState: selectors } }
          : {}),
      },
      null,
      2,
    ) + "\n"
  );
}

export async function prepareSkillMaintenance(
  input: { contextId: string; caseId: string },
  world: SkillMaintenanceWorld,
  ports: Ports,
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error(
      "Skill maintenance belongs to another owned workspace context",
    );
  const { contextId } = input;
  const { describe, native, vcs } = ports;
  const status = () => vcs.status({ contextId });
  const baseline = await status();
  const random = crypto.randomUUID();
  const packageName = "maintenance-" + random;
  const workingPath = "skills/" + packageName;
  const archivePath = workingPath + "-archive";
  const edit = (
    head: VcsStateNodeRef,
    label: string,
    changes: VcsEditChange[],
  ) =>
    vcs.edit({
      contextId,
      expectedWorkingHead: head,
      commandId: `${random}:${label}`,
      changes,
    });
  const text = (value: string) => ({ kind: "text" as const, text: value });
  const root = { path: "run.nl", args: { goal: "string" }, returns: "string" };
  const files = {
    "run.nl": textSource(root),
    "natlang.json": config(packageName, world.scope?.original),
    "SKILL.md": `---\nname: ${packageName}\ndescription: ${JSON.stringify(world.name + " reusable contract review")}\n---\n\n# ${world.name}\n\nUse the typed entrypoint in run.nl. Its named children own the specialized contract checks.\n`,
    [canary]:
      JSON.stringify({
        name: world.name,
        owner: "assigned",
        updated: "initial",
      }) + "\n",
    ...Object.fromEntries(
      world.before.map((source) => [source.path, textSource(source)]),
    ),
    ...(world.scope
      ? {
          "services.d.ts":
            'declare module "natlang:services" { export const notificationState: { discover(): Promise<unknown[]> }; }\n',
        }
      : {}),
  };
  const archivedFiles = {
    ...files,
    "natlang.json": config(packageName + "-archive", world.scope?.original),
    "SKILL.md": files["SKILL.md"].replace(
      `name: ${packageName}\n`,
      `name: ${packageName}-archive\n`,
    ),
  };
  const directories = [
    { path: workingPath, files },
    { path: archivePath, files: archivedFiles },
  ];
  const seeded = await edit(
    baseline.workingHead,
    "seed",
    directories.map((directory) => ({
      kind: "repository-create" as const,
      repoPath: directory.path,
      files: Object.entries(directory.files).map(([path, value]) => ({
        path,
        mode: 0o644,
        content: text(value),
      })),
    })),
  );
  const criterion: Criterion = {
    expected: world.target.map(({ path, args, returns }) => ({
      path,
      parameters: Object.entries(args).map(
        ([name, type]) => `${name}: ${type}`,
      ),
      returns,
    })),
    absent: world.remove ?? [],
    requiredSelectors: world.scope?.required ?? null,
  };
  async function view(head: VcsStateNodeRef, repoPath: string) {
    const repository = await vcs.resolveRepository({ state: head, repoPath });
    if (!repository || repository.repoPath !== repoPath)
      throw new Error("Owned skill repository is missing");
    const list = await vcs.listFiles({
      state: head,
      repositoryId: repository.repositoryId,
      limit: 32,
    });
    if (list.nextCursor !== null)
      throw new Error("Owned skill exceeds its bounded source inventory");
    const items = await Promise.all(
      list.files.map(async ({ path }) => {
        const row = await vcs.readFile({
          state: head,
          repositoryId: repository.repositoryId,
          file: { kind: "path", path },
        });
        if (row?.content.kind !== "text")
          throw new Error("Owned skill source must remain text");
        return {
          path,
          text: row.content.text,
          id: row.fileId,
          hash: row.contentHash,
        };
      }),
    );
    items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return {
      repositoryId: repository.repositoryId,
      items,
      revision: sha256HexSyncText(JSON.stringify([head, repoPath, items])),
    };
  }
  const working = await view(seeded.workingHead, workingPath);
  const archive = await view(seeded.workingHead, archivePath);
  const witnessAt =
    world.evidence === "archive"
      ? { path: archivePath, revision: archive.revision }
      : { path: workingPath, revision: working.revision };
  let original: Awaited<ReturnType<typeof native.observe>>;
  try {
    original = await native.observe(
      witnessAt.path,
      witnessAt.revision,
      criterion,
    );
  } catch (error) {
    await native.close();
    throw error;
  }
  const editable = world.scope
    ? ["natlang.json"]
    : [
        ...new Set([
          ...criterion.expected.map((clause) => clause.path),
          ...criterion.absent,
        ]),
      ];
  const cards = [
    { id: crypto.randomUUID(), label: world.name, edition: "working" as const },
    {
      id: crypto.randomUUID(),
      label: world.name + " archive",
      edition: "archive" as const,
    },
  ];
  const currentCard = cards[0]!;
  const request: AuthoringRequest = {
    goal: world.goal,
    compare: false,
    contract: {
      entry: criterion.expected[0]!.path,
      expectedParameters: criterion.expected[0]!.parameters,
      expectedReturn: criterion.expected[0]!.returns,
      declaredServices: world.scope ? ["notificationState"] : [],
      ...(world.scope
        ? { expectedServiceScopes: { notificationState: world.scope.required } }
        : {}),
      requiredHelpers: criterion.expected.slice(1).map((clause) => clause.path),
      preserveBaseline: false,
    },
  };
  const observation = {
    card: currentCard,
    path: workingPath,
    revision: working.revision,
    files: working.items.map(({ path, text }) => ({ path, text })),
    check: original.check,
    editable,
    approval:
      world.authority === "denied"
        ? ("denied" as const)
        : ("approved" as const),
    authoringRequest: request,
  };
  const coedit =
    JSON.stringify({
      name: world.name,
      owner: "assigned",
      updated: "by-coeditor",
    }) + "\n";
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
  const evidenceService = "skillMaintenanceEvidence";
  const editService = "skillMaintenanceEdit";
  let confirmed: string | null = null;
  let staged = false;
  let coeditApplied = false;
  let final: Awaited<ReturnType<typeof native.observe>> | null = null;
  function requireOwner(id: string) {
    if (id !== currentCard.id)
      throw new Error("Use only the assigned working skill");
  }
  const services = {
    [evidenceService]: {
      async discover() {
        return keep(evidenceService, "discover", [], cards);
      },
      async inspect(id: string) {
        requireOwner(id);
        return keep(evidenceService, "inspect", [id], observation);
      },
      async confirm(id: string, revision: string) {
        requireOwner(id);
        if (revision !== working.revision)
          throw new Error(
            "Confirm only the exact inspected skill frontier once",
          );
        if (confirmed !== null) {
          const previous = journal.findLast(row => row.method === "confirm");
          if (!previous) throw new Error("The confirmed frontier lost its native evidence");
          return structuredClone(previous.result) as {current: string; status: "denied" | "current" | "changed"};
        }
        if (world.advance) {
          const row = working.items.find((item) => item.path === canary)!;
          await edit(seeded.workingHead, "coedit", [
            {
              kind: "content-replace",
              repositoryId: working.repositoryId,
              fileId: row.id,
              content: text(coedit),
            },
          ]);
          coeditApplied = true;
        }
        const current = await view((await status()).workingHead, workingPath);
        confirmed = current.revision;
        return keep(evidenceService, "confirm", [id, revision], {
          current: current.revision,
          status:
            observation.approval === "denied"
              ? "denied"
              : revision === current.revision
                ? "current"
                : "changed",
        });
      },
      async readback(id: string) {
        requireOwner(id);
        const state = (await status()).workingHead;
        const current = await view(state, workingPath);
        final = await native.observe(workingPath, current.revision, criterion);
        if (!isDeepStrictEqual((await status()).workingHead, state))
          throw new Error("Working skill moved after readback");
        return keep(evidenceService, "readback", [id], final.check);
      },
    },
    authoringCompiler: {
      async inspect(role: ProgramRole) {
        if (
          role !== "candidate" ||
          !isDeepStrictEqual((await status()).workingHead, seeded.workingHead)
        )
          throw new Error("Compiler read must precede frontier reconfirmation");
        const result = await readAuthoringProgram(
          describe,
          workingPath,
          role,
          working.revision,
        );
        return keep("authoringCompiler", "inspect", [role], result);
      },
    },
    [editService]: {
      async stage(id: string, revision: string, changes: Change[]) {
        requireOwner(id);
        const head = (await status()).workingHead;
        const current = await view(head, workingPath);
        const hold = (disposition: "stale" | "denied") =>
          keep(editService, "stage", [id, revision, changes], {
            before: revision,
            after: current.revision,
            disposition,
            paths: [],
          });
        if (
          revision !== working.revision ||
          revision !== confirmed ||
          revision !== current.revision
        )
          return hold("stale");
        if (
          observation.approval !== "approved" ||
          original.check.path !== workingPath ||
          original.check.revision !== working.revision ||
          original.check.satisfied ||
          staged
        )
          return hold("denied");
        if (
          !Array.isArray(changes) ||
          !changes.length ||
          changes.length > editable.length ||
          new Set(changes.map((row) => row.path)).size !== changes.length ||
          changes.some(
            (row) =>
              !editable.includes(row.path) ||
              (row.text === null
                ? !criterion.absent.includes(row.path)
                : typeof row.text !== "string" ||
                  !row.text.trim()),
          )
        )
          throw new Error(
            "Proposed skill patch left the bounded local source scope",
          );
        const operations: VcsEditChange[] = changes.map((row) => {
          const file = current.items.find((item) => item.path === row.path);
          const target = { repositoryId: current.repositoryId };
          if (row.text === null) {
            if (!file) throw new Error("Cannot remove an absent source file");
            return { ...target, kind: "file-delete", fileId: file.id };
          }
          return file
            ? {
                ...target,
                kind: "content-replace",
                fileId: file.id,
                content: text(row.text),
              }
            : {
                ...target,
                kind: "file-create",
                path: row.path,
                mode: 0o644,
                content: text(row.text),
              };
        });
        const next = await edit(head, "local-patch", operations);
        staged = true;
        const applied = await view(next.workingHead, workingPath);
        return keep(editService, "stage", [id, revision, changes], {
          before: revision,
          after: applied.revision,
          disposition: "staged",
          paths: changes.map((row) => row.path),
        });
      },
    },
  };


  
  async function verify(report: unknown,observations?: InvocationObservations) {
    const proof=await verifyNativeApplication(report,observations);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const contributions=[{checks:["returnedMaintenanceValue"],rootPath:["explanation"],producerSourceSuffix:"maintainWorkspaceSkill.nl",producerPath:["explanation"]}];
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,report,observations,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(report: unknown, observations?: InvocationObservations) {
    const result = report as {explanation?:string;patch?:unknown;check?:unknown} | null;
    const finalStatus = await status();
    const retainedArchive = await view(finalStatus.workingHead, archivePath);
    const after = await view(finalStatus.workingHead, workingPath);
    const read = <T>(method: string, args: unknown[], expected?: T) => {
      const rows = journal.filter(
        (row) => row.service === evidenceService && row.method === method,
      );
      return (
        rows.some(row => isDeepStrictEqual(row.args, args) &&
          (expected === undefined || isDeepStrictEqual(row.result, expected)))
      );
    };
    const gate = journal.find((row) => row.method === "confirm")?.result as
      | { status?: string }
      | undefined;
    const stageReads=journal.filter(row=>row.service===editService&&row.method==="stage");
    const proof = (stageReads.findLast(row=>(row.result as {disposition?:string})?.disposition==="staged")??stageReads.at(-1))?.result as
      | { disposition?: string; after?: string; paths?: string[] }
      | undefined;
    const compiled = journal.find((row) => row.service === "authoringCompiler")
      ?.result as Awaited<ReturnType<typeof readAuthoringProgram>> | undefined;
    const authoring =
      compiled && reviewCompilerReadbacks({ request, reads: [compiled] });
    const withPatch = world.action === "stage-local-patch";
    const changedPaths = [
      ...new Set([...working.items, ...after.items].map((row) => row.path)),
    ]
      .filter(
        (path) =>
          !isDeepStrictEqual(
            working.items.find((item) => item.path === path),
            after.items.find((item) => item.path === path),
          ),
      )
      .sort();
    const actualCurrent=final?.check.revision===after.revision ? final : await native.observe(workingPath,after.revision,criterion);
    const compilerReadback=measureSkillContract(await describe(workingPath),workingPath,after.revision,criterion);
    const knownChecks=[original.check,...journal.filter(row=>row.service===evidenceService&&row.method==="readback").map(row=>row.result),actualCurrent.check];
    const permittedChanges=new Set([...editable,...(coeditApplied?[canary]:[])]);
    const checks = {
      returnedMaintenanceValue:typeof result?.explanation==="string"&&Boolean(result.explanation.trim()),
      authenticMaintenanceCopies:result==null||
        ((result.patch==null||stageReads.some(row=>isDeepStrictEqual(row.result,result.patch)))&&
         (result.check==null||knownChecks.some(check=>isDeepStrictEqual(check,result.check)))),
      exactSkillSourceAndOriginalWitness:original.check.path===witnessAt.path&&original.check.revision===witnessAt.revision&&await native.retained(original.retained),
      exactInstalledAuthoringReview:compiled==null||compiled.revision===working.revision&&authoring!==undefined,
      retainedCurrentAuthority:gate==null||read("confirm",[currentCard.id,working.revision],gate)&&
        (gate as {current?:string}).current===confirmed&&
        (gate.status==="denied"?observation.approval==="denied":gate.status==="changed"?(gate as {current?:string}).current!==working.revision:gate.status==="current"&&(gate as {current?:string}).current===working.revision),
      exactScopedSemanticSkillPatch:changedPaths.every(path=>permittedChanges.has(path))&&
        (withPatch||changedPaths.every(path=>coeditApplied&&path===canary))&&
        (!staged||proof?.disposition==="staged"&&proof.after===after.revision&&
          Array.isArray(proof.paths)&&proof.paths.every(path=>editable.includes(path)))&&
        isDeepStrictEqual(retainedArchive.items,archive.items)&&finalStatus.mainEventId===baseline.mainEventId&&
        (!coeditApplied||after.items.find(row=>row.path===canary)?.text===coedit),
      exactSkillCompilerReadback:actualCurrent.check.path===workingPath&&actualCurrent.check.revision===after.revision&&
        actualCurrent.check.satisfied===compilerReadback.satisfied&&
        isDeepStrictEqual(actualCurrent.check.failures,compilerReadback.failures)&&await native.retained(actualCurrent.retained)&&
        (!withPatch||actualCurrent.check.satisfied),
    };
    return {
      outcomeContract: {
        effects: {checks:["exactSkillSourceAndOriginalWitness", "exactInstalledAuthoringReview", "retainedCurrentAuthority", "exactScopedSemanticSkillPatch", "exactSkillCompilerReadback"],rationale:"Actual skill bytes, authorization, compiler readback and protected workspace establish repair."},
        returnedValue: {checks:["returnedMaintenanceValue"],required:world.requestedReturnRequired,rationale:"Literal requested findings remain required beside a repair; an unrequested generic report is optional."},
        incidentalValues: {checks:["authenticMaintenanceCopies"],rationale:"A known incorrect emitted application value is excluded using the actual root definition."},
      },
      incorrectReturnValues:[],
      contextId,
      caseId: world.id,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      journal: structuredClone(journal),
      observation,
      authoring,
      gate,
      proof: proof ?? null,
      final: actualCurrent.check,
      changedPaths,
      nativeFacts:{opening:{revision:working.revision,files:observation.files,witness:original.check},
        current:{revision:after.revision,files:after.items.map(({path,text})=>({path,text})),check:actualCurrent.check,measured:compilerReadback},
        actorReadbacks:journal.filter(row=>row.service===evidenceService||row.service==="authoringCompiler"),
        actorObserved:{source:journal.some(row=>row.service===evidenceService&&row.method==="inspect"),authoring:journal.some(row=>row.service==="authoringCompiler"),authority:journal.some(row=>row.service===evidenceService&&row.method==="confirm"),readback:journal.some(row=>row.service===evidenceService&&row.method==="readback")},
        coeditApplied,protocol:"The original retained witness, actual semantic authoring inspection, current independent compiler check and actual actor reads have separate roles. Independent verifier reads are not actor reads. A grant or plan is not a requested repair or a completed repair."},
    };
  }

  async function qualify() {
    const discovered = await services.skillMaintenanceEvidence.discover();
    let rejectedAlias = false;
    try {
      await services.skillMaintenanceEvidence.inspect(discovered[1]!.id);
    } catch {
      rejectedAlias = true;
    }
    const observed = await services.skillMaintenanceEvidence.inspect(
      currentCard.id,
    );
    const compiled = await services.authoringCompiler.inspect("candidate");
    const authoring = reviewCompilerReadbacks({ request, reads: [compiled] });
    const gate = await services.skillMaintenanceEvidence.confirm(
      currentCard.id,
      observed.revision,
    );
    const changes: Change[] = world.scope
      ? [
          {
            path: "natlang.json",
            text: config(packageName, world.scope.required),
          },
        ]
      : [
          ...world.target.map((source) => ({
            path: source.path,
            text: textSource(source),
          })),
          ...criterion.absent.map((path) => ({ path, text: null })),
        ];
    const receipt =
      world.action === "stage-local-patch"
        ? await services.skillMaintenanceEdit.stage(
            currentCard.id,
            observed.revision,
            changes,
          )
        : null;
    const final = await services.skillMaintenanceEvidence.readback(
      currentCard.id,
    );
    const report={explanation:"The actual retained witness and current compiler contract were inspected under the owned source and authority.",patch:receipt,check:final};
    const result=await verify(report);
    const wrong={...report,check:{...final,resultDigest:"not-issued"}};
    const rejectedWrongReadback=!(await verify(wrong)).checks.authenticMaintenanceCopies;
    const referenceRequiredEffects=world.action!=="stage-local-patch"||Boolean(receipt?.disposition==="staged"&&final.satisfied);
    const checks={...result.checks,rejectedAlias,rejectedWrongReadback,referenceRequiredEffects};
    return assessNativeQualification({
      ...result,
      outcomeContract:{...result.outcomeContract,effects:{...result.outcomeContract.effects,checks:[...result.outcomeContract.effects.checks,"rejectedAlias","rejectedWrongReadback","referenceRequiredEffects"]}},
      checks,
      passed: Object.values(checks).every(Boolean),
      report,
    });
  }
  return { services, verify, qualify, close: native.close };
}
