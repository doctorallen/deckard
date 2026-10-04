/**
 * The gear: a page's view options, in a disclosure that opens a menu of
 * rows, each a label over its choices. The theme, page width, Display,
 * cards, and tags rows are the same on every page that has a gear.
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

/** The scale's steps as the gear names them. */
const STEP_NAMES = { full: 'Full', quiet: 'Quiet', zen: 'Zen' } as const;

/**
 * The gear's Display row, the same on every page that has a gear: the three
 * steps as pressed buttons, then, when the reader has set any of the
 * settings the step moves, how many and a way to put the step's own values
 * back, and Customize…, which opens Settings on Display. Read from the
 * body's markers, which the page shell wrote from the settings.
 */
export function displayLevelOption(): ViewOptionGroup {
  const marked = document.body.dataset.level;
  const level = marked === 'quiet' || marked === 'zen' ? marked : 'full';
  const changed = Number(document.body.dataset.changed ?? 0);
  const name = STEP_NAMES[level];
  return {
    label: 'Display',
    stacked: true,
    content: (
      <div class="view-options-display">
        <ViewOptionChoices
          action="set-display"
          attributes={{ 'data-display': 'level' }}
          choices={[['full', 'Full'], ['quiet', 'Quiet'], ['zen', 'Zen']]}
          selected={level}
          label="Display"
        />
        {changed > 0 ? (
          <p class="view-options-changed">
            {`${name} · ${changed} changed · `}
            <button type="button" class="view-options-link" data-action="display-command" data-command="useStepValues">{`Use ${name}'s values`}</button>
          </p>
        ) : null}
        <button type="button" class="view-options-link" data-action="display-command" data-command="customize">Customize…</button>
      </div>
    ),
  };
}

/**
 * The gear's Page width row: a 1000px column, or the panel's whole width.
 * Read from the body's marker, as the Cards and Tags rows are.
 */
export function pageWidthOption(): ViewOptionGroup {
  const wide = document.body.dataset.width === 'wide';
  return {
    label: 'Page width',
    content: (
      <ViewOptionChoices action="set-display" attributes={{ 'data-display': 'pageWidth' }} choices={[['column', 'Column'], ['wide', 'Wide']]} selected={wide ? 'wide' : 'column'} label="Page width" />
    ),
  };
}

/**
 * The gear's Cards and Tags rows, the same on every page that has a gear:
 * raised cards or flat rows, and tags as chips or as text. What is chosen is
 * read from the body's markers, which the page shell wrote from the
 * settings, so no page carries it through its state builder.
 */
export function displayOptions(): ViewOptionGroup[] {
  const flat = document.body.dataset.cards === 'flat';
  const text = document.body.dataset.tags === 'text';
  return [
    {
      label: 'Cards',
      content: (
        <ViewOptionChoices action="set-display" attributes={{ 'data-display': 'cardFrames' }} choices={[['raised', 'Raised'], ['flat', 'Flat']]} selected={flat ? 'flat' : 'raised'} label="Cards" />
      ),
    },
    {
      label: 'Tags',
      content: (
        <ViewOptionChoices action="set-display" attributes={{ 'data-display': 'tags' }} choices={[['chips', 'Chips'], ['text', 'Text']]} selected={text ? 'text' : 'chips'} label="Tags" />
      ),
    },
  ];
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
 * The Display and theme rows are handled here rather than by each page: they
 * post through the page's one handle, and the host redraws the page.
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
    const command = closest('[data-action="display-command"]');
    if (command && command.dataset.command) {
      post({ type: 'displayCommand', command: command.dataset.command });
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
