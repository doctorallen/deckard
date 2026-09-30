/**
 * Where measurements and diagnostics are written: VS Code's log output
 * channel has this shape, and a test can pass a list.
 *
 * `logLevel` is VS Code's numbering (off 0, trace 1, debug 2, info 3), so a
 * line is formatted only when the log will keep it.
 */
export interface Log {
  readonly logLevel: number;
  trace(message: string): void;
  debug(message: string): void;
  info(message: string): void;
  /** Optional on a test's log; VS Code's channel has it. */
  error?(message: string): void;
}
