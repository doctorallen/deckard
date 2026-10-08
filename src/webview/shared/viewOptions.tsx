/**
 * The gear: a page's view options, in a disclosure that opens a menu of
 * rows, each a label over its choices. The theme, page width, and Zen rows
 * are the same on every page that has a gear.
 */
import type { ComponentChildren } from 'preact';

import { SettingsIcon } from './icons';
import { post } from './vscode';

/** One row of the gear's menu: its label, over its choices. */
export interface ViewOptionGroup {
  readonly label: string;
  /** The id of the one control the label names, so a click on the label reaches it. */
  readonly labelFor?: string;
  /** The choices, below the label rather than beside it. */
  readonly stacked?: boolean;
  readonly content: ComponentChildren;
}

/**
 * The gear and its menu. The menu stays as the reader left it, open or
 * closed, across a redraw of the page. A page with a second gear names it,
 * so each is kept open or closed on its own, and labels it for what it sets.
 */
export function ViewOptions({ groups, name, label = 'View options' }: { readonly groups: readonly ViewOptionGroup[]; readonly name?: string; readonly label?: string }) {
  const wasOpen = Boolean(document.querySelector(name ? `.view-options[data-options="${name}"][open]` : '.view-options:not([data-options])[open]'));
  return (
    <details class="view-options" open={wasOpen} data-options={name}>
      <summary aria-label={label} data-tip={label}><SettingsIcon /></summary>
      <div class="view-options-menu popover is-dropdown">
        {groups.map((group) => (
          <div class={group.stacked ? 'view-options-group is-stacked' : 'view-options-group'}>
            {group.labelFor ? <label for={group.labelFor}>{group.label}</label> : <span>{group.label}</span>}
            {group.content}
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
 * The gear's Zen row, the same on every page that has a gear: one checkbox,
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
 * The gear's Page width row: limited to a 1000px column, or the panel's full
 * width. Read from the body's marker, as the Zen row is. The Task Board
 * and the Calendar always use the full width, so their gears leave it out.
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
 * The gear's theme row, at the top on every page with a gear: one
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
 * Closes the gear's menu on a click outside it, and on Escape, handing focus
 * back to the gear. Call once, before the page's own listeners, so a click
 * that redraws the page is seen while its target is still in the menu.
 *
 * The Zen, Page width, and theme rows are handled here rather than by each
 * page: they post through the page's one handle, and the host redraws the
 * page.
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
    const inside = closest('.view-options');
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
