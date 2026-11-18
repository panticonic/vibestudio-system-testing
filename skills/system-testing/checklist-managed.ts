import { extensions, rpc } from "@workspace/runtime";
import type {} from "@workspace-extensions/shell";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { TerminalSessionEntry } from "@vibestudio/shared/terminalSessions";
import {
  attachTerminalScreen,
  type AttachedTerminalScreen,
} from "./tests/_terminal-screen.js";
import {
  checklistSource,
  managedChecklistWorlds,
  type ItemKey,
} from "./checklist-worlds.js";

const launchSize = { cols: 80, rows: 24 };
const resumedSize = { cols: 62, rows: 18 };
const screenError = /Cannot run the checklist/u;
type Readback = {
  sessionId: string;
  ptyId: string;
  cols: number;
  rows: number;
  checked: ItemKey[];
};
type Report = { status: string; screens: Readback[]; continuation: string };

export function prepareManagedChecklist(caseId: string, signal?: AbortSignal) {
  const world = managedChecklistWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown managed release checklist case");
  const shell = extensions.use("@workspace-extensions/shell");
  let session: TerminalSessionEntry | undefined;
  let attachment: AttachedTerminalScreen | undefined;
  let launched = false;
  let continued = false;
  let sent = 0;
  const screens: Readback[] = [];

  function live() {
    const ptyId = session?.shellSessionId;
    if (
      !session?.running ||
      session.source !== checklistSource ||
      !ptyId ||
      !session.principalId
    )
      throw new Error("The assigned checklist has no live terminal");
    return { sessionId: session.sessionId, ptyId };
  }

  async function detach() {
    if (attachment) {
      const screen = attachment;
      attachment = undefined;
      const ended = await screen.detach();
      if (ended.kind === "failed") throw new Error(ended.error);
    }
  }

  async function observe(
    size: typeof launchSize,
    edit?: { revision: number; key: ItemKey; checked: boolean },
  ) {
    const identity = live();
    const current = attachment?.screen;
    if (!current) throw new Error("The assigned terminal is not attached");
    const viewport = `Viewport: ${size.cols}x${size.rows}`;
    const checkedRows = /^[ \t]*([123]) \[([ x])\] .+$/gmu;
    const rendered = await current.waitFor(
      (text) => {
        if (!text.includes("Release checklist") || !text.includes(viewport))
          return false;
        const rows = Array.from(text.matchAll(checkedRows));
        return (
          rows.length === 3 &&
          (!edit ||
            rows.some(
              (row) => row[1] === edit.key && (row[2] === "x") === edit.checked,
            ))
        );
      },
      {
        description: `Checklist painted at ${size.cols}x${size.rows}`,
        failOn: screenError,
        ...(signal ? { signal } : {}),
        ...(edit ? { afterRevision: edit.revision } : {}),
      },
    );
    const checked = Array.from(rendered.matchAll(checkedRows))
      .filter((match) => match[2] === "x")
      .map((match) => match[1] as ItemKey);
    const receipt = { ...identity, ...size, checked };
    screens.push(receipt);
    return structuredClone(receipt);
  }

  const services = {
    checklistOpen: {
      async launch() {
        if (launched) throw new Error("Launch the assigned checklist once.");
        launched = true;
        session = await rpc.call(
          "main",
          mainRpcMethods["terminalApps.launch"],
          [{ source: checklistSource, ...launchSize }],
        );
        attachment = await attachTerminalScreen(
          shell,
          live().ptyId,
          launchSize,
        );
        return observe(launchSize);
      },
    },
    checklistKeys: {
      async toggle(key: ItemKey) {
        if (!attachment || continued || world.request.keys[sent] !== key)
          throw new Error("Use the next assigned key on the owned checklist.");
        ++sent;
        const revision = attachment.screen.revision;
        const checked = !screens.at(-1)?.checked.includes(key);
        await shell.write(live().ptyId, key);
        return observe(launchSize, { revision, key, checked });
      },
    },
    checklistResume: {
      async resume(kind: "reattach" | "restart") {
        if (
          !attachment ||
          continued ||
          kind !== world.request.continuation ||
          sent !== world.request.keys.length
        )
          throw new Error(
            "Continue only the assigned terminal after its recorded keys.",
          );
        continued = true;
        const { sessionId } = live();
        await detach();
        if (kind === "restart")
          session = await rpc.call(
            "main",
            mainRpcMethods["terminalApps.restart"],
            [{ sessionId, ...resumedSize }],
          );
        attachment = await attachTerminalScreen(
          shell,
          live().ptyId,
          resumedSize,
        );
        return observe(resumedSize);
      },
    },
  };
  return {
    world,
    request: world.request,
    screens,
    services,
    async close() {
      const owned = session?.sessionId;
      try {
        await detach();
      } finally {
        if (owned)
          await rpc.call("main", mainRpcMethods["terminalApps.close"], [owned]);
      }
      const remaining = await rpc.call(
        "main",
        mainRpcMethods["terminalApps.list"],
        [],
      );
      return (
        typeof owned === "string" &&
        !remaining.some(({ sessionId }) => sessionId === owned)
      );
    },
  };
}

