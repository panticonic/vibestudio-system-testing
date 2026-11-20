export type ScopeVariant = "current" | "previous-boot" | "previous-config" | "other-machine";
type Model = "qwen3.8-27b" | "lfm3-1.7b" | "lfm2.5-2.6b";
type State = "ready" | "startable" | "not-installed" | "starting" | "downloading" | "error";
type Lane = "main" | "utility";
export type WidthDisposition = "verified" | "startable" | "model-unavailable" | "provider-unavailable" | "incompatible" | "unproven-width" | "short-width";
type Entry = { model: Model; state: State; lane: Lane; context: number; tools: boolean };
type Provider = { key: string; model: Model; scope: ScopeVariant; lane: Lane; context: number; selectable: boolean; tools: boolean };
type Server = { scope: ScopeVariant; lane: Lane; models: Model[]; width: number; running: boolean };
type Interval = { id: string; start: number; end: number; context: number; tools: boolean; terminal: "complete" | "failed" | "cancelled" };
type Receipt = { provider: string; model: Model; scope: ScopeVariant; lane: Lane; intervals: Interval[] };
export type LocalWidthWorld = {
  id: string; kind: "local-width"; workspace: "system"; sourceGroup: string; split?: "test";
  machine: string; goal: string; desired: { model: Model; alternate: boolean; lanes: number; context: number; tools: boolean };
  models: Entry[]; providers: Provider[]; servers: Server[]; receipts: Receipt[];
  release: "none" | "verified" | "include-hold";
  expected: WidthDisposition;
};
export const openLocalWidthRequiresUnits = ["skills/open-user-goal", "skills/local-models", "skills/scratch-handoff-bindings"];

const qwen: Model = "qwen3.8-27b";
const lfm: Model = "lfm3-1.7b";
const fallback: Model = "lfm2.5-2.6b";
const context = 16_384;
const model = (model: Model = qwen, state: State = "ready", patch: Partial<Entry> = {}): Entry => ({
  model, state, tools: true, context: 32_768, lane: model === qwen ? "main" : "utility", ...patch,
});
const provide = (model: Model = qwen, options: Partial<Provider> = {}): Provider =>
  ({ key: model, model, scope: "current", selectable: true, tools: true, context: 32_768, lane: model === qwen ? "main" : "utility", ...options });
const server = (width = 4, models: Model[] = [qwen], options: Partial<Server> = {}): Server =>
  ({ scope: "current", running: true, lane: "main", models, width, ...options });
const done = (id: string, start: number, end: number, patch: Partial<Interval> = {}): Interval =>
  ({ id, start, end, context, tools: true, terminal: "complete", ...patch });
const overlap = () => [done("first", 0, 10), done("second", 2, 9)];
const receipt = (intervals = overlap(), options: Partial<Receipt> = {}): Receipt =>
  ({ provider: qwen, model: qwen, scope: "current", lane: "main", intervals, ...options });
function scenario(id: string, machine: string, goal: string, expected: WidthDisposition,
  options: Partial<Pick<LocalWidthWorld, "desired" | "models" | "providers" | "servers" | "receipts" | "release">> & { held?: true } = {},
): LocalWidthWorld {
  const desired = options.desired ?? { model: qwen, alternate: false, lanes: 2, context, tools: true };
  return {
    id: "local-width-" + id, kind: "local-width", workspace: "system", sourceGroup: "vibestudio:local-width:" + id,
    ...(options.held ? { split: "test" } : {}), machine, goal, expected, desired,
    models: options.models ?? [model(), model(lfm, "startable")],
    providers: options.providers ?? [provide()], servers: options.servers ?? [server()],
    receipts: options.receipts ?? [receipt()], release: options.release ?? "none",
  };
}

