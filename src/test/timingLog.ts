import { setTimingLog } from '../shared/timing';

/**
 * Runs `run` with the timing log kept at Debug, and adds each line it
 * writes to `lines`, as it is written, with its milliseconds written as N
 * and any Slow: dropped, so a test can say what a page's refresh wrote
 * whatever the machine. Returns `lines`.
 */
export function captureTimingLog(run: () => void, lines: string[] = []): string[] {
  const keep = (message: string): void =>
    void lines.push(message.replace(/^Slow: /, '').replace(/: \d+\.\d ms/, ': N ms'));
  setTimingLog({ logLevel: 2, trace: () => undefined, debug: keep, info: keep });
  try {
    run();
  } finally {
    setTimingLog(undefined);
  }
  return lines;
}
