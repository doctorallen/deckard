/**
 * The gear: a page's view options, in a disclosure that opens a menu of
 * rows, each a label over its choices. The theme and zen rows are the same
 * on every page that has a gear.
 */
import type { ComponentChildren } from 'preact';

import { SettingsIcon } from './icons';
import { post } from './vscode';

/** One row of the gear's menu: its label, over its choices. */
export interface ViewOptionGroup {
  readonly label: string;
  /** The choices, below the label rather than beside it. */
  readonly stacked?: boolean;
  readonly content: ComponentChildren;
}

/**
 * The gear and its menu. The menu stays as the reader left it, open or
 * closed, across a redraw of the page.
 */
export function ViewOptions({ groups }: { readonly groups: readonly ViewOptionGroup[] }) {
  const wasOpen = Boolean(document.querySelector('.view-options[open]'));
  return (
    <details class="view-options" open={wasOpen}>
      <summary aria-label="View options" data-tip="View options"><SettingsIcon /></summary>
      <div class="view-options-menu popover is-dropdown">
        {groups.map((group) => (
          <div class={group.stacked ? 'view-options-group is-stacked' : 'view-options-group'}>
            <span>{group.label}</span>
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
 * The gear's zen row, the same on every page that has a gear. Whether zen
 * is on is read from the body's class rather than from the page's snapshot,
 * so no page has to carry it through its state builder.
 */
export function zenOption(): ViewOptionGroup {
  const enabled = document.body.classList.contains('zen');
  return {
    label: 'Zen',
    content: (
      <ViewOptionChoices action="set-zen-mode" choices={[['off', 'Off'], ['on', 'On']]} selected={enabled ? 'on' : 'off'} label="Zen mode" />
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
 * The gear's theme row, directly above zen on every page with a gear: one
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
 * The zen and theme rows are handled here rather than by each page: they
 * post through the page's one handle, and the host redraws the page.
 */
export function installViewOptions(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const closest = (selector: string): HTMLElement | null =>
      (target?.closest ? target.closest<HTMLElement>(selector) : null);
    const zen = closest('[data-action="set-zen-mode"]');
    if (zen) {
      post({ type: 'setZenMode', enabled: zen.dataset.value === 'on' });
    }
    if (closest('[data-action="choose-theme"]')) {
      post({ type: 'chooseTheme' });
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
