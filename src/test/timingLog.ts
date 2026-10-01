import { setTimingLog } from '../shared/timing';

/**
 * Runs `run` with the timing log kept at `logLevel` (Debug unless said;
 * Trace is 1), and adds each line it writes to `lines`, as it is written,
 * with its milliseconds written as N and any Slow: dropped, so a test can
 * say what a page wrote whatever the machine. Returns `lines`.
 */
export function captureTimingLog(run: () => void, lines: string[] = [], logLevel = 2): string[] {
  const keep = (message: string): void =>
    void lines.push(message.replace(/^Slow: /, '').replace(/: \d+\.\d ms/, ': N ms'));
  setTimingLog({ logLevel, trace: keep, debug: keep, info: keep });
  try {
    run();
  } finally {
    setTimingLog(undefined);
  }
  return lines;
}
