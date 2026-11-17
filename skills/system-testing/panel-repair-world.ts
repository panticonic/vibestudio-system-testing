/** Two independent causes of the same user-visible draft loss in a real React panel. */
export type DraftLoss = "editor-unmount" | "stale-saved-snapshot";

export const panelRepairWorlds = [
  { id: "panel-draft-unmount", sourceGroup: "panel-draft-unmount", fault: "editor-unmount" },
  {
    id: "panel-draft-stale-snapshot",
    sourceGroup: "panel-draft-stale-snapshot",
    fault: "stale-saved-snapshot",
  },
] as const satisfies ReadonlyArray<{ id: string; sourceGroup: string; fault: DraftLoss }>;

export function panelRepairWorldSource(fault: DraftLoss): string {
  const imports = fault === "editor-unmount" ? "useState" : "useEffect, useState";
  const editor = fault === "editor-unmount" ? `
function Editor({ saved, save }: { saved: string; save(value: string): void }) {
  const [draft, setDraft] = useState(saved);
  return editorControls(draft, setDraft, () => save(draft), () => setDraft(saved));
}
` : "";
  const state = fault === "editor-unmount" ? "" : `
  const [draft, setDraft] = useState(saved);
  useEffect(() => {
    if (tab === "editor") setDraft(saved);
  }, [tab, saved]);
`;
  const content = fault === "editor-unmount"
    ? "<Editor saved={saved} save={setSaved} />"
    : "editorControls(draft, setDraft, () => setSaved(draft), () => setDraft(saved))";
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
${state}
  return (
    <main>
      <h1>Workspace topic</h1>
      <nav aria-label="Topic views">
        <button onClick={() => setTab("editor")}>Edit topic</button>
        <button onClick={() => setTab("preview")}>Preview topic</button>
      </nav>
      {tab === "editor" ? ${content} : <p aria-label="Saved topic">{saved}</p>}
    </main>
  );
}
`;
}
