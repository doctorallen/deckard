/**
 * The stroked glyphs the shared controls draw, as the host's icons.ts
 * writes them with `strokeIcon`: one 16 by 16 drawing at one weight, in the
 * color of the control it sits in, hidden from assistive technology, since
 * its control carries the name.
 */
import type { ComponentChildren } from 'preact';

/** One stroked glyph: its paths in the shared frame, under `className`. */
export function StrokeIcon({ className, children }: { readonly className?: string; readonly children: ComponentChildren }) {
  return (
    <svg
      class={className ?? 'toolbar-icon'}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {children}
    </svg>
  );
}

/** Three dots: a control that opens a menu of what can be done to its entry. */
export function EllipsisIcon() {
  return (
    <StrokeIcon>
      <circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

/** A check: a menu's single choice, where the entry is now. */
export function CheckIcon() {
  return (
    <StrokeIcon>
      <path d="m3.5 8.5 3 3 6-7" />
    </StrokeIcon>
  );
}

/** Two arrows, up and down, beside a control that sorts. */
export function SortIcon() {
  return (
    <StrokeIcon className="control-icon-svg">
      <path d="M5 3v10m-2-8 2-2 2 2m4 8V3m-2 8 2 2 2-2" />
    </StrokeIcon>
  );
}
