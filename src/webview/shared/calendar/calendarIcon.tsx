/**
 * The calendar glyph, as the host's icons.ts strokes it: a week's rail on
 * both calendars, and a daily note's row in the day panel. Hidden from
 * assistive technology: its control carries the name.
 */
export function CalendarIcon() {
  return (
    <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
      <path d="M2.5 6.5h11M6 3.5v3M10 3.5v3" />
    </svg>
  );
}
