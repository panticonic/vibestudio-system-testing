import {
  CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
  type ReportClaim,
  type TestCase,
  type TestExecutionResult,
  type TestResult,
  type WorkspaceRepoCreationScope,
} from "../types.js";
import { getToolCalls, noIncompleteInvocations } from "./_helpers.js";
import {
  panelControlAuthorityPolicy,
  PANEL_AUTOMATION_RESOURCE,
} from "../panel-authority.js";

/** What the final answer must say is a report claim (judged by meaning, its pattern first); the rest stays exact. */
function hasEvidence(
  result: TestExecutionResult,
  guidance: RegExp,
  actionEvidence?: RegExp[],
  forbiddenToolNames: string[] = [],
): TestResult {
  const completed = getToolCalls(result).filter(
    (call) =>
      call.execution?.status === "complete" && call.execution.isError !== true,
  );
  if (completed.some((call) => forbiddenToolNames.includes(call.name))) {
    return { passed: false, reason: "Read-only triage performed a source-authoring operation" };
  }
  const docsEvidence = completed
    .filter(
      (call) =>
        call.name === "read" ||
        call.name === "docs_search" ||
        call.name === "docs_open",
    )
    .map((call) => JSON.stringify(call.execution?.result ?? null))
    .join("\n");
  if (!guidance.test(docsEvidence)) {
    return {
      passed: false,
      reason:
        "No completed documentation read supplied the relevant workspace guidance",
    };
  }
  if (actionEvidence) {
    const actions = completed
      .filter(
        (call) =>
          call.name !== "read" &&
          call.name !== "docs_search" &&
          call.name !== "docs_open",
      )
      .map(
        (call) =>
          `${call.name}\n${JSON.stringify(call.arguments ?? {})}\n${JSON.stringify(call.execution?.result ?? null)}`,
      )
      .join("\n");
    if (!actionEvidence.every((pattern) => pattern.test(actions))) {
      return {
        passed: false,
        reason:
          "Canonical tool evidence did not demonstrate the documented workflow",
      };
    }
  }
  return noIncompleteInvocations(result);
}

function appliedDocsProbe(
  name: string,
  description: string,
  task: string,
  guidance: RegExp,
  claims: ReportClaim[],
  options?: {
    workspaceRepoFixture?: WorkspaceRepoCreationScope;
    actionEvidence?: RegExp[];
    forbiddenToolNames?: string[];
    authorityPolicy?: TestCase["authorityPolicy"];
    resources?: TestCase["resources"];
  },
): TestCase {
  return {
    name,
    description,
    category: "docs-probes",
    prompt: task,
    ...(options?.authorityPolicy
      ? { authorityPolicy: options.authorityPolicy }
      : {}),
    ...(options?.resources ? { resources: options.resources } : {}),
    ...(options?.workspaceRepoFixture
      ? { workspaceRepoFixture: options.workspaceRepoFixture }
      : {}),
    validate: (result) =>
      hasEvidence(result, guidance, options?.actionEvidence, options?.forbiddenToolNames),
    reportClaims: claims,
  };
}

/** These explanation tasks use policy already supplied in the base system prompt.
 * Exact service contracts and live-state probes below still require observed docs. */
function appliedPolicyProbe(
  name: string,
  description: string,
  prompt: string,
  claims: ReportClaim[],
): TestCase {
  return {
    name,
    description,
    category: "docs-probes",
    prompt,
    validate: noIncompleteInvocations,
    reportClaims: claims,
  };
}

