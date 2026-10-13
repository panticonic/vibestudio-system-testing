import { VtScreen } from "./_vt-screen.js";
import {
  PtyStreamAcknowledger,
  readPtyStream,
  type PtyAttachOptions,
  type PtyStreamEvent,
} from "@workspace/pty-stream";

/**
 * A headless terminal screen fed by one shell-extension attach stream.
 *
 * Output bytes go into an VT screen model (`_vt-screen.ts`) in stream order; each
 * data frame is acknowledged (through the shell extension's byte-counted flow
 * control) only after the emulator consumed it. Waiting is driven by the
 * stream itself: a condition is re-evaluated after every consumed event and a
 * waiter settles on a match, on the program's exit, on the end of the stream,
 * or on its caller's abort — never on elapsed time.
 */

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** How the attach stream ended. */
export type TerminalStreamEnd =
  | { kind: "exit"; code: number | null; signal?: string }
  /** The stream closed without reporting the program's exit. */
  | { kind: "closed" }
  /** The caller detached (aborted the attachment). */
  | { kind: "detached" }
  | { kind: "failed"; error: string };

/** A screen condition: a pattern over the visible text, or a predicate over it. */
export type ScreenCondition = RegExp | ((screen: string) => boolean);

export interface ScreenWaitOptions {
  /** What the caller is waiting for, used in failure messages. */
  description?: string;
  /** Fail as soon as the screen shows this instead (an error notice, for example). */
  failOn?: RegExp;
  signal?: AbortSignal;
}

/** The screen could no longer reach the awaited condition. */
export class TerminalScreenWaitError extends Error {
  readonly code: "ETERMINALENDED" | "ETERMINALFAILON";
  readonly screen: string;
  constructor(
    code: "ETERMINALENDED" | "ETERMINALFAILON",
    message: string,
    screen: string,
  ) {
    super(message);
    this.name = "TerminalScreenWaitError";
    this.code = code;
    this.screen = screen;
  }
}

interface Waiter {
  check(): void;
  end(end: TerminalStreamEnd): void;
}

function describeCondition(condition: ScreenCondition): string {
  return condition instanceof RegExp ? String(condition) : "the expected screen";
}

export function describeStreamEnd(end: TerminalStreamEnd): string {
  switch (end.kind) {
    case "exit":
      return end.signal
        ? `the program was stopped by ${end.signal}`
        : `the program exited with code ${end.code ?? "unknown"}`;
    case "closed":
      return "the attach stream closed without the program's exit";
    case "detached":
      return "the screen was detached";
    case "failed":
      return `the attach stream failed: ${end.error}`;
  }
}

export class TerminalScreen {
  readonly #term: VtScreen;
  readonly #waiters = new Set<Waiter>();
  #end: TerminalStreamEnd | null = null;
  #attachId: string | null = null;

