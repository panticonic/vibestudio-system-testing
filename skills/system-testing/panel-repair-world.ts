/** Each world introduces a distinct fault into the React topic editor. */
export type DraftLoss =
  | "editor-unmount"
  | "stale-saved-snapshot"
  | "preview-autosaves"
  | "save-keeps-old"
  | "discard-clears"
  | "discard-saves";

export const panelDraftChecks = [
  "preservesUnsavedDraft",
  "navigationDoesNotSave",
  "saveCommitsDraft",
  "discardRestoresSaved",
  "discardedDraftStaysDiscarded",
] as const;
type PanelDraftCheck = (typeof panelDraftChecks)[number];
type PanelWorld = {
  id: string;
  sourceGroup: string;
  fault: DraftLoss;
  symptoms: string;
  failedChecks: PanelDraftCheck[];
};

export const panelRepairWorlds: PanelWorld[] = [
  {
    id: "panel-draft-unmount",
    sourceGroup: "draft-navigation",
    fault: "editor-unmount",
    symptoms:
      "The workspace topic panel loses my unsaved changes when I switch to Preview topic and back.",
    failedChecks: ["preservesUnsavedDraft"],
  },
  {
    id: "panel-draft-stale-snapshot",
    sourceGroup: "draft-navigation",
    fault: "stale-saved-snapshot",
    symptoms:
      "The workspace topic panel loses my unsaved changes when I switch to Preview topic and back.",
    failedChecks: ["preservesUnsavedDraft"],
  },
  {
    id: "panel-draft-preview-autosaves",
    sourceGroup: "preview-auto-commit",
    fault: "preview-autosaves",
    symptoms:
      "Preview topic is showing my unsaved changes as the saved topic. Opening a preview should never save the edit.",
    failedChecks: ["navigationDoesNotSave"],
  },
  {
    id: "panel-draft-save-keeps-old",
    sourceGroup: "save-stale-value",
    fault: "save-keeps-old",
    symptoms:
      "After I type and select Save, Preview topic still shows the old topic. Save should use the current draft.",
    failedChecks: ["saveCommitsDraft"],
  },
  {
    id: "panel-draft-discard-clears",
    sourceGroup: "discard-draft-reset",
    fault: "discard-clears",
    symptoms:
      "Discard blanks the editor even after I saved a topic. It should restore the last saved topic and stay restored after navigation.",
    failedChecks: ["discardRestoresSaved", "discardedDraftStaysDiscarded"],
  },
  {
    id: "panel-draft-discard-saves",
    sourceGroup: "discard-commits-value",
    fault: "discard-saves",
    symptoms:
      "Discard appears to restore my last saved editor value, but Preview topic then shows the discarded text. Discard must leave the saved topic alone.",
    failedChecks: ["discardRestoresSaved"],
  },
];

export function matchesPanelDraftChecks(
  checks: Partial<Record<PanelDraftCheck, boolean>>,
  failedChecks: readonly PanelDraftCheck[],
): boolean {
  return (
    Object.keys(checks).length === panelDraftChecks.length &&
    panelDraftChecks.every(
      (check) => checks[check] === !failedChecks.includes(check),
    )
  );
}

export function panelRepairWorldSource(fault: DraftLoss | null): string {
  const imports =
    fault === "stale-saved-snapshot" ? "useEffect, useState" : "useState";
  const editor =
    fault === "editor-unmount"
      ? `
function Editor({ saved, save }: { saved: string; save(value: string): void }) {
  const [draft, setDraft] = useState(saved);
  return editorControls(draft, setDraft, () => save(draft), () => setDraft(saved));
}
`
      : "";
  const draftState =
    fault === "editor-unmount"
      ? ""
      : "const [draft, setDraft] = useState(saved);";
  const resetOnTab =
    fault === "stale-saved-snapshot"
      ? `
  useEffect(() => {
    if (tab === "editor") setDraft(saved);
  }, [tab, saved]);
`
      : "";
  const save =
    fault === "save-keeps-old" ? "setSaved(saved)" : "setSaved(draft)";
  const discardHandlers: Partial<Record<DraftLoss, string>> = {
    "discard-clears": 'setDraft("")',
    "discard-saves": "setSaved(draft); setDraft(saved);",
  };
  const discard = (fault && discardHandlers[fault]) || "setDraft(saved);";
  const showPreview =
    fault === "preview-autosaves"
      ? 'setSaved(draft); setTab("preview");'
      : 'setTab("preview");';
  const content =
    fault === "editor-unmount"
      ? "<Editor saved={saved} save={setSaved} />"
      : `editorControls(draft, setDraft, () => ${save}, () => { ${discard} })`;
  return `import { ${imports} } from "react";

function editorControls(
  draft: string,
  setDraft: (value: string) => void,
  save: () => void,
  discard: () => void,
) {
  return (
    <section aria-label="Topic editor">
      <label>Topic <input value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <button onClick={save}>Save</button>
      <button onClick={discard}>Discard</button>
    </section>
  );
}
${editor}
export default function WorkspaceTopic() {
  const [tab, setTab] = useState<"editor" | "preview">("editor");
  const [saved, setSaved] = useState("Weekly planning");
  ${draftState}
${resetOnTab}
  return (
    <main>
      <h1>Workspace topic</h1>
      <nav aria-label="Topic views">
        <button onClick={() => setTab("editor")}>Edit topic</button>
        <button onClick={() => { ${showPreview} }}>Preview topic</button>
      </nav>
      {tab === "editor" ? ${content} : <p aria-label="Saved topic">{saved}</p>}
    </main>
  );
}
`;
}
