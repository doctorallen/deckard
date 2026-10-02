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

/** Three lines of falling length, beside a control that sets how many lines or rows. */
export function LinesIcon() {
  return (
    <StrokeIcon className="control-icon-svg">
      <path d="M3 5h10M3 8h7M3 11h4" />
    </StrokeIcon>
  );
}

/** A frame with a tab across its top: results shown one kind at a time. */
export function LayoutTabsIcon() {
  return (
    <StrokeIcon>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M2 6h12M5 2.5V6" />
    </StrokeIcon>
  );
}

/** A frame split in two: results shown side by side. */
export function LayoutSplitIcon() {
  return (
    <StrokeIcon>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M9 2v12" />
    </StrokeIcon>
  );
}

/** An eye: a note drawn as formatted Markdown. */
export function RenderedIcon() {
  return (
    <StrokeIcon>
      <path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4Z" />
      <circle cx="8" cy="8" r="1.75" />
    </StrokeIcon>
  );
}

/** A frame around angle brackets: a note shown as its Markdown source. */
export function SourceIcon() {
  return (
    <StrokeIcon>
      <path d="M3.5 3.5h9v9h-9zM5.5 6.5l-1.5 1.5 1.5 1.5M10.5 6.5 12 8l-1.5 1.5" />
    </StrokeIcon>
  );
}

/** An arrow leaving a box: a control that opens what it names in a tab of its own. */
export function OpenInNewIcon() {
  return (
    <StrokeIcon>
      <path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
    </StrokeIcon>
  );
}
