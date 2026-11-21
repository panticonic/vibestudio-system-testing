import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { contextId, fs, vcs } from "@workspace/runtime";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import { renderComponent } from "@workspace-skills/visualize/render";
import type { PresentationReport } from "@workspace-skills/visualize/types";
import type { prepareOpenCalendarGoal } from "@workspace-skills/open-calendar-goal/managed";
import type { NewsEvidenceReport } from "@workspace-skills/open-news-evidence/types";
import { prepareOpenNewsEvidenceWorld } from "./open-goal-news-evidence-managed.js";
import type { GoogleRunbookWorld, NewsEditionReviewWorld } from "./open-goal-product-owned-worlds.js";

type Input = { contextId: string; caseId: string };
type Calendar = Awaited<ReturnType<typeof prepareOpenCalendarGoal>>;
type CalendarReport = Awaited<ReturnType<Calendar["qualify"]>>["report"];
type Document = { path: string; version: string; text: string };
type Basis = { documents: Document[]; authorization: string; currentRevision: string };
type Decision = { action: string; path: string | null; approval: string | null; reason: string };
type Write = { status: "written" | "changed" | "held"; path: string | null; version: string | null };
type Attribution = { kind: "attribution"; origin: "external-import"; references: string[]; supportedIntent: string | null; boundary: string };
type GoogleReport = { calendar: CalendarReport; decision: Decision; attribution: Attribution; write: Write | null };
type Desk = { id: string; revision: string; title: string; topic: string; format: string; facts: string; grant: string };
type EditorPlan = { action: string; format: string; revision: string; reason: string };
type Receipt = { path: string; bytes: number; sha256: string };
type NewsReport = { desk: Desk; news: NewsEvidenceReport; plan: EditorPlan; presentation: PresentationReport | null; artifact: Receipt | null; attribution: Attribution };
type Ports = { contextId: string; fs: typeof fs; status: typeof vcs.status };
const live: Ports = { contextId, fs, status: input => vcs.status(input) };
const length = (text: string) => new TextEncoder().encode(text).length;
type Call = { service: string; method: string; args: unknown[]; result: unknown };

function effects() {
  const calls: Call[] = [];
  function record<T>(service: string, method: string, args: unknown[], result: T): T {
    calls.push({ service, method, args: structuredClone(args), result: structuredClone(result) });
    return structuredClone(result);
  }
  return { calls, record };
}
function reportOf<T>(raw: unknown, skill: string): T | null {
  const root = raw as { status?: string; skill?: string; outcome?: T } | null;
  return root?.status === "workspace-skill-reviewed" && root.skill === skill ? root.outcome ?? null : null;
}
function attribute(source: string | null, action: string, intent: string | null, boundary: string): Attribution {
  return { kind: "attribution", origin: "external-import",
    references: source ? [source, action] : [action], supportedIntent: intent, boundary };
}
async function readText(port: Ports, path: string) {
  const text = await port.fs.readFile(path, "utf8");
  if (typeof text !== "string") throw new Error("Expected an exact owned text file");
  return text;
}

