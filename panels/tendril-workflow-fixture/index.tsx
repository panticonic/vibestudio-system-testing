import { useEffect, useState } from "react";
import { connectTendril, type Tendril } from "@workspace/tendril/page";

function contribute(
  tendril: Tendril,
  name: string,
  key: string,
  value: unknown,
) {
  tendril.expose(name, { description: `Set ${key} on the test board.` }, () => {
    tendril.state.set([key], value);
    return value;
  });
}

export default function TendrilWorkflowFixture() {
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let close: (() => void) | undefined;
    void connectTendril()
      .then(async (tendril) => {
        if (disposed) {
          await tendril.close();
          return;
        }
        contribute(tendril, "acknowledge", "confirmed", true);
        contribute(tendril, "clearReview", "confirmed", false);
        contribute(tendril, "startReview", "phase", "review");
        contribute(tendril, "returnToIntake", "phase", "intake");
        contribute(tendril, "clearTimer", "minutes", 0);
        const update = () =>
          setState({ ...(tendril.state.get() as Record<string, unknown>) });
        const unsubscribe = tendril.state.on(update);
        update();
        close = () => {
          unsubscribe();
          void tendril.close();
        };
      })
      .catch((reason: unknown) => {
        if (!disposed)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      disposed = true;
      close?.();
    };
  }, []);
  return (
    <main
      data-tendril-build="board-v1"
      data-tendril-status={error ? "error" : state ? "ready" : "loading"}
    >
      <h1>Handoff board</h1>
      {error && <p role="alert">{error}</p>}
      <dl>
        {Object.entries(state ?? {}).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd data-tendril-field={key}>{JSON.stringify(value)}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
