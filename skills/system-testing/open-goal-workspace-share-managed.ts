import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { accountProfileSchema, workspaceMemberProfileSchema } from "@vibestudio/service-schemas/account";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { ChannelInvite } from "@vibestudio/shared/channelInvites";
import {
  channelInviteFromNotification, channelInviteNotification, channelInviteNotificationId, type UserNotification,
} from "@vibestudio/shared/userNotifications";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type { WorkspaceShareWorld as World } from "./open-goal-workspace-share-worlds.js";

type Account = "root" | "admin" | "member";
export type InviteProjection = {
  retained: UserNotification; pending: UserNotification | null; currentRevision: number;
  member: boolean; action: "put" | "delete"; inbox: "pending" | "acknowledged" | "absent";
};
export type ProjectionSeed = {
  invite: ChannelInvite; state: World["state"]; oldReceipt: boolean;
};
type Decision = "hold-workspace" | "hold-recipient" | "hold-revoked" | "hold-membership" | "hold-revision" |
  "hold-invite" | "hold-declined" | "hold-pending" | "hold-role" | "inspect-current" |
  "stage-author" | "stage-reviewer" | "stage-reader";
type Card = { id: string; workspace: string; title: string; revision: string };
type Approval = { workspace: string; document: string; revision: string; digest: string; recipient: string; invitationRevision: number;
  role: World["role"]; status: "approved" | "pending" | "declined" | "withdrawn" };
type Assignment = { goal: string; workspace: string; document: string; user: string; purpose: World["purpose"]; candidates: Card[] };
type Handoff = { path: string; bytes: number; sha256: string };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
type Session = { admitted: boolean; accountRole: Account };
type Membership = { accountRole: Account; workspaceRole: "admin" | "member" | null; active: boolean; revoked: boolean };
type Ports = { contextId: string; fs: typeof fs; vcs: Pick<typeof vcs, "status">;
  session(): Promise<Session>;
  project(seed: ProjectionSeed): Promise<InviteProjection>;
  readBytes(path: string, limit: number): Promise<Uint8Array>;
};
const digest = sha256HexSyncText;
const decoder = new TextDecoder("utf-8", { fatal: true });
const artifactNames = /^evidence-handoff-[a-f0-9]{32}$/u;

function modelRetainedProjection({ invite, state, oldReceipt }: ProjectionSeed): InviteProjection {
  const action = state === "revoked" ? "delete" : "put";
  const rev = ["rejoined", "revoked"].includes(state) ? 3 : state === "pending" ? 2 : 1;
  const inbox = ["revoked", "removed-inbox"].includes(state) ? "absent" :
    state === "acknowledged" ? "acknowledged" : "pending";
  const retainedRevision = oldReceipt || action === "delete" ? 1 : rev;
  const retained = channelInviteNotification(invite, retainedRevision);
  return { retained, pending: inbox === "pending" ? channelInviteNotification(invite, rev) : null,
    action, member: action === "put", currentRevision: rev, inbox };
}

async function liveSession(): Promise<Session> {
  const profile = accountProfileSchema.parse(await rpc.call("main", mainRpcMethods["account.getProfile"], []));
  const admitted = await rpc.call("main", mainRpcMethods["account.isMember"], [profile.userId]);
  return { admitted: admitted && profile.revoked !== true, accountRole: profile.role };
}
function fixtureMembership(world: World, userId: string): Membership {
  const active = !["no-workspace-membership", "revoked-account"].includes(world.change);
  const profile = accountProfileSchema.parse({ userId, handle: "reviewer", displayName: "Review account",
    role: world.accountRole, ...(world.change === "revoked-account" ? { revoked: true } : {}) });
  const row = active ? workspaceMemberProfileSchema.parse({ ...profile, accountRole: profile.role, role: world.workspaceRole }) : null;
  return { accountRole: profile.role, workspaceRole: row?.role ?? null, active: row !== null, revoked: profile.revoked === true };
}

