/**
 * A page's options, in a disclosure that opens a menu of rows. Context's
 * gears list rows of a label over its choices; a page's ⋯ (`pageBar.tsx`)
 * lists its own actions, then its view, then Appearance, then Help, as
 * sections of the same menu. The theme, page width, and Zen rows are the
 * same on every page.
 */
import type { ComponentChildren } from 'preact';

import { SettingsIcon } from './icons';
import { CheckIcon } from './strokeIcons';
import { post } from './vscode';

/** One row of the menu: its label, over its choices. */
export interface ViewOptionGroup {
  readonly label: string;
  /** The id of the one control the label names, so a click on the label reaches it. */
  readonly labelFor?: string;
  /** The choices, below the label rather than beside it. */
  readonly stacked?: boolean;
  readonly content: ComponentChildren;
}

/** A row of the menu that does one thing when chosen, such as Save search…. */
export interface ViewOptionItem {
  /** The `data-action` it runs. */
  readonly action: string;
  readonly text: string;
  readonly tip?: string;
  /** The key that does the same, shown at the row's end. */
  readonly key?: string;
  /** Set for a switch: whether it is on, which a check beside it shows. */
  readonly pressed?: boolean;
  /** Why it cannot act now, which holds it with `aria-disabled` and says so in its tip. */
  readonly disabledReason?: string;
  /** Any other attributes it carries, by name. */
  readonly attributes?: Readonly<Record<string, string>>;
}

/** Either kind of row. */
export type ViewOptionRow = ViewOptionGroup | ViewOptionItem;

/**
 * Rows that belong together, such as Appearance's, a group to a screen
 * reader by `label`, and drawn under it when `heading` says so.
 */
export interface ViewOptionSection {
  readonly label: string;
  readonly heading?: boolean;
  readonly rows: readonly ViewOptionRow[];
}

/** One row that does one thing: a menu item, with a check while a switch is on. */
function ItemRow({ item }: { readonly item: ViewOptionItem }) {
  const isSwitch = item.pressed !== undefined;
  return (
    <button
      type="button"
      class="menu-item view-options-item"
      data-action={item.action}
      {...item.attributes}
      aria-pressed={isSwitch ? item.pressed : undefined}
      aria-keyshortcuts={item.key || undefined}
      data-tip={item.tip || undefined}
      aria-disabled={item.disabledReason ? 'true' : undefined}
      data-tip-disabled={item.disabledReason || undefined}
    >
      {isSwitch ? <span class="menu-check" aria-hidden="true">{item.pressed ? <CheckIcon /> : null}</span> : null}
      <span class="menu-label">{item.text}</span>
      {item.key ? <kbd class="menu-key" aria-hidden="true">{item.key}</kbd> : null}
    </button>
  );
}

/** One row of a label over its choices. */
function GroupRow({ group }: { readonly group: ViewOptionGroup }) {
  return (
    <div class={group.stacked ? 'view-options-group is-stacked' : 'view-options-group'}>
      {group.labelFor ? <label for={group.labelFor}>{group.label}</label> : <span>{group.label}</span>}
      {group.content}
    </div>
  );
}

/** Either kind of row, by what it holds. */
function Row({ row }: { readonly row: ViewOptionRow }) {
  return 'action' in row ? <ItemRow item={row} /> : <GroupRow group={row} />;
}

/** What a disclosure of options is drawn from. */
export interface ViewOptionsProps {
  /** The rows of a menu with no sections, such as Context's gears. */
  readonly groups?: readonly ViewOptionGroup[];
  /** The rows of a menu in sections, such as a page's ⋯. */
  readonly sections?: readonly ViewOptionSection[];
  readonly name?: string;
  /** Its accessible name and its tip. */
  readonly label?: string;
  /** What the disclosure shows: the gear unless it says. */
  readonly icon?: ComponentChildren;
  /** Classes after `view-options`. */
  readonly className?: string;
}

/**
 * The disclosure and its menu. The menu stays as the reader left it, open
 * or closed, across a redraw of the page. A page with a second gear names
 * it, so each is kept open or closed on its own, and labels it for what it
 * sets.
 */
export function ViewOptions({ groups, sections, name, label = 'View options', icon, className }: ViewOptionsProps) {
  const wasOpen = Boolean(document.querySelector(name ? `.view-options[data-options="${name}"][open]` : '.view-options:not([data-options])[open]'));
  return (
    <details class={className ? `view-options ${className}` : 'view-options'} open={wasOpen} data-options={name}>
      <summary aria-label={label} data-tip={label}>{icon ?? <SettingsIcon />}</summary>
      <div class="view-options-menu popover is-dropdown">
        {(groups || []).map((group) => <GroupRow group={group} />)}
        {(sections || []).map((section) => (
          <div class="view-options-section" role="group" aria-label={section.label}>
            {section.heading ? <div class="view-options-heading" aria-hidden="true">{section.label}</div> : null}
            {section.rows.map((row) => <Row row={row} />)}
          </div>
        ))}
      </div>
    </details>
  );
}