export async function prepareGoogleRunbook(input: Input, world: GoogleRunbookWorld, calendar: Calendar, ports = live) {
  if (ports.contextId !== input.contextId || input.caseId !== world.id) throw new Error("Wrong Calendar runbook workspace");
  const originalWorkspace = await ports.status({ contextId: input.contextId });
  const directory = await ports.fs.mkdtemp("google-runbook");
  const target = "operations-runbook.md";
  const approvalPath = "approved-instructions.md";
  const scopePath = "local-draft-scope.txt";
  const source = {
    [target]: world.before,
    [approvalPath]: world.approval,
    [scopePath]: world.authorization,
    "archive-reference.md": "# Historical instructions\nDo not use this copy for current operations.\n",
  };
  const paths = Object.keys(source) as Array<keyof typeof source>;
  await Promise.all(paths.map(path => ports.fs.writeFile(directory + "/" + path, source[path])));
  const { calls, record } = effects();
  const bases: Basis[] = [];
  let applied: Write | null = null;
  let coedited = false;
  let applying = false;
  async function basis(): Promise<Basis> {
    const documents = await Promise.all(paths.map(async path => {
      const text = await readText(ports, directory + "/" + path);
      return { path, version: sha256HexSyncText(text), text };
    }));
    return { documents, authorization: documents.find(doc => doc.path === scopePath)!.text,
      currentRevision: sha256HexSyncText(JSON.stringify(documents.map(({ path, version }) => [path, version]))) };
  }
  const services = {
    ...calendar.services,
    googleRunbook: {
      async read() {
        const viewed = await basis();
        bases.push(viewed);
        return record("googleRunbook", "read", [], viewed);
      },
      async apply(review: CalendarReport, proposal: Document): Promise<Write> {
        const args = [review, proposal];
        const held: Write = { status: "held", path: null, version: null };
        if (applying || applied || proposal?.path !== target || typeof proposal.text !== "string" || length(proposal.text) > 16_000 ||
            !bases.some(basis => basis.documents.some(doc => doc.path === target && doc.version === proposal.version)))
          return record("googleRunbook", "apply", args, held);
        applying = true;
        try {
          const current = await basis();
          const approved = current.documents.find(doc => doc.path === approvalPath)!.text;
          const document = current.documents.find(doc => doc.path === target)!;
          const selected = review?.decision?.selection;
          const time = selected?.startsAt?.slice(11, 16);
          const venue = selected?.description.replace(/^Venue: /u, "");
          const workspace = await ports.status({ contextId: input.contextId });
          if (current.authorization !== "private-draft" || !time || !venue ||
              !approved.includes(time + " UTC") || !approved.includes(venue) || !(await calendar.verify(review)).passed ||
              !isDeepStrictEqual(workspace, originalWorkspace)) return record("googleRunbook", "apply", args, held);
          if (world.coedit && !coedited) {
            coedited = true;
            await ports.fs.writeFile(directory + "/" + target, document.text + world.coedit);
            const updated = sha256HexSyncText(document.text + world.coedit);
            return record("googleRunbook", "apply", args, { status: "changed", path: target, version: updated });
          }
          if (proposal.version !== document.version)
            return record("googleRunbook", "apply", args, { status: "changed", path: target, version: document.version });
          const temporary = directory + "/.pending";
          await ports.fs.writeFile(temporary, proposal.text);
          await ports.fs.rename(temporary, directory + "/" + target);
          const version = sha256HexSyncText(await readText(ports, directory + "/" + target));
          if (version !== sha256HexSyncText(proposal.text)) throw new Error("The runbook write did not survive exact readback");
          applied = { status: "written", path: target, version };
          return record("googleRunbook", "apply", args, applied);
        } finally { applying = false; }
      },
    },
  };
  const approvalId = world.approval.match(/APP-[A-Z]+/u)?.[0] ?? null;
  const mapping = (report: CalendarReport, original: Basis) => {
    const selected = report.decision.selection;
    return attribute(selected ? "calendar:" + selected.calendarId + "/" + selected.eventId : null,
      "runbook:" + original.currentRevision, world.action === "revise" ? approvalId : null, "private-workspace");
  };
  async function verify(raw: unknown) {
    const report = reportOf<GoogleReport>(raw, "googleRunbook");
    const current = await basis();
    const workspace = await ports.status({ contextId: input.contextId });
    const calendarProof = report && await calendar.verify(report.calendar);
    const targetNow = current.documents.find(doc => doc.path === target)!;
    const wanted = world.action === "revise" ? world.after + (world.coedit ?? "") : world.before;
    const writingCalls = calls.filter(call => call.method === "apply");
    const checks = {
      current_calendar: calendarProof?.passed === true && report?.calendar.handoff === null,
      runbook_authority: report?.decision.action === world.action && report.decision.path === target &&
        report.decision.approval === approvalId && !!report.decision.reason.trim(),
      exact_basis_attribution: !!report && !!bases[0] && isDeepStrictEqual(report.attribution, mapping(report.calendar, bases[0])),
      exact_runbook_result: targetNow.text === wanted && (world.action === "revise"
        ? !!applied && isDeepStrictEqual(report?.write, applied) && applied.version === targetNow.version &&
          writingCalls.length === (world.coedit ? 2 : 1) && (!world.coedit ||
            coedited && (writingCalls[0].result as Write).status === "changed" &&
            (writingCalls[0].args[1] as Document).version !== (writingCalls[1].args[1] as Document).version)
        : !applied && report?.write === null && !writingCalls.length),
      preserved_workspace: isDeepStrictEqual(workspace, originalWorkspace) && current.documents.every(doc =>
        doc.path === target || doc.text === source[doc.path as keyof typeof source]),
    };
    return { ...input, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      productReview: { calls: structuredClone(calls), bases, report, calendar: calendarProof } };
  }
  async function qualify() {
    const original = await services.googleRunbook.read();
    const { report: scheduled } = await calendar.qualify();
    const decision = { action: world.action, path: target, approval: approvalId, reason: "Respect the current exact Calendar and the retained authority." };
    let write: Write | null = null;
    if (world.action === "revise") {
      const apply = (observed: Basis) => services.googleRunbook.apply(scheduled,
        { ...observed.documents.find(doc => doc.path === target)!, text: world.after + (coedited ? world.coedit : "") });
      write = await apply(original);
      if (write.status === "changed") write = await apply(await services.googleRunbook.read());
      await services.googleRunbook.read();
    }
    return verify({ status: "workspace-skill-reviewed", skill: "googleRunbook",
      outcome: { calendar: scheduled, decision, attribution: mapping(scheduled, original), write } });
  }
  return { services, verify, qualify };
}

