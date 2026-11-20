/** Installed as a disposable panel. Only owned boot state and exact visible controls are rendered. */
export const clientDiagnosticsRenderer = `import { useEffect, useState } from "react";
import { useStateArgs } from "@workspace/react/hooks";

type Frame = {
  version: string;
  text: string;
  minWidth?: number;
  log?: { level: "info" | "warn" | "error"; message: string };
  controls?: { id: string; label: string; next: string | null; disabled?: boolean }[];
};
type Scene = { id: string; title: string; audience: string; device: string; frames: Record<string,Frame> };
export default function OwnedClient() {
  const { scene, boot, ownerStage } = useStateArgs<{scene?:Scene;boot?:string;ownerStage?:string}>();
  const [current,setCurrent] = useState(boot ?? "");
  const [instance] = useState(() => crypto.randomUUID());
  const [ready,setReady] = useState("");
  useEffect(() => { if (ownerStage) setCurrent(ownerStage); }, [ownerStage]);
  const frame = scene?.frames[current];
  useEffect(() => {
    if (!frame || ready === current) return;
    if (frame.log) console[frame.log.level]("owned-client: " + frame.log.message);
    setReady(current);
  },[current,frame,ready]);
  if (!scene || !frame) return null;
  return <main data-client-stage={ready === current ? current : ""} data-client-id={scene.id}
      data-client-audience={scene.audience} data-client-device={scene.device} data-client-instance={instance}>
    <h1>{scene.title}</h1>
    <section style={{minWidth:frame.minWidth ?? 0}}>
      <output data-panel-health="version">{frame.version}</output>
      <p data-panel-health="message">{frame.text}</p>
      {(frame.controls ?? []).map(control => <button key={control.id} type="button" disabled={control.disabled}
        data-client-control={control.id} onClick={() => { if (control.next) setCurrent(control.next); }}>{control.label}</button>)}
    </section>
  </main>;
}
`;