/** One choice of a row: its value, its words, and a fuller name where the words are short. */
export type ViewOptionChoice = readonly [value: string | number, text: string, ariaLabel?: string];

/** A row of choices for the gear's menu, such as List and Board. */
export interface ViewOptionChoicesProps {
  /** The `data-action` each choice runs, with its value in `data-value`. */
  readonly action: string;
  readonly choices: readonly ViewOptionChoice[];
  readonly selected: string | number | undefined;
  /** The group's accessible name. */
  readonly label: string;
  /** Any other attributes every choice carries, by name. */
  readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * A row of choices for the gear's menu: one pressed button per choice, the
 * one selected marked active.
 */
export function ViewOptionChoices(props: ViewOptionChoicesProps) {
  return (
    <div class="segmented view-options-choices" role="group" aria-label={props.label}>
      {props.choices.map((choice) => {
        const value = String(choice[0]);
        const active = value === String(props.selected);
        return (
          <button
            type="button"
            class={active ? 'active' : ''}
            data-action={props.action}
            data-value={value}
            {...props.attributes}
            aria-pressed={active}
            aria-label={choice[2] || undefined}
          >
            {choice[1]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The Zen row, in Appearance on every page's ⋯: one checkbox,
 * ticked while Zen is on, which the body's zen class says, as the page
 * shell wrote it from the setting.
 */
export function zenOption(): ViewOptionGroup {
  return {
    label: 'Zen',
    labelFor: 'view-options-zen',
    content: (
      <input type="checkbox" id="view-options-zen" class="view-options-check" data-action="set-zen" checked={document.body.classList.contains('zen')} />
    ),
  };
}

/**
 * The Page width row: limited to a 1000px column, or the panel's full
 * width. Read from the body's marker, as the Zen row is. Only Home, a
 * search page, and the note page offer it; the other pages always use the
 * full width, or set their own.
 */
export function pageWidthOption(): ViewOptionGroup {
  const full = document.body.dataset.width === 'full';
  return {
    label: 'Page width',
    content: (
      <ViewOptionChoices action="set-display" attributes={{ 'data-display': 'pageWidth' }} choices={[['limited', 'Limited'], ['full', 'Full']]} selected={full ? 'full' : 'limited'} label="Page width" />
    ),
  };
}

/**
 * The name of the theme the page is drawn in, as its shell wrote it when the
 * page was built; a new theme builds the page again.
 */
export function readThemeName(): string {
  return document.querySelector('meta[name="deckard-theme"]')?.getAttribute('content') ?? '';
}

/**
 * The theme row, at the top of Appearance on every page's ⋯: one
 * button naming the theme in use, which opens Choose Theme… to preview the
 * others on the open pages.
 */
export function themeOption(name: string = readThemeName()): ViewOptionGroup {
  return {
    label: 'Theme',
    content: (
      <button type="button" class="theme-choice" data-action="choose-theme" aria-label={`Theme: ${name}. Choose another`}>{`${name}…`}</button>
    ),
  };
}

/**
 * Closes a menu on a click outside it, on a row that does one thing, and on
 * Escape, handing focus back to its disclosure. Call once, before the
 * page's own listeners, so a click that redraws the page is seen while its
 * target is still in the menu.
 *
 * The Zen, Page width, theme, and Help on this page rows are handled here
 * rather than by each page: they post through the page's one handle, and
 * the host redraws the page, or opens Help at the page's own section.
 */
export function installViewOptions(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const closest = (selector: string): HTMLElement | null =>
      (target?.closest ? target.closest<HTMLElement>(selector) : null);
    if (closest('[data-action="choose-theme"]')) {
      post({ type: 'chooseTheme' });
    }
    const display = closest('[data-action="set-display"]');
    if (display && display.dataset.display && display.dataset.value) {
      post({ type: 'setDisplay', setting: display.dataset.display, value: display.dataset.value });
    }
    const zen = closest('[data-action="set-zen"]');
    if (zen) {
      post({ type: 'setZenMode', enabled: (zen as HTMLInputElement).checked });
    }
    if (closest('[data-action="page-help"]')) {
      post({ type: 'openHelp' });
    }
    // A row that does one thing has done it: the menu closes, and focus
    // goes back to ⋯ rather than into a closed menu.
    const item = closest('.view-options-item');
    const inside = item ? null : closest('.view-options');
    if (item) {
      item.closest('.view-options')?.querySelector<HTMLElement>('summary')?.focus();
    }
    document.querySelectorAll<HTMLDetailsElement>('.view-options[open]').forEach((options) => {
      if (options !== inside) {
        options.open = false;
      }
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    const options = document.querySelector<HTMLDetailsElement>('.view-options[open]');
    if (!options) {
      return;
    }
    options.open = false;
    options.querySelector('summary')?.focus();
  });
}
