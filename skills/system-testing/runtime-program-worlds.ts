type Artifact = Record<string, string>;
type Execution =
  | { kind: "check"; input: unknown; output: unknown }
  | { kind: "unchecked"; input: unknown }
  | { kind: "failure"; input: unknown; message: string }
  | { kind: "stale"; input: unknown; output: unknown; replacement: string };
type Verdict =
  | "call-reviewed-signature"
  | "verified"
  | "inspect-trace"
  | "refresh-program-receipt"
  | "repair-result-contract"
  | "resolve-import"
  | "read-diagnostic";

function task(
  id: string,
  goal: string,
  files: Artifact,
  expected: Verdict,
  execution?: Execution,
) {
  return { id, goal, files, expected, execution };
}
const source = (body: string, signature = "n: number", output = "number") => ({
  "main.ts": `export function check(${signature}): ${output} { ${body} }\n`,
});
const verify = (input: unknown, output: unknown): Execution => ({
  kind: "check",
  input,
  output,
});
const unchecked = (input: unknown): Execution => ({ kind: "unchecked", input });
const stale = (
  input: unknown,
  output: unknown,
  replacement: string,
): Execution => ({ kind: "stale", input, output, replacement });
const failed = (input: unknown, message: string): Execution => ({
  kind: "failure",
  input,
  message,
});

export const managedRuntimeProgramWorlds = [
  task(
    "signature-only",
    "Review the typed report counter. Only establish whether the caller has a valid signature to invoke.",
    source("return n + 1;"),
    "call-reviewed-signature",
  ),
  task(
    "nested-signature",
    "Check that the entry can still import its units converter. Review the callable signature before running it.",
    {
      "main.ts":
        'import { convert } from "./units.js";\nexport function check(n: number): number { return convert(n); }\n',
      "units.ts":
        "export function convert(n: number): number { return n * 60; }\n",
    },
    "call-reviewed-signature",
  ),
  task(
    "bad-counter-return",
    "Find the reason the counter cannot be called when its declared result is numeric but it returns a label.",
    source('return "complete";'),
    "repair-result-contract",
  ),
  task(
    "bad-label-return",
    "Review the status formatter before it ships. Its result contract requires a string.",
    source("return n;", "n: number", "string"),
    "repair-result-contract",
  ),
  task(
    "missing-units-import",
    "Diagnose the missing module in a report that converts units.",
    {
      "main.ts":
        'import { convert } from "./absent.js";\nexport function check(n: number): number { return convert(n); }\n',
    },
    "resolve-import",
  ),
  task(
    "malformed-batch-expression",
    "Review the compiler diagnostic for the incomplete batch counter expression.",
    source("return n +;"),
    "read-diagnostic",
  ),
  task(
    "checked-counter",
    "Verify the counter's returned result on the assigned sample of forty-one.",
    source("return n + 1;"),
    "verified",
    verify(41, 42),
  ),
  task(
    "checked-window",
    "Confirm the checked positivity flag for the boundary input rather than relying on the signature.",
    source("return n > 0;", "n: number", "boolean"),
    "verified",
    verify(0, false),
  ),
  task(
    "checked-summary-shape",
    "Check the typed status object that was returned to the actual caller.",
    source(
      "return { count: n, isEmpty: n === 0 };",
      "n: number",
      "{ count: number; isEmpty: boolean }",
    ),
    "verified",
    verify(0, { count: 0, isEmpty: true }),
  ),
  task(
    "checked-nested-helper",
    "Check the actual converted duration returned by the nested helper call.",
    {
      "main.ts":
        'import { convert } from "./units.js";\nexport function check(n: number): number { return convert(n); }\n',
      "units.ts":
        "export function convert(n: number): number { return n * 60; }\n",
    },
    "verified",
    verify(5, 300),
  ),
  task(
    "run-without-output-check",
    "Follow up on a duration formatter that returned a value whose correctness was not checked.",
    source('return n + " minutes";', "n: number", "string"),
    "inspect-trace",
    unchecked(5),
  ),
  task(
    "unchecked-derived-total",
    "A totals run finished but the caller has not compared the value against a reference. Report the supported follow-up.",
    source("return n * 12;"),
    "inspect-trace",
    unchecked(3),
  ),
  task(
    "execution-invalid-total",
    "The program compiled but rejected a negative total during an actual call. Review the execution result.",
    source('if (n < 0) throw new Error("negative total"); return n;'),
    "inspect-trace",
    failed(-1, "negative total"),
  ),
  task(
    "execution-empty-label",
    "Differentiate a valid string signature from the failure on an empty input at runtime.",
    source(
      'if (!text.trim()) throw new Error("label is empty"); return text.trim();',
      "text: string",
      "string",
    ),
    "inspect-trace",
    failed(" ", "label is empty"),
  ),
  task(
    "execution-rejected-window",
    "Inspect the failed run for a requested window beyond the supported size.",
    source('if (n > 20) throw new Error("window too large"); return n;'),
    "inspect-trace",
    failed(25, "window too large"),
  ),
  task(
    "stale-counter-receipt",
    "A counter passed before an increment rule changed. Determine whether that receipt still establishes the current behavior.",
    source("return n + 1;"),
    "refresh-program-receipt",
    stale(3, 4, "export function check(n: number): number { return n + 2; }\n"),
  ),
  task(
    "stale-format-receipt",
    "The formatter was checked before the display units changed. Review the held receipt against the current source.",
    source('return n + " ms";', "n: number", "string"),
    "refresh-program-receipt",
    stale(
      5,
      "5 ms",
      'export function check(n: number): string { return n + " seconds"; }\n',
    ),
  ),
  task(
    "stale-cutoff-receipt",
    "The previous boundary check passed but the author changed the cutoff. Determine the right follow-up from the revision evidence.",
    source("return n >= 0;", "n: number", "boolean"),
    "refresh-program-receipt",
    stale(
      0,
      true,
      "export function check(n: number): boolean { return n > 0; }\n",
    ),
  ),
];
