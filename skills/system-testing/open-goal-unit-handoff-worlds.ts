type Change = "none" | "activation" | "invalid-dependency" | "invalid-icon" | "invalid-json" |
  "metadata-only" | "code-only" | "damaged-artwork";
type Icon = { family: "brand" | "lucide" | "emoji"; term: string };
type Focus = "manifest" | "identity" | "joined";
type Grant = "inspect" | "working-icon" | "protected-match-icon";
type Unit = { path: string; name: string; kind: string; description: string };
const unit = (path: string, description: string): Unit => {
  const [kind, name] = path.split("/");
  if (!kind || !name) throw new Error("Unit inventory requires an exact installed path");
  return { path, name, kind: kind.slice(0, kind === "about" ? undefined : -1), description };
};
const units = {
  pdf: unit("extensions/pdf-ingest", "Local PDF probing and ingestion"),
  file: unit("extensions/file-tools", "Workspace file search and find operations"),
  bridge: unit("extensions/git-bridge", "Connects Git repositories to the workspace"),
  shell: unit("extensions/shell", "Supervises local shell sessions and command runners"),
  speech: unit("extensions/speech", "Local speech and dictation"),
  image: unit("extensions/image-service", "Local image metadata and workspace-backed image assets"),
  extensionTemplates: unit("extensions/templates", "Finds installed workspace templates"),
  chat: unit("panels/chat", "The interactive agent conversation panel"),
  terminal: unit("panels/terminal", "Interactive workspace terminal view"),
  natlang: unit("panels/natlang", "Inspect a natural-language program and its work"),
  modelSettings: unit("workers/model-settings", "Owns model preferences"),
  records: unit("workers/natlang-records", "Retains Natlang execution records"),
  source: unit("workers/workspace-source", "Workspace source and revision ownership"),
  aboutWorkspace: unit("about/workspace", "About page for the installed workspace"),
  aboutHelp: unit("about/help", "About page with local help and guidance"),
  aboutTemplates: unit("about/templates", "About page describing available workspace templates"),
};
type Options = {
  focus?: Focus;
  change?: Change;
  grant?: Grant;
  icon?: Icon;
  stageIcon?: boolean;
  requireProtectedSource?: boolean;
  lifecycle?: boolean;
  held?: true;
  also?: (keyof typeof units)[];
};
export type OpenUnitHandoffWorld = {
  id: string;
  kind: "unit-handoff";
  workspace: "system";
  sourceGroup: string;
  split?: "test";
  goal: string;
  inventory: Unit[];
  target: Unit | null;
  focus: Focus;
  change: Change;
  grant: Grant;
  icon: Icon | null;
  stageIcon: boolean;
  requireProtectedSource: boolean;
  lifecycle: boolean;
};
function world(id: string, key: keyof typeof units | null, goal: string, options: Options = {}): OpenUnitHandoffWorld {
  const target = key ? units[key] : null;
  const inventory = [...(target ? [target] : []), ...(options.also ?? []).map(name => units[name])];
  return {
    id: "unit-handoff-" + id, kind: "unit-handoff", workspace: "system",
    sourceGroup: "vibestudio:unit-handoff:" + id, ...(options.held ? { split: "test" } : {}),
    goal, inventory, target, focus: options.focus ?? "manifest", change: options.change ?? "none",
    grant: options.grant ?? "inspect", icon: options.icon ?? null, stageIcon: options.stageIcon ?? false,
    requireProtectedSource: options.requireProtectedSource ?? false, lifecycle: options.lifecycle ?? false,
  };
}
const lucide = (term: string): Icon => ({ family: "lucide", term });
const brand = (term: string): Icon => ({ family: "brand", term });
const emoji = (term: string): Icon => ({ family: "emoji", term });

export const openUnitHandoffRequiresUnits = [
  "skills/open-user-goal", "skills/workspace-unit-design", "skills/workspace-dev", "skills/extensiondev",
  "skills/unit-identity-bindings", ...Object.values(units).map(unit => unit.path),
];

