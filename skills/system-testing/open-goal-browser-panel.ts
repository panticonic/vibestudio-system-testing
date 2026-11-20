/** The renderer receives only the initial panel state. The oracle stays in the runner. */
export const openGoalBrowserPanelSource = `import { useState } from "react";
import { useStateArgs } from "@workspace/react/hooks";
type Control = { label: string; nextState: string };
type Row = { label: string; state: string; detail: string; controls: Control[] };
export default function OpenGoalBrowserPanel() {
  const { heading = "", rows = [] } = useStateArgs<{ heading?: string; rows?: Row[] }>();
  const [changed, setChanged] = useState<Record<number, string>>({});
  return <main data-open-goal-panel>
    <h1>{heading}</h1>
    <ul>{rows.map((row, index) =>
      <li key={row.label} data-open-goal-row>
        <h2>{row.label}</h2>
        <p data-state>{changed[index] ?? row.state}</p>
        <p data-detail>{row.detail}</p>
        {changed[index] === undefined && row.controls.map((control, choice) =>
          <button key={control.label} type="button" data-goal-control={index + "-" + choice}
            onClick={() => setChanged(previous => ({ ...previous, [index]: control.nextState }))}>
            {control.label}
          </button>
        )}
      </li>
    )}</ul>
  </main>;
}
`;