  constructor(size: TerminalSize) {
    this.#term = new VtScreen({
      cols: size.cols,
      rows: size.rows,
      // Programs written for a TTY rely on the line discipline's ONLCR.
      convertEol: true,
    });
  }

  /** The attachment id from the stream's hello, once it arrived. */
  get attachId(): string | null {
    return this.#attachId;
  }

  /** How the stream ended, or null while it is live. */
  get ended(): TerminalStreamEnd | null {
    return this.#end;
  }

  /** The visible rows, right-trimmed, without trailing blank rows. */
  screen(): string {
    const lines = this.#term.lines();
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }

  /**
   * Consume one attach stream until it ends. `acknowledge` reports consumed
   * data bytes for the attachment named by the stream's hello.
   */
  async consume(
    events: AsyncIterable<PtyStreamEvent>,
    acknowledge: (attachId: string, bytes: number) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<TerminalStreamEnd> {
    if (this.#end) throw new Error("A terminal screen consumes exactly one attach stream");
    let acknowledger: PtyStreamAcknowledger | null = null;
    let end: TerminalStreamEnd = { kind: "closed" };
    try {
      for await (const event of events) {
        switch (event.kind) {
          case "hello": {
            const attachId = event.attachId;
            this.#attachId = attachId;
            // A lost acknowledgement would leave the PTY paused once the
            // watermark is reached, so it ends the screen at once: every
            // waiter learns the cause instead of waiting on stalled output.
            acknowledger = new PtyStreamAcknowledger(
              (bytes) => acknowledge(attachId, bytes),
              (error) =>
                this.#finish({
                  kind: "failed",
                  error: `output acknowledgement failed: ${errorText(error)}`,
                }),
            );
            break;
          }
          case "data":
            await this.#write(event.bytes);
            acknowledger?.consumed(event.bytes.byteLength);
            break;
          case "reset":
            this.#term.reset();
            break;
          case "gap":
            await this.#write(
              `\r\n[${event.to - event.from} bytes of earlier output were trimmed]\r\n`,
            );
            break;
          case "exit":
            end = {
              kind: "exit",
              code: event.code,
              ...(event.signal ? { signal: event.signal } : {}),
            };
            break;
        }
        this.#notify();
      }
      if (end.kind === "closed" && signal?.aborted) end = { kind: "detached" };
    } catch (error) {
      end = signal?.aborted ? { kind: "detached" } : { kind: "failed", error: errorText(error) };
    }
    this.#finish(end);
    return this.#end ?? end;
  }

  /**
   * Resolve with the screen once `condition` holds. Rejects when the screen
   * shows `failOn`, when the stream ends first, or when `signal` aborts.
   */
  waitFor(condition: ScreenCondition, options: ScreenWaitOptions = {}): Promise<string> {
    const description = options.description ?? describeCondition(condition);
    return new Promise<string>((resolve, reject) => {
      const signal = options.signal;
      const settle = () => {
        this.#waiters.delete(waiter);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        settle();
        reject(signal!.reason);
      };
      const waiter: Waiter = {
        check: () => {
          const screen = this.screen();
          if (options.failOn?.test(screen)) {
            settle();
            reject(
              new TerminalScreenWaitError(
                "ETERMINALFAILON",
                `${description}: the terminal showed ${String(options.failOn)} instead`,
                screen,
              ),
            );
            return;
          }
          const matched =
            condition instanceof RegExp ? condition.test(screen) : condition(screen);
          if (matched) {
            settle();
            resolve(screen);
          }
        },
        end: (end) => {
          settle();
          reject(
            new TerminalScreenWaitError(
              "ETERMINALENDED",
              `${description}: ${describeStreamEnd(end)} before it appeared`,
              this.screen(),
            ),
          );
        },
      };
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.add(waiter);
      waiter.check();
      if (this.#waiters.has(waiter) && this.#end) waiter.end(this.#end);
    });
  }

  /** Resolve once the program's exit arrives; reject if the stream ends otherwise. */
  exited(signal?: AbortSignal): Promise<{ code: number | null; signal?: string }> {
    return new Promise((resolve, reject) => {
      const settle = () => {
        this.#waiters.delete(waiter);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        settle();
        reject(signal!.reason);
      };
      const waiter: Waiter = {
        check: () => {},
        end: (end) => {
          settle();
          if (end.kind === "exit") {
            resolve({ code: end.code, ...(end.signal ? { signal: end.signal } : {}) });
          } else {
            reject(
              new TerminalScreenWaitError(
                "ETERMINALENDED",
                `waiting for the program to exit: ${describeStreamEnd(end)}`,
                this.screen(),
              ),
            );
          }
        },
      };
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.add(waiter);
      if (this.#end) waiter.end(this.#end);
    });
  }

  dispose(): void {
    this.#finish({ kind: "detached" });
  }

  #write(data: string | Uint8Array): Promise<void> {
    this.#term.write(data);
    return Promise.resolve();
  }

  #notify(): void {
    for (const waiter of [...this.#waiters]) waiter.check();
  }

  #finish(end: TerminalStreamEnd): void {
    if (this.#end) return;
    this.#end = end;
    for (const waiter of [...this.#waiters]) waiter.end(end);
  }
}

/** The shell-extension calls a screen needs to follow one PTY session. */
export interface PtyAttachClient {
  attach(
    shellSessionId: string,
    options: PtyAttachOptions,
  ): Promise<{ body: ReadableStream<Uint8Array> | null }>;
  acknowledge(shellSessionId: string, attachId: string, bytes: number): Promise<void>;
}

export interface AttachedTerminalScreen {
  screen: TerminalScreen;
  /** Settles with how the attachment ended; never rejects. */
  ended: Promise<TerminalStreamEnd>;
  /** Stop following the session (the program keeps running) and wait for the reader. */
  detach(): Promise<TerminalStreamEnd>;
}

/**
 * Attach a fresh screen to a PTY session: the whole retained output is
 * replayed into a clean emulator and the session is sized to `size`.
 */
export async function attachTerminalScreen(
  client: PtyAttachClient,
  shellSessionId: string,
  size: TerminalSize,
): Promise<AttachedTerminalScreen> {
  const controller = new AbortController();
  const screen = new TerminalScreen(size);
  const response = await client.attach(shellSessionId, { size });
  if (!response.body) {
    screen.dispose();
    throw new Error(`The shell returned no output stream for ${shellSessionId}`);
  }
  const ended = screen.consume(
    readPtyStream(response.body, controller.signal),
    (attachId, bytes) => client.acknowledge(shellSessionId, attachId, bytes),
    controller.signal,
  );
  return {
    screen,
    ended,
    async detach() {
      controller.abort(new Error("The terminal screen detached"));
      const end = await ended;
      screen.dispose();
      return end;
    },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