export const openUnitHandoffWorlds = [
  world("pdf-working-startup", "pdf",
    "The PDF ingest owner wants to circulate the local startup change for review. Compare what the manifest says in our draft and on protected main. Tell me which owner still needs to sign off before anyone treats this as deployed.",
    { change: "activation", also: ["image"] }),
  world("file-tools-dependency-regression", "file",
    "A maintainer says the File tools candidate is safe because the installed finder still works. Review the candidate package’s dependency loading mode against the protected version. Tell me which copy needs fixing and leave both copies alone.",
    { change: "invalid-dependency", also: ["extensionTemplates"] }),
  world("shell-build-after-comment", "shell",
    "The shell runner has an implementation-only edit. We need a release-review answer that distinguishes a matching package manifest from a retained build of this exact working tree. Look at the live evidence without starting a shell or running a build.",
    { change: "code-only", lifecycle: true, also: ["terminal"] }),
  world("speech-startup-claim", "speech",
    "Support is about to say Speech is live because the protected manifest is valid. Check whether the retained version and process actually support that statement for the installed Speech extension. Leave activation alone.",
    { lifecycle: true, also: ["file"] }),
  world("image-manifest-unreadable", "image",
    "The image service maintainer cannot tell whether the malformed package is a local editing accident or a protected release problem. Trace both manifest readings and advise which revision to reopen, without rewriting the broken document.",
    { change: "invalid-json", also: ["pdf"] }),
  world("templates-extension-vs-about", "extensionTemplates",
    "For the component that finds installed templates, check whether the package we are looking at includes the latest draft metadata on protected main. I mean the extension that does the lookup, not the About page with the same title.",
    { change: "metadata-only", also: ["aboutTemplates"] }),
  world("chat-icon-concept-only", "chat",
    "The chat team is weighing a message-square-check icon to distinguish resolved conversations. Confirm the installed artwork and tell me if that exact alternative exists in Lucide. This is a sketch review, so save nothing.",
    { focus: "identity", icon: lucide("message-square-check"), also: ["natlang"] }),
  world("terminal-visible-separate-shell", "terminal",
    "Give the interactive Terminal panel a local square-terminal Lucide icon draft so it stands apart from the service that actually manages shell sessions. Keep the shell service and published panel as they are.",
    { focus: "identity", icon: lucide("square-terminal"), grant: "working-icon", stageIcon: true, also: ["shell"] }),
  world("records-emoji-already-stored", "records",
    "Check whether the retained execution-records worker already uses the receipt emoji 🧾. If it is literally the same mark, leave it untouched. Only prepare a private change if it differs.",
    { focus: "identity", icon: emoji("🧾"), grant: "working-icon", stageIcon: true, also: ["source"] }),
  world("help-before-print", "aboutHelp",
    "Prepare the About Help page with the catalog's book-open icon for the private documentation review. Keep the workspace landing About page intact and confirm which manifest and artwork the review opens.",
    { focus: "identity", icon: lucide("book-open"), grant: "working-icon", stageIcon: true, also: ["aboutWorkspace"] }),
  world("workspace-index-damaged-svg", "aboutWorkspace",
    "The workspace landing icon still points to its usual asset path, but someone replaced the working SVG. Restore the exact Lucide folder-tree artwork as a working draft and verify the bytes, leaving protected main alone.",
    { focus: "identity", icon: lucide("folder-tree"), change: "damaged-artwork", grant: "working-icon", stageIcon: true, also: ["aboutHelp"] }),
  world("model-settings-queuing-readonly", "modelSettings",
    "A review ticket asks for a settings-2 icon for the worker that owns model preferences. The owner gave us inspection access only. Confirm the exact local catalog candidate and report what approval is missing for a working draft.",
    { focus: "identity", icon: lucide("settings-2"), stageIcon: true, also: ["records"] }),
  world("natlang-offline-icon-unavailable", "natlang",
    "I want the exact Lucide catalog icon natlang-draft-burst for the Natlang panel, if we actually ship it. Prepare a working icon only if that exact symbol exists. Don't replace it with a similar icon.",
    { focus: "identity", icon: lucide("natlang-draft-burst"), grant: "working-icon", stageIcon: true, also: ["chat"] }),
  world("bridge-existing-brand-current-design", "bridge",
    "Before approving the Git Bridge design review, compare the working and protected manifests and confirm whether its local artwork already matches the installed Git brand glyph. Keep a matching icon and leave the runtime alone.",
    { focus: "joined", icon: brand("git"), grant: "protected-match-icon", stageIcon: true, requireProtectedSource: true, also: ["source"] }),
  world("pdf-local-lifecycle-blocks-artwork", "pdf",
    "The PDF extension's candidate has different activation requirements. I'd like a Lucide file-search identity, but our approval applies only when the reviewed working manifest matches protected main. Confirm the current boundary before staging any icon.",
    { focus: "joined", icon: lucide("file-search"), change: "activation", grant: "protected-match-icon", stageIcon: true, requireProtectedSource: true, also: ["file"] }),
  world("speech-independent-cosmetic-draft", "speech",
    "Review the Speech extension's local manifest metadata for sourcing, and prepare a Lucide mic-vocal icon in the working tree if the manifest is valid. This is a cosmetic private draft, independent of promotion of the reviewed metadata.",
    { focus: "joined", icon: lucide("mic-vocal"), change: "metadata-only", grant: "working-icon", stageIcon: true, also: ["image"] }),
  world("templates-title-ambiguous", null,
    "Could you take a look at the installed Templates unit before the design handoff? I want an icon review, but I don't have its unit path or whether this request came from About or the extension owner.",
    { focus: "identity", also: ["aboutTemplates", "extensionTemplates"] }),
  world("uninstalled-client-no-fallback", null,
    "The handoff says to change the exact icon of the Sync Review client. If it isn't in this workspace, tell me without repurposing an installed workspace source worker or a Git extension.",
    { focus: "identity", stageIcon: true, also: ["source", "bridge"] }),
  world("held-source-lifecycle-ambiguous", "extensionTemplates",
    "The template browser and finder extension both appear in a status note. For the finder only, establish whether the actual active build was made from our reviewed working tree after the local ownership-note edit. No new build, start or note.",
    { change: "metadata-only", lifecycle: true, held: true, also: ["aboutTemplates"] }),
  world("held-shell-combined-invalid-icon", "shell",
    "I'm reviewing the shell service package for a private identity handoff. The working icon declaration might have broken manifest validity. Compare the manifests and hold a brand Gnubash draft until the working package passes its design check.",
    { focus: "joined", change: "invalid-icon", icon: brand("gnubash"), grant: "working-icon", stageIcon: true, held: true, also: ["terminal"] }),
  world("held-about-emoji-two-graphemes", "aboutTemplates",
    "Use exactly the paired symbols 📦✨ as the local About Templates mark, but only if these are accepted as one catalog emoji. Let me know if it's a design hold. Don't substitute a file icon or change the finder extension.",
    { focus: "identity", icon: emoji("📦✨"), grant: "working-icon", stageIcon: true, held: true, also: ["extensionTemplates"] }),
  world("held-source-identity-first", "source",
    "For the worker that tracks source ownership, choose the Lucide fingerprint mark for a local draft, even though the package icon currently points to valid artwork. Verify that the source ownership fields survive and main stays untouched.",
    { focus: "identity", icon: lucide("fingerprint"), grant: "working-icon", stageIcon: true, held: true, also: ["bridge"] }),
  world("held-file-tools-retained-prerequisite", "file",
    "Before a private folder-search identity draft for File tools, show whether our working and protected package agree and which retained runtime revision, if any, supports the handoff. If the current source comparison differs, leave the artwork alone.",
    { focus: "joined", change: "metadata-only", icon: lucide("folder-search"), grant: "protected-match-icon", stageIcon: true, requireProtectedSource: true, lifecycle: true, held: true, also: ["pdf"] }),
  world("held-natlang-icon-inspect-current", "natlang",
    "The Natlang panel's navigation review wants to compare a Lucide workflow glyph with its current identity. Give us an exact catalog and current-artwork comparison for the panel, without a working edit even if the symbols differ.",
    { focus: "identity", icon: lucide("workflow"), held: true, also: ["records"] }),
];
