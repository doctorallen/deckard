/**
 * The bar at the top of every Deckard page, one action model for all of
 * them: DECKARD ▾ and the page's title at the left; at the right at most
 * one filled `.primary`, up to three secondaries, and one ⋯.
 *
 * Each page built its own row before: Theme, Page width and Zen were copied
 * into every gear, Home had no ?, the Notes Graph had no header, and the
 * search page split its gear from ‹ › and ?. The ⋯ replaces the gear and
 * the ? alike. It is the shared disclosure (`viewOptions.tsx`) with three
 * dots, and its rows are flat, in sections, in one order on every page:
 * the page's own actions, its view, Appearance, Help on this page, and
 * Keyboard shortcuts where the page has a key sheet. Zen draws the bar
 * as it is.
 */
import type { ComponentChildren } from 'preact';

import { Eyebrow } from './eyebrow';
import { EllipsisIcon } from './strokeIcons';
import {
  pageWidthOption,
  themeOption,
  type ViewOptionGroup,
  type ViewOptionItem,
  type ViewOptionRow,
  ViewOptions,
  type ViewOptionSection,
  zenOption,
} from './viewOptions';

/** What a page's ⋯ holds, by section; Appearance and Help are the same on every page. */
export interface PageMenuOptions {
  /** The page's own actions, such as Save search…, first. */
  readonly actions?: readonly ViewOptionItem[];
  /** How the page is shown, such as its columns: the rows the gear held. */
  readonly view?: readonly ViewOptionGroup[];
  /** Whether Appearance offers Page width: on Home, a search page, and the note page. */
  readonly pageWidth?: boolean;
  /** Whether the page answers `?` with a key sheet, which a last row opens too. */
  readonly keySheet?: boolean;
}

/** The Help row: Help, at the page's own section, which the page's host names. */
const HELP_ROW: ViewOptionItem = { action: 'page-help', text: 'Help on this page' };

/** The key sheet's row, with the key that opens it. */
const KEYS_ROW: ViewOptionItem = { action: 'open-key-sheet', text: 'Keyboard shortcuts', key: '?' };

/** The ⋯'s sections, in their one order, leaving out any with no rows. */
export function pageMenuSections(options: PageMenuOptions): ViewOptionSection[] {
  const appearance: ViewOptionGroup[] = [themeOption(), zenOption(), ...(options.pageWidth ? [pageWidthOption()] : [])];
  const sections: ViewOptionSection[] = [
    { label: 'Page', rows: options.actions || [] },
    { label: 'View', heading: true, rows: options.view || [] },
    { label: 'Appearance', heading: true, rows: appearance },
    { label: 'Help', rows: options.keySheet ? [HELP_ROW, KEYS_ROW] : [HELP_ROW] },
  ];
  return sections.filter((section) => section.rows.length > 0);
}

/** A row's name, as the ⋯'s tip lists it: Save search, not Save search…. */
function rowName(row: ViewOptionRow): string {
  return ('action' in row ? row.text : row.label).replace(/…$/, '');
}

/**
 * The ⋯'s name and tip: what its first rows are, so a reader looking for
 * a moved control is told where it went before opening it.
 */
export function describePageMenu(sections: readonly ViewOptionSection[]): string {
  const names = sections.flatMap((section) => section.rows.map(rowName));
  const top = names.slice(0, 3).join(', ');
  return names.length > 3 ? `More: ${top}, and more` : `More: ${top}`;
}

/** The page's ⋯, drawn with its sections. */
export function PageMenu(options: PageMenuOptions) {
  const sections = pageMenuSections(options);
  return <ViewOptions sections={sections} label={describePageMenu(sections)} icon={<EllipsisIcon />} className="page-menu" />;
}

/** What a page's bar is drawn from. */
export interface PageBarProps {
  /** Where the page is, after DECKARD ▾, such as `TASK BOARD`. */
  readonly trail: string;
  /** The title, with anything the page draws under it, such as a note's breadcrumbs. */
  readonly lead: ComponentChildren;
  /** The page's primary and secondaries, in order, at the right before ⋯. */
  readonly controls?: ComponentChildren;
  /** The ⋯'s rows; a page that has none draws no ⋯. */
  readonly menu?: PageMenuOptions;
  /** Classes after `page-bar`, for the page's own layout. */
  readonly className?: string;
  /** Classes after `page-bar-lead`. */
  readonly leadClass?: string;
  /** Classes after `page-bar-actions`. */
  readonly controlsClass?: string;
  /** The right-hand group's name, for a screen reader. */
  readonly label?: string;
}

/**
 * The bar: DECKARD ▾ and the title at the left, the page's own controls
 * and ⋯ at the right. Zen draws it as it is, with every control in place.
 */
export function PageBar({ trail, lead, controls, menu, className, leadClass, controlsClass, label = 'Page' }: PageBarProps) {
  return (
    <header class={className ? `page-bar ${className}` : 'page-bar'}>
      <div class={leadClass ? `page-bar-lead ${leadClass}` : 'page-bar-lead'}>
        <Eyebrow trail={trail} />
        {lead}
      </div>
      {/* Focus moving here keeps words typed in the page's search box, which Save search… saves. */}
      <div class={controlsClass ? `page-bar-actions ${controlsClass}` : 'page-bar-actions'} role="group" aria-label={label} data-query-keeps-text="">
        {controls}
        {menu ? <PageMenu {...menu} /> : null}
      </div>
    </header>
  );
}
