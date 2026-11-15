/**
 * Help's This page tab, described by the host as a tree the page builds
 * (plan 48, section 2). The words are the guide's sections and the
 * settings' contributed descriptions; this file only lays them out. Every
 * control it draws carries a `data-help-action` the page script sends on.
 */
import type { HelpViewNode } from '../../../protocol/help';
import type { PageHelpChoice, PageHelpEntry, PageHelpMap } from '../../../state/pageHelp';
import type { SettingView } from './helpSettings';
import { h, inlineText, viewNodes } from './helpView';

/** One entry, with what the guide says of it. */
export interface ThisPageEntry {
  entry: PageHelpEntry;
  /** Its section's heading. */
  title: string;
  /** Its section's first sentence. */
  summary: string;
  /** Its section, as rendered. */
  sectionHtml: string;
  /** Its guide page's title, and its section's, for "From the guide". */
  from: string;
  /** The sentence of this page's guide that names it, for a control the same on every page. */
  onThisPage?: { sentence: string; words: string; from: string };
  /** What it is set to now, for a control with a choice. */
  current?: string;
  /** The Tour scene that shows it, counted from 1. */
  tourScene?: number;
}

/** A choice of the page's own, with its options and the one taken. */
export interface ThisPageChoice {
  current: string;
  options: ReadonlyArray<{ value: string; label: string; disabled?: string }>;
  /** Why the choice is kept by the page, not a setting. */
  kept: string;
}

/** Everything This page draws. */
export interface ThisPageModel {
  /** The page's map; without one, This page says so and leads to the guide. */
  map?: PageHelpMap;
  /** The page that asked, by title, when it has no map. */
  askedTitle?: string;
  entries: readonly ThisPageEntry[];
  settings: readonly SettingView[];
  choices: Partial<Record<PageHelpChoice, ThisPageChoice>>;
  /** The entry shown, or the list. */
  selected?: string;
  /** Whether Point at something is on. */
  exploring: boolean;
  /** Whether the page is open, so Show me and Point at something can reach it. */
  pageOpen: boolean;
}

