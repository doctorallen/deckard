/**
 * Trailing-edge debouncing for the editor's providers and views, which redraw
 * or recount once typing pauses rather than on every keystroke. Each class
 * used to keep its own timer and clear it again in `dispose`; these hold the
 * timer, so a provider cannot forget to release one. Nothing here reaches
 * `vscode`.
 */

/** A pending timer, whatever the runtime's `setTimeout` returns for one. */
type Handle = ReturnType<typeof setTimeout>;

/**
 * One pending run at a time. Each `schedule` replaces the run still waiting,
 * if any, and starts the wait again, so only the last call of a burst runs,
 * `delayMs` after it.
 */
export class Debouncer {
  private handle: Handle | undefined;

  /** A debouncer whose runs wait `delayMs` after the last call. */
  public constructor(private readonly delayMs: number) {}

  /** Whether a run is waiting. */
  public get pending(): boolean {
    return this.handle !== undefined;
  }

  /** Runs `run` after `delayMs` unless another call comes first and takes its place. */
  public schedule(run: () => void): void {
    this.cancel();
    this.handle = setTimeout(() => {
      this.handle = undefined;
      run();
    }, this.delayMs);
  }

  /** Drops the waiting run, if any, without running it. */
  public cancel(): void {
    if (this.handle === undefined) {
      return;
    }
    clearTimeout(this.handle);
    this.handle = undefined;
  }

  /**
   * Drops the waiting run, so a late one cannot outlive its owner. A later
   * `schedule` still waits and runs as before, as the owners' own timers did.
   */
  public dispose(): void {
    this.cancel();
  }
}

/**
 * One pending run per key, such as a document's URI: a burst of changes to
 * one note runs once, and a change to another note neither restarts nor
 * drops the first note's wait.
 */
export class KeyedDebouncer {
  private readonly handles = new Map<string, Handle>();

  /** A debouncer whose runs wait `delayMs` after the last call for their key. */
  public constructor(private readonly delayMs: number) {}

  /** Whether a run is waiting for `key`. */
  public isPending(key: string): boolean {
    return this.handles.has(key);
  }

  /**
   * Runs `run` after `delayMs` unless another call for the same key comes
   * first and takes its place. The key is forgotten before `run` starts, so
   * a run that schedules again for its own key waits anew.
   */
  public schedule(key: string, run: () => void): void {
    clearTimeout(this.handles.get(key));
    this.handles.set(
      key,
      setTimeout(() => {
        this.handles.delete(key);
        run();
      }, this.delayMs),
    );
  }

  /** Drops the run waiting for `key`, if any, without running it. */
  public cancel(key: string): void {
    clearTimeout(this.handles.get(key));
    this.handles.delete(key);
  }

  /**
   * Drops every waiting run, so a late one cannot outlive its owner. A later
   * `schedule` still waits and runs as before, as the owners' own timers did.
   */
  public dispose(): void {
    this.handles.forEach((handle) => clearTimeout(handle));
    this.handles.clear();
  }
}