type Prepared = ReturnType<typeof prepareManagedChecklist>;
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export function verifyManagedChecklist(
  prepared: Prepared,
  value: unknown,
  retired: boolean,
) {
  const { world, screens } = prepared;
  const report = value as Report | null;
  const first = screens[0];
  const continued = world.request.continuation !== "none";
  const steady = screens.slice(0, 1 + world.request.keys.length);
  const last = screens.at(-1);
  const checks = {
    exactScreenSequence: same(
      screens.map(({ checked }) => checked),
      world.expected,
    ),
    sessionPreserved: Boolean(
      first && screens.every(({ sessionId }) => sessionId === first.sessionId),
    ),
    terminalIdentity: Boolean(
      first &&
      steady.every(({ ptyId }) => ptyId === first.ptyId) &&
      (!continued ||
        (world.request.continuation === "restart"
          ? last?.ptyId !== first.ptyId
          : last?.ptyId === first.ptyId)),
    ),
    viewport:
      steady.every(
        ({ cols, rows }) =>
          cols === launchSize.cols && rows === launchSize.rows,
      ) &&
      (!continued ||
        (last?.cols === resumedSize.cols && last.rows === resumedSize.rows)),
    joinedReport:
      report?.status === "verified" &&
      report.continuation === world.request.continuation &&
      Array.isArray(report.screens) &&
      report.screens.length === screens.length &&
      screens.every((screen, index) => {
        const item = report.screens[index];
        return (
          item?.sessionId === screen.sessionId &&
          item.ptyId === screen.ptyId &&
          item.cols === screen.cols &&
          item.rows === screen.rows &&
          same(item.checked, screen.checked)
        );
      }),
    retired,
  };
  return {
    caseId: world.id,
    checks,
    passed: Object.values(checks).every(Boolean),
    sessionId: first?.sessionId ?? null,
    screens,
    continuation: world.request.continuation,
  };
}

export async function qualifyManagedChecklist(
  caseId: string,
  signal?: AbortSignal,
) {
  const prepared = prepareManagedChecklist(caseId, signal);
  let retired = false;
  try {
    await prepared.services.checklistOpen.launch();
    for (const key of prepared.request.keys)
      await prepared.services.checklistKeys.toggle(key);
    const mode = prepared.request.continuation;
    if (mode !== "none") await prepared.services.checklistResume.resume(mode);
  } finally {
    retired = await prepared.close();
  }
  const report = {
    status: "verified",
    screens: prepared.screens,
    continuation: prepared.request.continuation,
  };
  const accepted = verifyManagedChecklist(prepared, report, retired);
  const wrong = verifyManagedChecklist(
    prepared,
    {
      ...report,
      screens: report.screens.map((screen, index) =>
        index === 0 ? { ...screen, ptyId: "different-pty" } : screen,
      ),
    },
    retired,
  );
  return { accepted, rejectedDifferentPty: !wrong.passed };
}