export const openLocalWidthWorlds = [
  scenario("dispatch-two-proven", "Dispatch bench",
    "Could the Dispatch bench run two local Qwen review branches with tools and 16K of context each? I need a local handoff if the two ran together in the recorded evidence.", "verified",
    { release: "verified" }),
  scenario("faceplate-expansive-but-serial", "Front desk bench",
    "The Front desk bench says four slots. Can its current Qwen cover our two concurrent 16K tool reviews? Save a short local note explaining the usable width even if we should hold both branches.", "short-width",
    { receipts: [receipt([done("first", 0, 5), done("second", 5, 9)])], release: "include-hold" }),
  scenario("catalog-running-but-provider-hidden", "Projection kiosk",
    "Qwen appears to be running on Projection kiosk. Can the workspace actually select it for two 16K tool-backed steps? Keep this a read-only check.", "provider-unavailable",
    { providers: [provide(qwen, { selectable: false })] }),
  scenario("older-selectable-on-other-machine", "Studio cart",
    "Studio cart and the old editing tower show the same Qwen name. Check that this workspace can select the cart's current model for two simultaneous 16K tool reviews. Don't leave a handoff using the tower's settings.", "provider-unavailable",
    { providers: [provide(qwen, { scope: "other-machine" })], release: "verified" }),
  scenario("loaded-names-no-legitimate-candidacy", "Intake office",
    "The Intake office server claims Qwen is loaded. Our current local option still says it is starting. Can it take two 16K tool branches now? Give me the current state without starting anything.", "model-unavailable",
    { models: [model(qwen, "starting"), model(lfm, "ready")] }),
  scenario("startable-is-a-readiness-result", "Archives workstation",
    "Determine whether Archives workstation can start Qwen for two 16K tool reviewers later today and whether its recorded proof establishes that they'll overlap. Leave a local readiness note even if width is still unknown.", "startable",
    { models: [model(qwen, "startable")], servers: [server(4, [], { running: false })], release: "include-hold" }),
  scenario("catalog-tools-true-provider-tools-false", "Conservation station",
    "Conservation station shows tool support for local Qwen in the model inventory. Check whether the selected workspace provider can actually route two 16K tool branches. Leave the comparison in local scratch if any restriction blocks it.", "incompatible",
    { providers: [provide(qwen, { tools: false })], release: "include-hold" }),
  scenario("provider-context-smaller-than-advertised", "Operations room",
    "The Operations room's local Qwen advertises a large context. Can the chosen provider support two tool branches each carrying 16K? No handoff unless the current evidence genuinely supports it.", "incompatible",
    { providers: [provide(qwen, { context: 8192 })], release: "verified" }),
  scenario("three-advertised-two-completes", "Evening ticket desk",
    "We need three simultaneous 16K Qwen tool checks at the Evening ticket desk. The retained load test includes completed work and a cancelled third branch. Tell me how many we can actually rely on.", "short-width",
    { desired: { model: qwen, alternate: false, lanes: 3, context, tools: true }, receipts: [receipt([
      ...overlap(), done("third", 1, 12, { terminal: "cancelled" }),
    ])] }),
  scenario("short-context-width-cannot-be-scaled", "Text review station",
    "Can the Text review station carry two 16K tool-enabled Qwen reviewers through at once? Its old performance note counted overlapping short requests. Hold the handoff if that evidence is at the wrong context size.", "unproven-width",
    { receipts: [receipt([done("one", 0, 10, { context: 1024 }), done("two", 2, 8, { context: 1024 })])], release: "verified" }),
  scenario("proof-from-prior-boot", "Learning lab",
    "The Learning lab rebooted after the last Qwen concurrency check. Confirm whether the current boot supports two 16K tool tasks on the evidence we actually have. File the limitation in final local notes.", "unproven-width",
    { receipts: [receipt(overlap(), { scope: "previous-boot" })], release: "include-hold" }),
  scenario("wider-candidate-selectable-alternative", "Exchange processing",
    "At Exchange processing prefer Qwen, but use the installed small local model if Qwen can't meet two 16K tool reviews and the exact alternative has proof. File only the usable model's evidence.", "verified",
    { desired: { model: qwen, alternate: true, lanes: 2, context, tools: true },
      models: [model(qwen, "downloading"), model(lfm)], providers: [provide(), provide(lfm)],
      servers: [server(), server(2, [lfm], { lane: "utility" })],
      receipts: [receipt(overlap(), { model: lfm, provider: lfm, lane: "utility" })], release: "verified" }),
  scenario("empty-prefill-img", "Evening screen",
    "The Evening screen's running main server lists a different local model than Qwen. Can we truly route two 16K tool branches on Qwen? Keep the workstation unchanged.", "unproven-width",
    { servers: [server(8, [fallback])] }),
  scenario("measured-two-reports-cannot-merge", "Material intake",
    "Material intake kept two Qwen records but took them in separate runs. Can that establish two simultaneous 16K tool branches? Leave a local note describing what was actually observed.", "short-width",
    { receipts: [receipt([done("A", 1, 8)]), receipt([done("B", 2, 9)])], release: "include-hold" }),
  scenario("actual-proof-wider-than-conservative-display", "Press desk",
    "The Press desk display still says one Qwen slot. Compare that advert with the retained current proof of two overlapping 16K tool jobs. Save the discrepancy locally if the work really completed.", "verified",
    { servers: [server(1)], release: "verified" }),
  scenario("held-old-config-after-settings-edit", "Safety audit console",
    "The Safety audit console changed its Qwen execution configuration after an otherwise successful two-branch 16K tool check. Is there current evidence at the new settings? Don't recycle the old receipt for a local green light.", "unproven-width",
    { receipts: [receipt(overlap(), { scope: "previous-config" })], release: "verified", held: true }),
  scenario("held-fallback-installed-engine-error", "Public reading desk",
    "At the Public reading desk verify whether local Qwen can take two 16K tool branches. The engine error and the warmed fallback are both visible, but the job requires Qwen. Save only an authorized note describing the blocker.", "model-unavailable",
    { models: [model(qwen, "error"), model(fallback, "ready")], release: "include-hold", held: true }),
  scenario("held-provider-width-identity-joins", "Incident station",
    "The Incident station lists two Qwen providers after a replacement. Can the currently selectable route attest two 16K tool branches? Leave a local note only if a receipt belongs to that exact provider.", "verified",
    { providers: [provide(qwen, { key: "old-route", scope: "previous-config" }), provide(qwen, { key: "current-route" })],
      receipts: [receipt(overlap(), { provider: "old-route" }), receipt(overlap(), { provider: "current-route" })],
      release: "verified", held: true }),
  scenario("held-duplicate-terminal-events-are-one-job", "Community archive",
    "Community archive kept several completion rows for two Qwen review branches. Verify two distinct 16K tool jobs overlapped before leaving a local note. A duplicate completion event shouldn't count as another job.", "short-width",
    { receipts: [receipt([done("same", 0, 9), done("same", 1, 8), done("second", 9, 12)])], release: "verified", held: true }),
  scenario("held-tool-usage-and-context-both-required", "Survey desk",
    "The Survey desk needs two concurrent 16K Qwen reviews that can finish real tool work. The archived batch mixed plain-text completions with tool-use completions. Save a local explanation only within the desk's approved scope.", "short-width",
    { receipts: [receipt([done("plain", 0, 12, { tools: false }), done("tool", 1, 9), done("short-tool", 2, 7, { context: 8192 })])],
      release: "include-hold", held: true }),
];
