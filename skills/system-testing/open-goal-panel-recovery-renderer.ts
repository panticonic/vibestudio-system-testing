/** The fixture renders owned state and live controls. The outcome oracle stays in the runner. */
export const panelRecoverySource = `import { useLayoutEffect, useState } from "react";
import { useStateArgs } from "@workspace/react/hooks";

type Scene = {
  title: string; audience: string;
  frames: Record<string, {
    markers: Record<string, string[]>;
    controls: { id: string; label: string; next: string }[];
    logs: { level: "error" | "warning" | "info"; message: string }[];
  }>;
};
export default function OwnedRecoverySurface() {
  const { scene, boot, ownerStage } = useStateArgs<{scene?: Scene; boot?: string; ownerStage?: string}>();
  const [stage, setStage] = useState(boot ?? "");
  const [instance] = useState(() => crypto.randomUUID());
  const [emitted, setEmitted] = useState("");
  useLayoutEffect(() => { if (ownerStage) setStage(ownerStage); }, [ownerStage]);
  const current = scene?.frames[stage];
  useLayoutEffect(() => {
    if (!current || emitted === stage) return;
    for (const signal of current.logs) console[signal.level](signal.message);
    setEmitted(stage);
  }, [current, stage, emitted]);
  if (!scene || !current) return null;
  return <main data-panel-recovery data-stage={emitted === stage ? stage : ""} data-instance={instance}>
    <h1>{scene.title}</h1><p data-audience>{scene.audience}</p>
    {Object.entries(current.markers).flatMap(([id, values]) => values.map((value, index) =>
      <p key={id + "-" + index} data-panel-health={id}>{value}</p>))}
    {current.controls.map(item =>
      <button key={item.id} type="button" data-recovery-control={item.id} onClick={() => setStage(item.next)}>
        {item.label}
      </button>)}
  </main>;
}
`;
