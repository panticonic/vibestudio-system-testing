export const managedDictationWorlds = [
  {
    id: "recording-not-yet-supplied",
    goal: "Check offline dictation readiness before I record. Identify the starting step when there is no assigned audio.",
    samples: null,
    sample: 0,
    recording: "absent",
    durationMs: null,
    windowed: false,
  },
  {
    id: "invalid-normalized-capture",
    goal: "Review the assigned recording for speech input. Determine whether its samples satisfy the local float32 PCM contract before preparing or transcribing anything.",
    samples: 16000,
    sample: 1.5,
    recording: "invalid-sample",
    durationMs: 1000,
    windowed: false,
  },
  {
    id: "multi-window-readiness",
    goal: "Review a 31-second normalized mono recording for offline dictation. Explain the local worker status and whether the recording spans more than one inference window.",
    samples: 496000,
    sample: 0.25,
    recording: "valid",
    durationMs: 31000,
    windowed: true,
  },
] as const;
