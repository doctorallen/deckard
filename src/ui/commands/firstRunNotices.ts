import { reportError } from '../../shared/timing';

/**
 * The first index's notices, one to an activation.
 *
 * Once a workspace's first index was done, up to four notices could arrive
 * together: the offer to import a vault's statuses or to move status tags,
 * what the index read, tasks whose status Deckard doesn't know, and a
 * suggested theme. Each notice is now a step that says whether it spoke,
 * and the steps are tried in order until one does. Each keeps its own flag,
 * written only when it speaks, so one passed over is said on a later
 * activation; what the first index read is the exception, since it is
 * about a workspace's first activation and is not said late.
 */

/** One notice: says it when it should, and resolves to whether it did. */
export interface FirstRunNotice {
  readonly say: () => Promise<boolean>;
  /** What the log says when the notice fails, before the next one is tried. */
  readonly failure: string;
}

/**
 * Tries each notice in order until one is said. A notice that fails is
 * reported and passed over, as each was when they ran side by side.
 * @returns The position of the notice said, or -1 when none was.
 */
export async function sayOneNotice(notices: readonly FirstRunNotice[]): Promise<number> {
  for (const [position, notice] of notices.entries()) {
    try {
      if (await notice.say()) {
        return position;
      }
    } catch (error: unknown) {
      reportError(notice.failure, error);
    }
  }
  return -1;
}
