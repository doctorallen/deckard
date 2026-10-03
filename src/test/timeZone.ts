/**
 * Runs `run` with the process's time zone set to `zone`, and puts the zone
 * that was in force back after, whether `run` returns or throws.
 *
 * Node reads the time zone again only when TZ is assigned. Deleting TZ to
 * undo the change works on Linux and macOS, but on Windows the process keeps
 * the zone it was given, so every later test ran in New York's time. The
 * zone in force is read first and assigned back instead, which every system
 * reads again.
 */
export function inTimeZone<T>(zone: string, run: () => T): T {
  const before = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    process.env.TZ = before;
  }
}