export async function prepareWorkspaceShare(input: { contextId: string; caseId: string }, world: World, ports: Ports = {
  contextId, fs, vcs, session: liveSession,
  project: async seed => modelRetainedProjection(seed),
  readBytes: (path, limit) => readWorkspaceBytes(rpc, path, limit),
}) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) throw new Error("This share review belongs to another workspace context");
  const { fs: files, readBytes } = ports;
  const before = await ports.vcs.status({ contextId: ports.contextId });
  const session = await ports.session();
  if (!session.admitted) throw new Error("The owned test session must resolve its authenticated workspace membership");
  const workspace = "workspace-" + crypto.randomUUID(), otherWorkspace = "workspace-" + crypto.randomUUID();
  const subject = "account-" + crypto.randomUUID(), otherSubject = "account-" + crypto.randomUUID(), owner = "account-" + crypto.randomUUID();
  const channel = "fixture-share-" + crypto.randomUUID();
  const current: Card = { id: crypto.randomUUID(), workspace, title: world.title, revision: "edition-2" };
  const similar: Card = { id: crypto.randomUUID(), workspace: otherWorkspace, title: world.title, revision: "edition-2" };
  const candidates = [current, similar].sort((a, b) => a.id.localeCompare(b.id));
  const assignment: Assignment = { goal: world.goal, workspace, document: current.id, user: subject, purpose: world.purpose, candidates };
  const currentAuthor = world.role === "author" && world.change !== "object-reowned" ? subject : owner;
  const userId = world.change === "other-recipient" ? otherSubject : subject;
  const record: ChannelInvite = {
    channelId: channel, channelTargetId: "do:workers/pubsub-channel:PubSubChannel:" + channel,
    userId, memberId: "user:" + userId, handle: "reviewer", addedBy: "user:" + currentAuthor, addedAt: 57,
  };
  const projection = await ports.project({ invite: record, state: world.state, oldReceipt: world.change === "old-invite" });
  const original = { ...current, author: currentAuthor, body: "Notes for the " + world.title + " current edition.\n" };
  const neighboring = { ...similar, author: owner, body: "Same title in the entirely separate workspace.\n" };
  const auth: Approval = {
    workspace: world.change === "other-workspace" ? otherWorkspace : workspace,
    document: world.change === "other-workspace" ? similar.id : current.id,
    revision: world.change === "old-object" ? "edition-1" : current.revision,
    digest: world.change === "old-object" || world.change === "edited-content" ? digest("Superseded content") : digest(original.body),
    recipient: userId, invitationRevision: world.change === "old-invite" ? 1 : projection.currentRevision,
    role: world.role,
    status: world.change === "declined" || world.change === "withdrawn" || world.change === "pending" ? world.change : "approved",
  };
  const folder = await files.mkdtemp("workspace-share-review");
  const currentPath = folder + "/current.json", neighborPath = folder + "/neighbor.json";
  const grantPath = folder + "/grant.json", memberPath = folder + "/membership.json", invitePath = folder + "/inbox.json";
  const fixture = new Map([
    [currentPath, JSON.stringify(original)],
    [neighborPath, JSON.stringify(neighboring)],
    [grantPath, JSON.stringify(auth)],
    [memberPath, JSON.stringify({ workspace, user: subject, ...fixtureMembership(world, subject) })],
    [invitePath, JSON.stringify(projection)],
  ]);
  for (const [path, body] of fixture) await files.writeFile(path, body);
  const read = async <T>(path: string): Promise<T> => JSON.parse(decoder.decode(await readBytes(path, 16384)));
  const priorOutputs = (await files.readdir("/.tmp")).filter(name => artifactNames.test(name));
  const writer = bindScratchHandoff(files, { goal: world.goal, sources: [{ id: "scope", path: grantPath }],
    questions: ["Which owned role supports an exact private handoff?"] }, readBytes);

  async function observe() {
    const [object, authority, actor, projection, session] = await Promise.all([
      read<typeof original>(currentPath), read<Approval>(grantPath), read<Membership & { workspace: string; user: string }>(memberPath),
      read<InviteProjection>(invitePath), ports.session(),
    ]);
    const invite = channelInviteFromNotification(projection.retained);
    const pending = projection.pending && channelInviteFromNotification(projection.pending);
    const expectedInbox = projection.inbox === "pending" ? pending?.channelId === channel && pending.userId === invite?.userId &&
      projection.pending?.id === channelInviteNotificationId(channel) && projection.pending?.revision === projection.currentRevision :
      projection.pending === null;
    const exact = Boolean(invite && invite.userId === projection.retained.userId && invite.channelId === channel &&
      invite.channelTargetId === record.channelTargetId && invite.memberId === "user:" + invite.userId &&
      invite.addedBy === "user:" + object.author && projection.retained.id === channelInviteNotificationId(channel) && expectedInbox);
    const { body, ...card } = object;
    return { object: { ...card, digest: digest(body) }, session,
      member: { workspaceRole: actor.workspaceRole, accountRole: actor.accountRole, revoked: actor.revoked,
        active: actor.active && actor.workspace === workspace && actor.user === subject },
      invitation: { user: invite?.userId ?? null, channel: invite?.channelId ?? null, revision: projection.retained.revision ?? null,
        currentRevision: projection.currentRevision, member: projection.member, action: projection.action, inbox: projection.inbox, exact },
      approval: authority };
  }

  type Observation = Awaited<ReturnType<typeof observe>>;
  type Outcome = { assignment: Assignment; observation: Observation; finding: { decision: Decision; reason: string }; handoff: Handoff | null };
  function decisionFor(observation: Observation): Decision {
    const { object, member, invitation, approval, session } = observation;
    if (approval.workspace !== assignment.workspace || approval.document !== assignment.document ||
        object.workspace !== assignment.workspace || object.id !== assignment.document) return "hold-workspace";
    if (approval.recipient !== assignment.user || invitation.user !== null && invitation.user !== assignment.user) return "hold-recipient";
    if (member.revoked || invitation.action === "delete") return "hold-revoked";
    if (!session.admitted || !member.active || !invitation.member) return "hold-membership";
    if (approval.revision !== object.revision || approval.digest !== object.digest) return "hold-revision";
    if (!invitation.exact || invitation.revision !== invitation.currentRevision ||
        approval.invitationRevision !== invitation.currentRevision) return "hold-invite";
    if (approval.status === "declined" || approval.status === "withdrawn") return "hold-declined";
    if (approval.status === "pending") return "hold-pending";
    switch (assignment.purpose) {
      case "inspect": return approval.role === "none" ? "hold-role" : "inspect-current";
      case "author-note": return approval.role === "author" && object.author === assignment.user ? "stage-author" : "hold-role";
      case "review-note": return approval.role === "reviewer" ? "stage-reviewer" : "hold-role";
      case "reader-note": return approval.role === "reader" || approval.role === "reviewer" ? "stage-reader" : "hold-role";
    }
  }
  const canStage = (decision: Decision) => decision === "stage-author" || decision === "stage-reviewer" || decision === "stage-reader";
  const packet = (observation: Observation, decision: Decision) =>
    JSON.stringify({ schema: "workspace-share-private-handoff/1", workspace: assignment.workspace, document: assignment.document,
      recipient: assignment.user, observation, decision }, null, 2) + "\n";
  const effects: Effect[] = [];
  let discovered = false;
  let inspected: Observation | null = null;
  let staged: Handoff | null = null;
  let writing = false;
  const capture = <T>(service: string, method: string, args: unknown[], result: T): T => {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };
  async function readOnlyFixturesIntact() {
    return (await Promise.all([...fixture].map(async ([path, body]) => decoder.decode(await readBytes(path, 16384)) === body))).every(Boolean);
  }
  const services = {
    workspaceShareEvidence: {
      async discover() {
        if (discovered) throw new Error("Discover the exact owned share review once");
        discovered = true;
        return capture("workspaceShareEvidence", "discover", [], assignment);
      },
      async inspect(id: string) {
        if (!discovered || inspected || id !== assignment.document) throw new Error("Read only the exact assigned shared object");
        inspected = await observe();
        return capture("workspaceShareEvidence", "inspect", [id], inspected);
      },
    },
    workspaceShareHandoff: {
      async stage(observation: Observation, decision: Decision) {
        if (staged || writing || !inspected) throw new Error("Stage one private handoff only after verifying its exact shared object");
        writing = true;
        try {
          const [actual, current, intact] = await Promise.all([observe(), ports.vcs.status({ contextId: ports.contextId }), readOnlyFixturesIntact()]);
          if (!isDeepStrictEqual(actual, inspected) || !isDeepStrictEqual(actual, observation) || !canStage(decision) ||
              decision !== decisionFor(actual) || !intact || before.mainEventId !== current.mainEventId ||
              !isDeepStrictEqual(before.workingHead, current.workingHead))
            return capture("workspaceShareHandoff", "stage", [observation, decision], null);
          const body = packet(actual, decision);
          const written = await writer.scratchHandoffWrite.stage(body);
          if (written) staged = { ...written, sha256: digest(body) };
          return capture("workspaceShareHandoff", "stage", [observation, decision], staged);
        } finally {
          writing = false;
        }
      },
    },
  };

  async function verify(value: unknown) {
    const report = value as { status?: string; skill?: string; outcome?: Outcome } | null;
    const outcome = report?.outcome;
    const [current, head, intact, filenames] = await Promise.all([
      observe(), ports.vcs.status({ contextId: ports.contextId }), readOnlyFixturesIntact(), files.readdir("/.tmp"),
    ]);
    const decision = decisionFor(current);
    const allowWrite = canStage(decision);
    const outputs = filenames.filter(name => artifactNames.test(name) && !priorOutputs.includes(name));
    const handoffMethods = effects.filter(({ service }) => service === "workspaceShareHandoff").map(({ method }) => method);
    let exactNote = staged === null && outputs.length === 0 && !allowWrite && handoffMethods.length === 0;
    if (allowWrite && staged && outputs.length === 1 && isDeepStrictEqual(handoffMethods, ["stage"])) {
      const bytes = await readBytes(staged.path, staged.bytes);
      const text = decoder.decode(bytes);
      exactNote = staged.path === "/.tmp/" + outputs[0] + "/handoff.json" && bytes.length === staged.bytes &&
        digest(text) === staged.sha256 && text === packet(current, decision);
    }
    const expectedReadMethods = ["discover", "inspect"];
    const checks = {
      selectedExactWorkspaceAndObject: discovered && inspected?.object.workspace === workspace &&
        inspected?.object.id === assignment.document && inspected?.object.digest === digest(original.body) &&
        isDeepStrictEqual(outcome?.assignment, assignment) &&
        isDeepStrictEqual(effects.filter(effect => effect.service === "workspaceShareEvidence").map(({ method }) => method), expectedReadMethods),
      readExactMembershipAndRole: isDeepStrictEqual(inspected?.member, current.member) &&
        isDeepStrictEqual(inspected?.session, current.session) && isDeepStrictEqual(outcome?.observation, current),
      reconciledExactInviteAndRevision: inspected?.invitation.currentRevision === projection.currentRevision &&
        inspected?.invitation.member === projection.member && isDeepStrictEqual(inspected?.invitation, current.invitation) &&
        isDeepStrictEqual(inspected?.approval, auth),
      matchedLocalScopeDecision: report?.status === "workspace-skill-reviewed" && report.skill === "workspaceShare" &&
        outcome?.finding?.decision === decision && typeof outcome.finding.reason === "string" &&
        outcome.finding.reason.trim().length > 0 && outcome.finding.reason.length <= 1200,
      verifiedPrivateHandoff: exactNote && isDeepStrictEqual(outcome?.handoff, staged),
      preservedSharedAndNeighborState: intact && priorOutputs.every(name => filenames.includes(name)) &&
        before.mainEventId === head.mainEventId && isDeepStrictEqual(before.workingHead, head.workingHead),
    };
    return { caseId: world.id, contextId: ports.contextId, goal: world.goal, passed: Object.values(checks).every(Boolean),
      checks, assignment, observation: current, decision, handoff: staged, effects: structuredClone(effects) };
  }
  async function qualify() {
    const assignment = await services.workspaceShareEvidence.discover();
    const observation = await services.workspaceShareEvidence.inspect(assignment.document);
    const decision = decisionFor(observation);
    const handoff = canStage(decision) ? await services.workspaceShareHandoff.stage(observation, decision) : null;
    return verify({ status: "workspace-skill-reviewed", skill: "workspaceShare", outcome: {
      assignment, observation, finding: { decision, reason: "Join the live membership, exact inbox evidence, current artifact and local object role." }, handoff,
    } });
  }
  return { services, qualify, verify };
}
