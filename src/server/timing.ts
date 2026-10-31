// Stage timings for the slow server calls. Each list call writes ONE line to
// the execution log (console.log reaches the Executions page of the Apps
// Script editor), so a real load shows which stage costs the time: RSS,
// durations, Watch Later, community titles. The Executions page alone shows
// only the total of each call.

export interface Stopwatch {
  /** Ends the current stage and records it under this name. */
  lap: (stage: string, detail?: string) => void;
  /** The log line: the label, the total so far, then every stage. */
  summary: () => string;
}

export function startStopwatch(
  label: string,
  now: () => number = Date.now,
): Stopwatch {
  const startedAt: number = now();
  let stageStartedAt: number = startedAt;
  const stages: string[] = [];
  return {
    lap: (stage: string, detail?: string): void => {
      const at: number = now();
      stages.push(
        stage +
          " " +
          (at - stageStartedAt) +
          "ms" +
          (detail ? " (" + detail + ")" : ""),
      );
      stageStartedAt = at;
    },
    summary: (): string =>
      [label + " " + (now() - startedAt) + "ms", ...stages].join(" | "),
  };
}
