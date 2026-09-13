import { performance } from 'perf_hooks';

/**
 * Measures Deckard's work and reports it to a log, so a slow machine can be
 * diagnosed from an installed extension rather than only from a debugger.
 *
 * Every measurement is written at Debug level, and one that takes
 * `SLOW_OPERATION_MS` or longer is also written at Info, the level VS Code
 * keeps by default. A line is only formatted when the log will keep it, so
 * measuring costs next to nothing while the log is at its default level.
 */

/** VS Code's log levels, numbered as `vscode.LogLevel` numbers them. */
const LogLevel = { off: 0, trace: 1, debug: 2, info: 3 } as const;

/** Where lines go. VS Code's `LogOutputChannel` is one. */
export interface TimingLog {
  readonly logLevel: number;
  trace(message: string): void;
  debug(message: string): void;
  info(message: string): void;
}

/** A measurement at least this long is reported even at the default level. */
export const SLOW_OPERATION_MS = 100;

let log: TimingLog | undefined;

/** Sends measurements to `next`, or stops reporting them when undefined. */
export function setTimingLog(next: TimingLog | undefined): void {
  log = next;
}

/**
 * Runs `run` and reports how long it took. `describe` adds context, such as
 * how many notes were involved, and is only called when the line is written.
 */
export function measure<T>(
  operation: string,
  run: () => T,
  describe?: (result: T) => string,
): T {
  if (!log) {
    return run();
  }
  const start = performance.now();
  let result: T | undefined;
  try {
    result = run();
    return result;
  } finally {
    report(
      operation,
      performance.now() - start,
      describe && result !== undefined ? () => describe(result as T) : undefined,
    );
  }
}

/** `measure` for work that finishes later. */
export async function measureAsync<T>(
  operation: string,
  run: () => Promise<T>,
  describe?: (result: T) => string,
): Promise<T> {
  if (!log) {
    return run();
  }
  const start = performance.now();
  let result: T | undefined;
  try {
    result = await run();
    return result;
  } finally {
    report(
      operation,
      performance.now() - start,
      describe && result !== undefined ? () => describe(result as T) : undefined,
    );
  }
}

/** Writes a Trace line, building it only when the log keeps Trace lines. */
export function logTrace(message: () => string): void {
  if (log && keeps(log, LogLevel.trace)) {
    log.trace(message());
  }
}

function report(
  operation: string,
  milliseconds: number,
  describe: (() => string) | undefined,
): void {
  if (!log) {
    return;
  }
  const slow = milliseconds >= SLOW_OPERATION_MS;
  if (!slow && !keeps(log, LogLevel.debug)) {
    return;
  }
  const detail = describe ? ` (${describe()})` : '';
  const line = `${operation}: ${milliseconds.toFixed(1)} ms${detail}`;
  if (slow) {
    log.info(`Slow: ${line}`);
  } else {
    log.debug(line);
  }
}

function keeps(target: TimingLog, level: number): boolean {
  return target.logLevel !== LogLevel.off && target.logLevel <= level;
}