export const docsProbeTests: TestCase[] = [
  appliedDocsProbe(
    "docs-sandbox-vcs-decision",
    "Choose and verify the safe workspace VCS path from a browser/eval context",
    "A user asks you to commit workspace source changes from inside a browser panel. Determine what you would do.",
    /sandbox|runtime|vcs|version.control/iu,
    [
      { id: "panel", claim: "The answer addresses committing from inside a browser panel.", match: /browser|panel/iu },
      { id: "vcs", claim: "The commit should go through the workspace's version control service.", match: /workspace|semantic|vcs|version.control/iu },
      { id: "not-in-panel", claim: "The panel itself should not be used to make the commit; it is done another way instead.", match: /not|avoid|cannot|instead/iu },
    ],
  ),
  appliedPolicyProbe(
    "docs-interaction-surface-choice",
    "Choose an interaction surface for a fallible user workflow",
    "For a Vibestudio setup flow with links and an operation that can fail, explain which supported interaction surface fits and why.",
    [
      { id: "links", claim: "The answer addresses the setup flow's links.", match: /link/iu },
      { id: "failure", claim: "The answer addresses what the user sees when the operation fails.", match: /fail|error/iu },
      { id: "surface", claim: "The recommended surface is inline UI, a persistent component in the transcript.", match: /inline_ui|inline UI|persistent.*panel/iu },
    ],
  ),
  appliedDocsProbe(
    "docs-workspace-dev-change-loop",
    "Create, publish, and inspect a real isolated panel",
    "Create, publish, and inspect a tiny isolated panel project.",
    /workspace-dev|workflow|panel/iu,
    [
      { id: "created", claim: "A small panel project was created.", match: /panel|project/iu },
      { id: "published", claim: "The panel was published.", match: /publish/iu },
      { id: "inspected", claim: "The published panel was opened and inspected.", match: /open|inspect/iu },
    ],
    {
      workspaceRepoFixture: CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
      authorityPolicy: panelControlAuthorityPolicy("inspect-docs-probe-panel"),
      resources: [PANEL_AUTOMATION_RESOURCE],
      actionEvidence: [
        /\bprepareProjects\b|prepareProjects/iu,
        /\bcommit\b|vcs\.commit/iu,
        /\bpush\b|vcs\.push/iu,
        /openPanel/iu,
      ],
    },
  ),
  appliedDocsProbe(
    "docs-worker-fork-rpc-plan",
    "Plan a worker fork and verify the runtime routing concept",
    "Plan how to fork a worker that might expose Durable Objects and call one later.",
    /worker|durable|rpc|routing/iu,
    [
      { id: "fork", claim: "The plan forks the worker.", match: /fork|clone/iu },
      { id: "durable-object", claim: "The plan accounts for the worker's Durable Objects.", match: /durable object/iu },
      { id: "routing", claim: "The plan says how a later call is routed to the Durable Object (its service or RPC address).", match: /route|rpc|service/iu },
    ],
  ),
  appliedDocsProbe(
    "docs-do-rpc-catalog-mismatch",
    "Repair an exact-build Durable Object RPC catalog mismatch without bypassing authority",
    "I added a Durable Object RPC method in workspace source, but the live call reports WORKSPACE_RPC_METHOD_UNDECLARED. Explain why and what I should do next.",
    /WORKSPACE_RPC_METHOD_UNDECLARED|exact active provider build|declared methods|(?:publish|publication|active service)[\s\S]{0,300}(?:build|candidate|contract)|(?:build|candidate|contract)[\s\S]{0,300}(?:publish|publication|active service)/iu,
    [
      { id: "source", claim: "The method exists in workspace source or a candidate build.", match: /\b(?:workspace\s+)?source\b|\bcandidate\b/iu },
      { id: "live", claim: "The live, active service is what the call reached.", match: /\b(?:live|active|published)\b/iu },
      { id: "contract", claim: "The active build's contract does not include the method.", match: /\b(?:build|contract|catalog|service|receiver|rpc method)\b/iu },
      { id: "publish", claim: "The new build has to be published or activated before the method can be called.", match: /\b(?:publish(?:ed|es|ing)?|publication|activat(?:e|es|ed|ion|ing))\b/iu },
      { id: "declared", claim: "The method has to be declared, and the live service docs show whether it is.", match: /declar|live service docs/iu },
    ],
  ),
  appliedDocsProbe(
    "docs-do-schema-migration-recovery",
    "Choose migration over data encoding and identify structured schema refusals",
    "A live Durable Object reports DO_SCHEMA_INCOMPATIBLE after a schemaVersion bump. Explain the safe repair and publication-fixture path.",
    /DO_SCHEMA_INCOMPATIBLE|schemaMigrations|productionBaseline|schemaMigrationFixtureObjectKeys/iu,
    [
      { id: "migration", claim: "The repair is a schema migration.", match: /schemaMigrations|migration/iu },
      { id: "fixture", claim: "A representative fixture object is listed for the migration check before publication.", match: /schemaMigrationFixtureObjectKeys|representative.*fixture|fixture.*object/iu },
      { id: "refusal", claim: "The refusal reports the persisted version or the reason the stored data is incompatible.", match: /persist|version|reason/iu },
      { id: "no-encoding", claim: "The fix is not to encode the change into the stored data itself (titles, labels or rows).", match: /not|avoid.*title|label|row/iu },
    ],
  ),
  appliedDocsProbe(
    "docs-do-disposable-storage-reset",
    "Use the exact-target backed-up reset path only for disposable DO state",
    "A disposable Durable Object test database has an incompatible schema and may be erased. Explain the supported reset and recovery APIs.",
    /resetStorage|listStorageBackups|restoreStorageBackup/iu,
    [
      { id: "exact", claim: "The reset names the exact Durable Object it applies to.", match: /exact|target|source|class|object/iu },
      { id: "intent", claim: "The reset call states its intent.", match: /intent/iu },
      { id: "backup", claim: "The reset keeps a backup that can be restored.", match: /backup|restore/iu },
      { id: "disposable", claim: "Resetting is only for disposable state.", match: /disposable/iu },
    ],
  ),
  appliedDocsProbe(
    "docs-appdev-target-triage",
    "Triage a target-specific app bug without editing source",
    "A user reports a Vibestudio bug seen only in the Electron shell. Triage it before making source changes.",
    /appdev|electron|target/iu,
    [
      { id: "electron", claim: "The answer is about the Electron shell.", match: /electron/iu },
      { id: "triage", claim: "The bug is triaged or diagnosed before any source is changed.", match: /triage|diagnos|inspect/iu },
    ],
    { forbiddenToolNames: ["write", "edit", "apply_patch", "move_file", "copy_file"] },
  ),
  appliedDocsProbe(
    "docs-extensiondev-risk-plan",
    "Produce an approval/fetch/migration risk plan for an extension",
    "A new Vibestudio extension needs network fetches, stored credentials, and a schema change. Plan the trust boundaries and implementation.",
    /extensiondev|approval|credential|migration/iu,
    [
      { id: "approval", claim: "The plan requests authority narrowly and relies on user approval for it.", match: /approval|permission|request only|authorized|authoriz/iu },
      { id: "credential", claim: "The plan says how stored credentials are used.", match: /credential/iu },
      { id: "migration", claim: "The plan handles the schema change with a migration.", match: /migration|schema/iu },
      { id: "network", claim: "The plan covers the network fetches.", match: /network|fetch/iu },
    ],
  ),
  appliedDocsProbe(
    "docs-browser-import-safety",
    "Classify risky browser import artifacts and avoid unsafe import behavior",
    "A user asks to import all browser data automatically from every detected profile. Respond with the right workflow.",
    /browser|import|profile|discovery/iu,
    [
      { id: "discover", claim: "The workflow first discovers the browser profiles.", match: /discover|profile/iu },
      { id: "confirm", claim: "The user selects or confirms what to import.", match: /confirm|select|approval|ask/iu },
      { id: "not-all", claim: "Importing everything automatically is not done, because some of it is sensitive.", match: /not|avoid|unsafe|sensitive/iu },
    ],
  ),
  appliedDocsProbe(
    "docs-credentialed-apis",
    "Diagnose missing auth for credentialed APIs without leaking secrets",
    "A credentialed API call fails because no connection is configured. Diagnose the next step.",
    /credential|oauth|api.integrations/iu,
    [
      { id: "missing", claim: "The call fails because no credential connection is configured.", match: /credential|oauth|connection/iu },
      { id: "connect", claim: "The next step is for the user to connect or authorize the credential.", match: /connect|authorize|user/iu },
      { id: "secret", claim: "No secret is exposed in the process.", match: /secret|safe|not expose/iu },
    ],
  ),
  appliedPolicyProbe(
    "docs-headless-gad-diagnostics",
    "Gather bounded diagnostics for a stalled agent",
    "Explain how you would briefly diagnose a Vibestudio headless agent with no final message after a tool call, distinguishing running work from a failed operation. No affected session has been identified yet.",
    [
      { id: "session", claim: "The diagnosis starts from the agent's session or channel.", match: /session|channel/iu },
      { id: "lifecycle", claim: "It checks the turn's completion or terminal lifecycle state.", match: /completion|terminal|lifecycle/iu },
      { id: "running", claim: "It tells work still running or pending from a stall.", match: /pending|in.flight|stalled|running/iu },
      { id: "bounded", claim: "The reads are bounded to recent records.", match: /bounded|recent|limit|brief/iu },
      { id: "invocation", claim: "It inspects the tool invocation that came before the silence.", match: /tool|invocation/iu },
    ],
  ),
  appliedDocsProbe(
    "docs-agent-operating-policy",
    "Choose the next action under workspace and web-fact uncertainty",
    "I am new to this Vibestudio workspace. What should you check before choosing an API integration, and how would you verify whether a provider’s current authentication requirements have changed? Explain your next actions before configuring anything.",
    /operating|policy|workspace|web/iu,
    [
      { id: "workspace", claim: "The workspace's existing setup is checked first.", match: /workspace/iu },
      { id: "inspect", claim: "The agent inspects or reads it before choosing.", match: /inspect|check|read/iu },
      { id: "web", claim: "The provider's current requirements are verified on the web.", match: /web|current|browse/iu },
      { id: "conditional", claim: "The next actions depend on what those checks find.", match: /uncertain|if|depending/iu },
    ],
  ),
];
