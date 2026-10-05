import type { ComponentChildren } from 'preact';

import { splitDueLabel } from './dueParts';

/**
 * A due label drawn in its parts. The date stays drawn under "relative"
 * whenever the wording gives no distance, as "Overdue · 2026-07-01" beyond a
 * month does, since the date is then all there is to go on.
 */
export function DueText({ label, dateClass }: { readonly label: string; readonly dateClass?: string }): ComponentChildren {
  const parts = splitDueLabel(label);
  if (!parts.date) {
    return label;
  }
  const relative = Boolean(parts.distance) || /today/i.test(parts.state);
  const classes = relative ? 'due-text due-relative' : 'due-text';
  return (
    <span class={classes}>
      {parts.state}
      {parts.distance ? <span class="due-distance">{parts.distance}</span> : null}
      <span class="due-on">
        <span class="due-sep"> · </span>
        <span class={dateClass}>{parts.date}</span>
      </span>
    </span>
  );
}
