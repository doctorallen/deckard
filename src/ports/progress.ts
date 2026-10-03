/** One step of a task's progress: what it is doing now, and how far it moved. */
export interface ProgressStep {
  readonly message?: string;
  /** How much of the whole this step adds, in percent. */
  readonly increment?: number;
}

/** What a task running under {@link Progress} tells it as it goes. */
export interface ProgressReport {
  report(step: ProgressStep): void;
}

/**
 * Shows a long task's progress where the window shows background work, as
 * `vscode.window.withProgress` does in the status bar.
 *
 * The caller names the task; the platform decides where and how it is
 * shown, so the core never names a VS Code location, and a test can run the
 * task with nothing shown at all.
 */
export interface Progress {
  /**
   * Runs `task`, showing `title` and each step it reports until it settles.
   * The task cannot be cancelled. Settles as the task does.
   */
  withProgress<R>(
    title: string,
    task: (progress: ProgressReport) => PromiseLike<R>,
  ): PromiseLike<R>;
}
