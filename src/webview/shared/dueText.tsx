import type { ComponentChildren } from 'preact';

import type { DueParts } from '../../ui/protocol/shared';

/**
 * A due date drawn in its parts, as the host gave them: the state, which is
 * always drawn so an overdue date always says "Overdue"; how far off it is;
 * and the date, each in its own element, with Zen on or off. A wording with
 * no date of its own to draw, as "Due 2026-12-25" beyond a month, is drawn
 * whole, since the date is then all there is to go on.
 */
export function DueText({ parts, dateClass }: { readonly parts: DueParts; readonly dateClass?: string }): ComponentChildren {
  if (!parts.date) {
    return parts.state;
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
