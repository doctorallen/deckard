/**
 * How far along something is, as a thin bar: a tag's tasks on its page and
 * in Home's Progress widget. The words beside it say the same, so the bar is
 * hidden from assistive technology rather than read as a second figure.
 */

import { progressPercent } from '../../domain/tasks/progressCount';

/** A bar `done` of `total` long; nothing when there is nothing to count. */
export function ProgressBar({ done, total }: { readonly done: number; readonly total: number }) {
  if (!total) {
    return null;
  }
  const complete = done >= total;
  // Only all of it fills the bar, as the words beside it say (progressCount.ts).
  const percent = progressPercent(done, total);
  return (
    <span class={complete ? 'progress-bar is-complete' : 'progress-bar'} aria-hidden="true">
      <span class="progress-bar-fill" style={{ width: `${percent}%` }} />
    </span>
  );
}