type Installed = Parameters<typeof prepareOpenNewsEvidenceWorld>[1];
type NativeNews = Awaited<ReturnType<typeof prepareOpenNewsEvidenceWorld>>;
export async function prepareNewsEditionReview(input: Input, world: NewsEditionReviewWorld, installed: Installed,
  ports = live, openNews: () => Promise<NativeNews> = () => prepareOpenNewsEvidenceWorld(input, installed, world.news)) {
  if (input.contextId !== ports.contextId || world.id !== input.caseId) throw new Error("Wrong private editorial workspace");
  const workspace = await ports.status({ contextId: input.contextId });
  const news = await openNews();
  const directory = await ports.fs.mkdtemp("news-editorial-desk");
  const file = directory + "/editor-brief.json";
  const publishedDesk = { id: "desk:" + world.id, title: world.title, topic: world.news.topic,
    format: world.format, facts: world.facts, grant: world.grant };
  const initial = JSON.stringify(world.superseded ? [publishedDesk, { ...publishedDesk, grant: "withdrawn" }] : [publishedDesk]);
  await ports.fs.writeFile(file, initial);
  const writer = bindScratchHandoff({
    mkdtemp: () => ports.fs.mkdtemp("news-editor-review"),
    rename: (...args) => ports.fs.rename(...args),
    rm: (...args) => ports.fs.rm(...args),
    writeFile: (...args) => ports.fs.writeFile(...args),
    open: (...args) => ports.fs.open(...args),
  }, {
    goal: world.goal, sources: [{ id: publishedDesk.id, path: file }], questions: ["What does the current edition support?"],
  }, async (path, limit) => {
    const bytes = new TextEncoder().encode(await readText(ports, path));
    if (bytes.byteLength > limit) throw new Error("Editorial packet exceeds the assigned bytes");
    return bytes;
  }).scratchHandoffWrite;
  async function currentDesk(): Promise<Desk> {
    const body = await readText(ports, file);
    const retained = JSON.parse(body);
    return { ...retained.at(-1), revision: sha256HexSyncText(body) };
  }
  const { calls, record } = effects();
  let observed: Desk | null = null;
  let artifact: Receipt | null = null;
  let authoring = false;
  const wrap = (outcome: NewsEvidenceReport) => ({ status: "workspace-skill-reviewed", skill: "newsEvidence", outcome });
  const expectedPresentation: PresentationReport = {
    views: [{ id: publishedDesk.id, status: "ready", rendered: renderComponent(world.spec) }], omitted: [],
  };
  function exactPresentation(presentation: PresentationReport | null) {
    const view = presentation?.views[0];
    if (presentation?.views.length !== 1 || presentation.omitted.length !== 0 ||
        view?.status !== "ready" || view.id !== publishedDesk.id ||
        view.rendered.component !== world.spec.component || !isDeepStrictEqual(view.rendered.props, world.spec.props)) return false;
    return view.rendered.mdx === renderComponent(view.rendered).mdx;
  }
  const encode = (desk: Desk, basis: NewsEvidenceReport, presentation: PresentationReport) =>
    JSON.stringify({ desk, edition: basis.briefing?.input.briefingId ?? null, through: basis.plan.through,
      articles: basis.sources.map(({ articleId, url, digest }) => ({ articleId, url, digest })), presentation }, null, 2) + "\n";
  const attribution = (desk: Desk, basis: NewsEvidenceReport, action: string) =>
    attribute(basis.sources[0]?.url ?? null, "edition:" + desk.revision, action === "packet" ? desk.id : null, "private-news-review");
  const services = {
    ...news.services,
    newsEditionReview: {
      async readDesk() {
        observed = await currentDesk();
        return record("newsEditionReview", "readDesk", [], observed);
      },
      async stage(desk: Desk, plan: EditorPlan, basis: NewsEvidenceReport, presentation: PresentationReport) {
        const args = [desk, plan, basis, presentation];
        if (authoring || artifact || !observed || !isDeepStrictEqual(observed, desk) ||
          plan?.action !== "packet" || plan.revision !== desk.revision ||
          desk.grant !== "private-draft" || basis?.briefing?.result.status !== "ready" ||
          basis.plan.action !== "report" || !basis.sources.length || !exactPresentation(presentation))
          return record("newsEditionReview", "stage", args, null);
        authoring = true;
        try {
          if (!isDeepStrictEqual(await currentDesk(), desk) || !(await news.verify(wrap(basis))).passed ||
              !isDeepStrictEqual(await ports.status({ contextId: input.contextId }), workspace))
            return record("newsEditionReview", "stage", args, null);
          const body = encode(desk, basis, presentation);
          const staged = await writer.stage(body);
          artifact = staged ? { ...staged, sha256: sha256HexSyncText(body) } : null;
          return record("newsEditionReview", "stage", args, artifact);
        } finally { authoring = false; }
      },
    },
  };
  async function verify(raw: unknown) {
    const report = reportOf<NewsReport>(raw, "newsEditionReview");
    const proof = report && await news.verify(wrap(report.news));
    const latest = await currentDesk();
    const body = artifact && await readText(ports, artifact.path);
    const checks = {
      current_news_edition: proof?.passed === true && report?.news.handoff === null,
      exact_desk_authority: !!observed && !!report && isDeepStrictEqual(observed, latest) && isDeepStrictEqual(report.desk, latest) &&
        report.plan.revision === latest.revision && report.plan.action === world.action && report.plan.format === world.format && !!report.plan.reason.trim(),
      exact_basis_attribution: !!report && isDeepStrictEqual(report.attribution, attribution(latest, report.news, world.action)),
      verified_editor_packet: world.action === "packet" ? !!report && !!body && !!artifact &&
        !!report.presentation && exactPresentation(report.presentation) && isDeepStrictEqual(report.artifact, artifact) &&
        body === encode(latest, report.news, report.presentation) && length(body) === artifact.bytes && sha256HexSyncText(body) === artifact.sha256
        : !artifact && report?.artifact === null && report.presentation === null && calls.every(call => call.method !== "stage"),
      preserved_workspace: await readText(ports, file) === initial &&
        isDeepStrictEqual(await ports.status({ contextId: input.contextId }), workspace),
    };
    return { ...input, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      productReview: { calls: structuredClone(calls), report, news: proof, body } };
  }
  async function qualify() {
    const desk = await services.newsEditionReview.readDesk();
    const { report: basis } = await news.qualify();
    const plan = { action: world.action, format: world.format, revision: desk.revision, reason: "Use the current reader and latest desk evidence." };
    const presentation = world.action === "packet" ? expectedPresentation : null;
    const artifact = presentation && await services.newsEditionReview.stage(desk, plan, basis, presentation);
    return verify({ status: "workspace-skill-reviewed", skill: "newsEditionReview",
      outcome: { desk, news: basis, plan, presentation, artifact, attribution: attribution(desk, basis, world.action) } });
  }
  return { services, verify, qualify };
}
