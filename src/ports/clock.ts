/**
 * What time it is, in milliseconds since the epoch.
 *
 * A port rather than `Date.now()` so that whoever decides what "now" means
 * for a piece of work, such as one evaluation of a query, reads the clock
 * once and passes it on, and a test can hold the clock still.
 */
export interface Clock {
  now(): number;
}
