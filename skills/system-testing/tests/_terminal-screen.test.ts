import { describe, expect, it, vi } from "vitest";
import {
  ACK_BATCH_BYTES,
  encodePtyStreamEvent,
  type PtyStreamEvent,
} from "@workspace/pty-stream";
import {
  TerminalScreen,
  TerminalScreenWaitError,
  attachTerminalScreen,
  type PtyAttachClient,
} from "./_terminal-screen.js";

const encoder = new TextEncoder();
const SIZE = { cols: 40, rows: 6 };

/** A framed attach stream the test feeds event by event. */
function framedStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  let cursor = 0;
  return {
    body,
    push(event: PtyStreamEvent) {
      for (const frame of encodePtyStreamEvent(event)) controller.enqueue(frame);
    },
    /** Push text as one data event at the running cursor. */
    text(value: string) {
      const bytes = encoder.encode(value);
      this.push({ kind: "data", at: cursor, bytes });
      cursor += bytes.byteLength;
    },
    /** Split a frame across chunks, as a transport may. */
    pushSplit(event: PtyStreamEvent) {
      for (const frame of encodePtyStreamEvent(event)) {
        controller.enqueue(frame.subarray(0, 3));
        controller.enqueue(frame.subarray(3));
      }
    },
    close() {
      controller.close();
    },
  };
}

const hello: PtyStreamEvent = {
  kind: "hello",
  attachId: "attach-1",
  epoch: 1,
  start: 0,
  cursor: 0,
  alive: true,
  cols: SIZE.cols,
  rows: SIZE.rows,
};

function fakeClient(stream: ReturnType<typeof framedStream>) {
  const acknowledged: Array<{ sessionId: string; attachId: string; bytes: number }> = [];
  const attach = vi.fn(async () => ({ body: stream.body }));
  const client: PtyAttachClient = {
    attach,
    acknowledge: async (sessionId, attachId, bytes) => {
      acknowledged.push({ sessionId, attachId, bytes });
    },
  };
  return { client, attach, acknowledged };
}