/** A setting's Markdown description, as text with its code and bold kept and its links read as their words. */
export function inlineMarkdown(text: string): HelpViewNode[] {
  return inlineText(text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'), { code: true });
}

/** A sentence with the words it names in bold, for "On this board". */
function boldWords(sentence: string, words: string): HelpViewNode[] {
  const at = sentence.toLowerCase().indexOf(words.toLowerCase());
  if (at < 0) {
    return [sentence];
  }
  return [sentence.slice(0, at), h('b', null, sentence.slice(at, at + words.length)), sentence.slice(at + words.length)];
}

/** A setting's editor, by its kind; one Help does not edit shows its value and a way to Settings. */
function settingEditor(setting: SettingView): HelpViewNode[] {
  const key = setting.key;
  const id = `setting-${setting.key.replace(/[^\w-]/g, '-')}`;
  switch (setting.kind) {
    case 'boolean':
      return [h('label', { class: 'setting-check' }, h('input', { type: 'checkbox', id, 'data-help-setting': key, checked: setting.value === true }), ' On')];
    case 'enum':
      return [
        h(
          'select',
          { id, 'data-help-setting': key, 'aria-label': setting.label },
          (setting.options ?? []).map((option) => h('option', { value: option.value, selected: option.value === setting.value }, option.label)),
        ),
      ];
    case 'number':
      return [h('input', { type: 'number', id, 'data-help-setting': key, 'aria-label': setting.label, value: String(setting.value ?? '') })];
    case 'string':
      return [h('input', { type: 'text', id, 'data-help-setting': key, 'aria-label': setting.label, value: String(setting.value ?? '') })];
    case 'flags':
      return (setting.flags ?? []).map((flag) =>
        h('label', { class: 'setting-check' }, h('input', { type: 'checkbox', 'data-help-setting': key, 'data-help-flag': flag.name, checked: flag.on }), ` ${flag.label}`),
      );
    case 'other':
      return viewNodes(
        h('span', { class: 'setting-summary' }, setting.summary ?? ''),
        setting.key === 'tasks.statuses' && h('button', { type: 'button', 'data-help-action': 'edit-statuses' }, 'Edit statuses…'),
      );
  }
}

/** One setting's row: its name, key, where it is set, its words, and its editor. */
function settingRow(setting: SettingView, compact = false): HelpViewNode {
  return h(
    'div',
    { class: 'help-setting', 'data-setting-key': setting.key },
    h('div', { class: 'help-setting-head' }, h('b', null, setting.label), ' ', h('code', null, `deckard.${setting.key}`), ' ', h('span', { class: 'help-setting-source' }, setting.source)),
    !compact && h('p', { class: 'help-setting-words' }, inlineMarkdown(setting.description)),
    h('div', { class: 'help-setting-editor' }, settingEditor(setting)),
    h('button', { type: 'button', class: 'help-link', 'data-help-action': 'open-setting', 'data-key': setting.key }, 'Open in Settings'),
  );
}

/** An entry's row in the list. */
function entryRow(item: ThisPageEntry): HelpViewNode {
  const feature = item.entry.kind === 'feature';
  return h(
    'li',
    null,
    h(
      'button',
      { type: 'button', class: 'help-entry', 'data-help-action': 'select', 'data-id': item.entry.id },
      h('span', { class: 'help-entry-name' }, item.title, item.tourScene !== undefined && [' ', h('span', { class: 'help-chip' }, `Tour ${item.tourScene}`)]),
      item.current && h('span', { class: 'help-entry-value' }, item.current),
      feature && h('span', { class: 'help-entry-summary' }, item.summary),
    ),
  );
}

/** A heading with its count, for a list's section. */
function countedHeading(id: string, words: string, count: number): HelpViewNode {
  return h('h2', { id }, `${words} `, h('span', { class: 'help-count' }, String(count)));
}

/** The list: what you can do here, the controls, and the settings. */
function overview(model: ThisPageModel, map: PageHelpMap): HelpViewNode[] {
  const features = model.entries.filter((item) => item.entry.kind === 'feature');
  const controls = model.entries.filter((item) => item.entry.kind === 'control');
  return viewNodes(
    h(
      'div',
      { class: 'help-this-head' },
      h('div', null, h('p', { class: 'help-eyebrow' }, 'This page'), h('h1', null, map.title)),
      h('button', { type: 'button', 'data-help-action': 'explore', 'aria-pressed': String(model.exploring), disabled: !model.pageOpen }, 'Point at something'),
    ),
    model.exploring && h('p', { class: 'help-note', role: 'status' }, 'Click anything on the page beside to read about it here. ', h('kbd', null, 'Escape'), ' stops.'),
    !model.pageOpen && h('p', { class: 'help-note' }, `Open the ${map.title} beside Help for Show me and Point at something.`),
    h('section', { 'aria-labelledby': 'help-features' }, countedHeading('help-features', 'What you can do here', features.length), h('ul', { class: 'help-entries' }, features.map(entryRow))),
    h('section', { 'aria-labelledby': 'help-controls' }, countedHeading('help-controls', 'Controls', controls.length), h('ul', { class: 'help-entries' }, controls.map(entryRow))),
    h('section', { 'aria-labelledby': 'help-settings' }, countedHeading('help-settings', 'Settings that change this page', model.settings.length), model.settings.map((setting) => settingRow(setting))),
    );
}

/** The entry's choices, as buttons, and why the page keeps them. */
function choicesSection(item: ThisPageEntry, choice: ThisPageChoice): HelpViewNode {
  return h(
    'section',
    { 'aria-labelledby': 'help-choices' },
    h('h2', { id: 'help-choices' }, 'Choices'),
    h(
      'div',
      { class: 'help-choices', role: 'group', 'aria-label': item.title },
      choice.options.map((option) =>
        h(
          'button',
          {
            type: 'button',
            'data-help-action': 'choose',
            'data-choice': item.entry.choice,
            'data-value': option.value,
            'aria-pressed': String(option.value === choice.current),
            disabled: Boolean(option.disabled),
            title: option.disabled,
          },
          option.label,
        ),
      ),
    ),
    h('p', { class: 'help-note' }, choice.kept),
  );
}

/** The eyebrow over an entry: what it is, whether it is the same on every page, and its Tour scene. */
function entryEyebrow(item: ThisPageEntry): HelpViewNode {
  return h(
    'p',
    { class: 'help-eyebrow' },
    item.entry.kind === 'feature' ? 'What you can do' : 'Control',
    item.entry.onThisPage && ' · the same on every page',
    item.tourScene !== undefined && [' · ', h('span', { class: 'help-chip' }, `Tour ${item.tourScene}`)],
  );
}

/** One entry: its section, the page's own line about it, its choices, and its settings. */
function detail(model: ThisPageModel, map: PageHelpMap, item: ThisPageEntry): HelpViewNode[] {
  const choice = item.entry.choice ? model.choices[item.entry.choice] : undefined;
  const settings = (item.entry.settings ?? [])
    .map((key) => model.settings.find((setting) => setting.key === key))
    .filter((setting): setting is SettingView => Boolean(setting));
  const [guidePage, anchor] = item.entry.guide.split('#');
  const guideAttrs = { type: 'button', 'data-help-action': 'open-guide', 'data-page': guidePage, 'data-anchor': anchor ?? '' };
  const onThisPage = item.onThisPage;
  return viewNodes(
    h('button', { type: 'button', class: 'help-link', 'data-help-action': 'back' }, `← ${map.title}`),
    h('div', { class: 'help-this-head' }, h('div', null, entryEyebrow(item), h('h1', null, item.title))),
    { ...h('div', { class: 'help-section' }), guideHtml: item.sectionHtml },
    h('button', { ...guideAttrs, class: 'help-link' }, `From the guide: ${item.from}`),
    onThisPage &&
      h(
        'aside',
        { class: 'help-on-this-page' },
        h('p', { class: 'help-eyebrow' }, `On this ${map.title.toLowerCase()}`),
        h('p', null, boldWords(onThisPage.sentence, onThisPage.words)),
        h('p', { class: 'help-from' }, onThisPage.from),
      ),
    choice && choicesSection(item, choice),
    settings.length > 0 &&
      h('section', { 'aria-labelledby': 'help-entry-settings' }, h('h2', { id: 'help-entry-settings' }, 'Settings'), settings.map((setting) => settingRow(setting, true))),
    h(
      'div',
      { class: 'help-actions' },
      h('button', { type: 'button', 'data-help-action': 'show-me', 'data-id': item.entry.id, disabled: !model.pageOpen }, 'Show me'),
      h('button', guideAttrs, 'Open in the guide'),
    ),
    );
}

/** This page, for a page Help has no map of: what This page covers, and the way to the guide. */
function noMap(askedTitle: string | undefined): HelpViewNode[] {
  return [
    h('div', { class: 'help-this-head' }, h('div', null, h('p', { class: 'help-eyebrow' }, 'This page'), h('h1', null, askedTitle ?? 'This page'))),
    h(
      'p',
      null,
      `Help on this page explains a page's controls and settings for the pages it has a map of: so far, the Task board. For ${askedTitle ? `the ${askedTitle}` : 'other pages'}, its page of the guide says what is on it.`,
    ),
    h(
      'p',
      null,
      h('button', { type: 'button', 'data-help-action': 'open-tab', 'data-tab': 'guide' }, 'Open the guide'),
      ' ',
      h('button', { type: 'button', 'data-help-action': 'open-board' }, 'Open the Task board'),
    ),
  ];
}

/** This page's content, for the tab's panel. */
export function renderThisPage(model: ThisPageModel): HelpViewNode[] {
  const map = model.map;
  if (!map) {
    return noMap(model.askedTitle);
  }
  const selected = model.selected ? model.entries.find((item) => item.entry.id === model.selected) : undefined;
  return selected ? detail(model, map, selected) : overview(model, map);
}
