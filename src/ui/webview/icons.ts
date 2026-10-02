/**
 * The stroked glyph set as HTML text. The pages draw their icons with
 * Preact (src/webview/shared/icons.tsx and strokeIcons.tsx, and the
 * Dashboard's icons.tsx); what is left here is the frame and the paths the
 * tests hold those drawings to (icons.test.ts, search-page-behavior.test.ts).
 * No host writes an icon into a page.
 */

/**
 * One 16px stroked glyph set for every control that carries an icon, so a
 * chevron on Home, a sort arrow on the Board, and a calendar in the sidebar
 * are the same drawing at the same weight. `strokeIcon` wraps a path in the
 * shared frame; `className` is the page's hook, `control-icon-svg` inside a
 * select's label or `toolbar-icon` inside a button.
 */
export function strokeIcon(paths: string, className = 'toolbar-icon'): string {
  return (
    `<svg class="${className}" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
    paths +
    '</svg>'
  );
}

/** The path each stroked glyph is drawn from. */
export const ICON_PATHS = {
  sort: '<path d="M5 3v10m-2-8 2-2 2 2m4 8V3m-2 8 2 2 2-2"/>',
  filter: '<path d="M2 3h12L9 8v4l-2 1V8L2 3Z"/>',
  lines: '<path d="M3 5h10M3 8h7M3 11h4"/>',
  chevronLeft: '<path d="M10 3 5 8l5 5"/>',
  chevronRight: '<path d="m6 3 5 5-5 5"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="M2.5 6.5h11M6 3.5v3M10 3.5v3"/>',
  calendarPlus: '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="M2.5 6.5h11M6 3.5v3M10 3.5v3M8 8v3M6.5 9.5h3"/>',
  dashboard: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx=".5"/><rect x="9" y="2.5" width="4.5" height="3" rx=".5"/><rect x="9" y="7.5" width="4.5" height="6" rx=".5"/><rect x="2.5" y="9" width="4.5" height="4.5" rx=".5"/>',
  openInNew: '<path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/>',
  link: '<path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.47 2.47 0 0 0-3.5-3.5l-.8.8"/><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.47 2.47 0 0 0 3.5 3.5l.8-.8"/>',
  layoutTabs: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6h12M5 2.5V6"/>',
  layoutSplit: '<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M9 2v12"/>',
  rendered: '<path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.75"/>',
  source: '<path d="M3.5 3.5h9v9h-9zM5.5 6.5l-1.5 1.5 1.5 1.5M10.5 6.5 12 8l-1.5 1.5"/>',
  zoomIn: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3M7 5v4M5 7h4"/>',
  zoomOut: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3M5 7h4"/>',
  fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  ellipsis: '<circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/>',
} as const;

export const renderedIcon = strokeIcon(ICON_PATHS.rendered);
export const sourceIcon = strokeIcon(ICON_PATHS.source);

