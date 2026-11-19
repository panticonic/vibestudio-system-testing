type Expected = {
  status: "passed" | "failed" | "output-truncated";
  exitCode: number;
  stdout: string;
};
type Check = {
  id: string;
  purpose: string;
  prerequisites: string[];
  intent:
    | { kind: "argv"; executable: string; args: string[] }
    | { kind: "script"; script: string };
  expected: Expected | null;
};
export type TerminalCheckWorld = { id: string; goal: string; checks: Check[] };
const sequence = Array.from({ length: 500 }, (_, index) => index + 1).join(
  "\n",
);
export const managedTerminalCheckWorlds: TerminalCheckWorld[] = [
  {
    id: "literal-argv-failed-gate",
    goal: "Confirm that the label is passed literally. Run the predicate after that confirmation. Hold publish validation if the predicate fails, and complete the independent health check.",
    checks: [
      {
        id: "label",
        purpose:
          "Confirm the exact release label, including spaces and punctuation",
        prerequisites: [],
        intent: {
          kind: "argv",
          executable: "/usr/bin/printf",
          args: ["%s", "release ; preview"],
        },
        expected: {
          status: "passed",
          exitCode: 0,
          stdout: "release ; preview",
        },
      },
      {
        id: "predicate",
        purpose: "Check the release threshold after confirming the label",
        prerequisites: ["label"],
        intent: {
          kind: "argv",
          executable: "/usr/bin/test",
          args: ["1", "=", "2"],
        },
        expected: { status: "failed", exitCode: 1, stdout: "" },
      },
      {
        id: "publish-check",
        purpose:
          "Print the publish validation marker only if the threshold is met",
        prerequisites: ["predicate"],
        intent: {
          kind: "argv",
          executable: "/usr/bin/printf",
          args: ["publish-check"],
        },
        expected: null,
      },
      {
        id: "health",
        purpose: "Run the independent health check",
        prerequisites: [],
        intent: {
          kind: "argv",
          executable: "/usr/bin/printf",
          args: ["ready"],
        },
        expected: { status: "passed", exitCode: 0, stdout: "ready" },
      },
    ],
  },
  {
    id: "pipeline-bounded-output",
    goal: "Use the assigned pipeline to count the marker. After it succeeds, check whether the sequence output fits the evidence limit. Hold the comparison if the sequence was cut short.",
    checks: [
      {
        id: "pipeline",
        purpose: "Count the four-byte marker through the caller's pipeline",
        prerequisites: [],
        intent: { kind: "script", script: "printf '%s' abcd | /usr/bin/wc -c" },
        expected: { status: "passed", exitCode: 0, stdout: "4\n" },
      },
      {
        id: "sequence",
        purpose: "Read the bounded sequence only after the count succeeds",
        prerequisites: ["pipeline"],
        intent: {
          kind: "argv",
          executable: "/usr/bin/seq",
          args: ["1", "500"],
        },
        expected: {
          status: "output-truncated",
          exitCode: 0,
          stdout: sequence.slice(0, 1024),
        },
      },
      {
        id: "compare",
        purpose: "Compare only a complete sequence",
        prerequisites: ["sequence"],
        intent: {
          kind: "argv",
          executable: "/usr/bin/printf",
          args: ["complete"],
        },
        expected: null,
      },
    ],
  },
];

export function terminalCheckWorld(id: string) {
  const world = managedTerminalCheckWorlds.find(
    (candidate) => candidate.id === id,
  );
  if (!world) throw new Error("Unknown terminal checks assignment");
  return world;
}
