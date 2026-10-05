// A clock a test moves by hand, for code that waits on timers.
//
// A test that waits real time for a page's 400 ms pause, or a debouncer's
// delay, spends that time doing nothing, and a loaded machine stretches it.
// Installed over a page's window, or over Node's own globals for a while,
// this takes over setTimeout, setInterval, their clears, and Date.now, so a
// test says how much time passes and every timer due by then runs, in the
// order it fell due, at once.
//
// Each timer path keeps one test on the real clock (debounce.test.ts,
// query-builder-webview.test.ts, webview-saved-state.test.ts, calendar.test.ts),
// so a bug only real timers show, such as a callback that throws when the
// runtime calls it, still fails somewhere.

/** The timer functions and clock a manual clock replaces on its target. */
interface TimerHost {
  setTimeout: unknown;
  clearTimeout: unknown;
  setInterval: unknown;
  clearInterval: unknown;
  Date: DateConstructor;
}

/** A clock a test moves by hand. */
export interface ManualClock {
  /** Milliseconds moved since the clock was installed. */
  readonly elapsed: number;
  /** How many timers are waiting. */
  readonly pending: number;
  /** Moves the clock on, running every timer due by then in the order each fell due. */
  advance(milliseconds: number): void;
  /** Puts back the target's own timers and clock. */
  restore(): void;
}

/** One waiting timer. */
interface Timer {
  due: number;
  run: () => void;
  every?: number;
}

/**
 * Replaces a target's timers and Date.now with a clock that moves only when
 * told. The target is a page's window, before its script runs, or
 * `globalThis` for code that runs in Node; Date.now starts at the target's
 * real time and moves with the clock.
 * @param target The window or global object whose timers to take over.
 * @returns The clock, to move and later restore.
 */
export function installManualClock(target: TimerHost): ManualClock {
  const restoreOwn = keepOwn(target);
  const start = target.Date.now();
  const timers = new Map<number, Timer>();
  let elapsed = 0;
  let nextId = 1;
  const add = (callback: unknown, delay: unknown, args: unknown[], repeat: boolean): number => {
    const id = nextId;
    nextId += 1;
    const wait = Math.max(0, Number(delay) || 0);
    const run = (): void => {
      if (typeof callback === 'function') {
        callback(...args);
      }
    };
    timers.set(id, { due: elapsed + wait, run, every: repeat ? Math.max(1, wait) : undefined });
    return id;
  };
  const clear = (id: unknown): void => {
    timers.delete(Number(id));
  };
  const define = (holder: object, name: string, value: unknown): void => {
    Object.defineProperty(holder, name, { configurable: true, writable: true, value });
  };
  define(target, 'setTimeout', (callback: unknown, delay?: unknown, ...args: unknown[]) => add(callback, delay, args, false));
  define(target, 'clearTimeout', clear);
  define(target, 'setInterval', (callback: unknown, delay?: unknown, ...args: unknown[]) => add(callback, delay, args, true));
  define(target, 'clearInterval', clear);
  define(target.Date, 'now', () => start + elapsed);

  return {
    get elapsed() {
      return elapsed;
    },
    get pending() {
      return timers.size;
    },
    advance(milliseconds: number): void {
      const until = elapsed + milliseconds;
      for (let due = nextDue(timers, until); due; due = nextDue(timers, until)) {
        const [id, timer] = due;
        elapsed = timer.due;
        if (timer.every === undefined) {
          timers.delete(id);
        } else {
          timer.due += timer.every;
        }
        timer.run();
      }
      elapsed = until;
    },
    restore(): void {
      restoreOwn();
      timers.clear();
    },
  };
}

/** The timer due soonest by `until`, the earliest set first among equals. */
function nextDue(timers: Map<number, Timer>, until: number): [number, Timer] | undefined {
  let found: [number, Timer] | undefined;
  for (const entry of timers) {
    if (entry[1].due <= until && (!found || entry[1].due < found[1].due)) {
      found = entry;
    }
  }
  return found;
}

/**
 * Notes a target's own timers and Date.now, before a clock replaces them.
 * @param target The window or global object.
 * @returns What puts them back.
 */
function keepOwn(target: TimerHost): () => void {
  const names = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const;
  const own = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(target, name)]));
  const now = Object.getOwnPropertyDescriptor(target.Date, 'now');
  return () => {
    for (const [name, descriptor] of own) {
      if (descriptor) {
        Object.defineProperty(target, name, descriptor);
      } else {
        delete (target as unknown as Record<string, unknown>)[name];
      }
    }
    if (now) {
      Object.defineProperty(target.Date, 'now', now);
    }
  };
}
