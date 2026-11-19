export const managedPdfLayoutWorlds = [
  {
    id: "deadlines-by-row",
    goal: "Read this owner-and-deadline table. Preserve the column titles and pair each owner with the deadline on the same row.",
    kind: "table",
    rows: [
      ["Owner", "Deadline"],
      ["Marta", "Friday"],
      ["Ilan", "Monday"],
    ],
    order: ["Owner", "Deadline", "Marta", "Friday", "Ilan", "Monday"],
  },
  {
    id: "parallel-narrative-columns",
    goal: "Recover the reading order of the two separate narrative columns. Finish the access note before starting the weather note.",
    kind: "columns",
    rows: [
      ["Road access", "Weather report"],
      ["Use the east gate.", "Rain starts at noon."],
      ["Bring the permit.", "Carry waterproof gear."],
    ],
    order: [
      "Road access",
      "Use the east gate.",
      "Bring the permit.",
      "Weather report",
      "Rain starts at noon.",
      "Carry waterproof gear.",
    ],
  },
  {
    id: "single-sequence",
    goal: "Recover the original order of the three notices in this single-column page.",
    kind: "sequence",
    rows: [
      ["Morning inspection"],
      ["Record the readings."],
      ["File the signed log."],
    ],
    order: [
      "Morning inspection",
      "Record the readings.",
      "File the signed log.",
    ],
  },
] as const;
