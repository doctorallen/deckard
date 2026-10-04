/**
 * How far along something is, as a thin bar: a tag's tasks on its page and
 * in Home's Progress widget. The words beside it say the same, so the bar is
 * hidden from assistive technology rather than read as a second figure.
 */

/** A bar `done` of `total` long; nothing when there is nothing to count. */
export function ProgressBar({ done, total }: { readonly done: number; readonly total: number }) {
  if (!total) {
    return null;
  }
  const complete = done >= total;
  // Only all of it fills the bar: 199 of 200 would round to a full, finished-looking one.
  const percent = complete ? 100 : Math.max(0, Math.min(99, Math.round((done / total) * 100)));
  return (
    <span class={complete ? 'progress-bar is-complete' : 'progress-bar'} aria-hidden="true">
      <span class="progress-bar-fill" style={{ width: `${percent}%` }} />
    </span>
  );
}