describe("terminal screen over the pty attach stream", () => {
  it("renders output and resolves a wait when a later event shows the text", async () => {
    const stream = framedStream();
    const { client, attach } = fakeClient(stream);
    const attached = await attachTerminalScreen(client, "pty-1", SIZE);
    expect(attach).toHaveBeenCalledWith("pty-1", { size: SIZE });

    stream.push(hello);
    stream.text("\x1b[32m● online\x1b[0m\r\n");
    await attached.screen.waitFor(/● online/u);

    const reply = attached.screen.waitFor(/Forked/u, { description: "fork notice" });
    let settled = false;
    void reply.then(() => (settled = true));
    stream.text("working…\r\n");
    await attached.screen.waitFor(/working/u);
    expect(settled).toBe(false);
    stream.pushSplit({ kind: "data", at: 100, bytes: encoder.encode("✓ Forked\r\n") });
    await expect(reply).resolves.toMatch(/● online\nworking…\n✓ Forked/u);

    await attached.detach();
  });

  it("acknowledges consumed data bytes for the attachment from the hello", async () => {
    const stream = framedStream();
    const { client, acknowledged } = fakeClient(stream);
    const attached = await attachTerminalScreen(client, "pty-1", SIZE);
    stream.push(hello);
    stream.text("x".repeat(ACK_BATCH_BYTES));
    stream.text("\r\ntail-marker");
    await attached.screen.waitFor(/tail-marker/u);
    stream.push({ kind: "exit", code: 0 });
    stream.close();
    await attached.ended;
    expect(acknowledged[0]).toEqual({
      sessionId: "pty-1",
      attachId: "attach-1",
      bytes: ACK_BATCH_BYTES,
    });
    await attached.detach();
  });

  it("rejects a pending wait with the exit when the program ends first", async () => {
    const stream = framedStream();
    const { client } = fakeClient(stream);
    const attached = await attachTerminalScreen(client, "pty-1", SIZE);
    stream.push(hello);
    stream.text("bye\r\n");
    const waiting = attached.screen.waitFor(/never shown/u, { description: "the reply" });
    const exited = attached.screen.exited();
    stream.push({ kind: "exit", code: null, signal: "SIGHUP" });
    stream.close();
    const error = await waiting.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TerminalScreenWaitError);
    expect((error as TerminalScreenWaitError).code).toBe("ETERMINALENDED");
    expect((error as Error).message).toBe(
      "the reply: the program was stopped by SIGHUP before it appeared",
    );
    expect((error as TerminalScreenWaitError).screen).toBe("bye");
    await expect(exited).resolves.toEqual({ code: null, signal: "SIGHUP" });
    await expect(attached.ended).resolves.toEqual({ kind: "exit", code: null, signal: "SIGHUP" });
    await attached.detach();
  });

  it("fails a wait as soon as the screen shows its failure pattern", async () => {
    const stream = framedStream();
    const { client } = fakeClient(stream);
    const attached = await attachTerminalScreen(client, "pty-1", SIZE);
    stream.push(hello);
    const waiting = attached.screen.waitFor(/Model set to/u, {
      description: "choosing the model",
      failOn: /No model called/u,
    });
    stream.text('No model called "x"\r\n');
    await expect(waiting).rejects.toMatchObject({
      code: "ETERMINALFAILON",
      message: "choosing the model: the terminal showed /No model called/u instead",
    });
    await attached.detach();
  });

  it("reports a stream that closes without an exit, and a reset clears the screen", async () => {
    const stream = framedStream();
    const { client } = fakeClient(stream);
    const attached = await attachTerminalScreen(client, "pty-1", SIZE);
    stream.push(hello);
    stream.text("before reset");
    await attached.screen.waitFor(/before reset/u);
    stream.push({ kind: "reset", epoch: 2, cursor: 0 });
    stream.text("after");
    await attached.screen.waitFor((screen) => screen === "after");
    const exited = attached.screen.exited();
    stream.close();
    await expect(exited).rejects.toThrow(
      "waiting for the program to exit: the attach stream closed without the program's exit",
    );
    await expect(attached.ended).resolves.toEqual({ kind: "closed" });
    await attached.detach();
  });

  it("settles waiters on abort and on detach without leaving the reader running", async () => {
    const stream = framedStream();
    const { client } = fakeClient(stream);
    const attached = await attachTerminalScreen(client, "pty-1", SIZE);
    stream.push(hello);
    const controller = new AbortController();
    const aborted = attached.screen.waitFor(/never/u, { signal: controller.signal });
    controller.abort(new Error("test deadline"));
    await expect(aborted).rejects.toThrow("test deadline");
    const pending = attached.screen.waitFor(/never/u, { description: "the reply" });
    await expect(attached.detach()).resolves.toEqual({ kind: "detached" });
    await expect(pending).rejects.toThrow("the reply: the screen was detached before it appeared");
  });

  it("ends the screen when an acknowledgement fails", async () => {
    const stream = framedStream();
    const client: PtyAttachClient = {
      attach: async () => ({ body: stream.body }),
      acknowledge: async () => {
        throw new Error("ENOENT: unknown attachment");
      },
    };
    const attached = await attachTerminalScreen(client, "pty-1", SIZE);
    const waiting = attached.screen.waitFor(/never/u, { description: "the reply" });
    stream.push(hello);
    stream.text("y".repeat(ACK_BATCH_BYTES));
    await expect(waiting).rejects.toThrow(
      "the reply: the attach stream failed: output acknowledgement failed: ENOENT: unknown attachment before it appeared",
    );
    await attached.detach();
  });

  it("rejects a second stream on one screen", async () => {
    const screen = new TerminalScreen(SIZE);
    const stream = framedStream();
    stream.close();
    const { readPtyStream } = await import("@workspace/pty-stream");
    await screen.consume(readPtyStream(stream.body), async () => {});
    await expect(
      screen.consume(readPtyStream(framedStream().body), async () => {}),
    ).rejects.toThrow("A terminal screen consumes exactly one attach stream");
    screen.dispose();
  });
});
