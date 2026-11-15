/**
 * Help's This page tab, drawn by the host as the guide is (plan 48,
 * section 2). The words are the guide's sections and the settings'
 * contributed descriptions; this file only lays them out. Every control it
 * draws carries a `data-help-action` the page script sends on.
 */
import { escapeHtml } from '../../../../shared/html';
import type { PageHelpChoice, PageHelpEntry, PageHelpMap } from '../../../state/pageHelp';
import type { SettingView } from './helpSettings';

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

/** A setting's Markdown description, as text with its code and bold kept. */
export function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

/** A sentence with the words it names in bold, for "On this board". */
function boldWords(sentence: string, words: string): string {
  const at = sentence.toLowerCase().indexOf(words.toLowerCase());
  if (at < 0) {
    return escapeHtml(sentence);
  }
  return `${escapeHtml(sentence.slice(0, at))}<b>${escapeHtml(sentence.slice(at, at + words.length))}</b>${escapeHtml(sentence.slice(at + words.length))}`;
}

/** A setting's editor, by its kind; one Help does not edit shows its value and a way to Settings. */
function settingEditor(setting: SettingView): string {
  const key = escapeHtml(setting.key);
  const id = `setting-${setting.key.replace(/[^\w-]/g, '-')}`;
  switch (setting.kind) {
    case 'boolean':
      return `<label class="setting-check"><input type="checkbox" id="${id}" data-help-setting="${key}"${setting.value === true ? ' checked' : ''}> On</label>`;
    case 'enum':
      return `<select id="${id}" data-help-setting="${key}" aria-label="${escapeHtml(setting.label)}">${(setting.options ?? [])
        .map((option) => `<option value="${escapeHtml(option.value)}"${option.value === setting.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`)
        .join('')}</select>`;
    case 'number':
      return `<input type="number" id="${id}" data-help-setting="${key}" aria-label="${escapeHtml(setting.label)}" value="${escapeHtml(String(setting.value ?? ''))}">`;
    case 'string':
      return `<input type="text" id="${id}" data-help-setting="${key}" aria-label="${escapeHtml(setting.label)}" value="${escapeHtml(String(setting.value ?? ''))}">`;
    case 'flags':
      return (setting.flags ?? [])
        .map((flag) => `<label class="setting-check"><input type="checkbox" data-help-setting="${key}" data-help-flag="${escapeHtml(flag.name)}"${flag.on ? ' checked' : ''}> ${escapeHtml(flag.label)}</label>`)
        .join('');
    case 'other':
      return `<span class="setting-summary">${escapeHtml(setting.summary ?? '')}</span>${
        setting.key === 'tasks.statuses' ? '<button type="button" data-help-action="edit-statuses">Edit statuses…</button>' : ''
      }`;
  }
}

/** One setting's row: its name, key, where it is set, its words, and its editor. */
function settingRow(setting: SettingView, compact = false): string {
  return `<div class="help-setting" data-setting-key="${escapeHtml(setting.key)}">
  <div class="help-setting-head"><b>${escapeHtml(setting.label)}</b> <code>deckard.${escapeHtml(setting.key)}</code> <span class="help-setting-source">${setting.source}</span></div>
  ${compact ? '' : `<p class="help-setting-words">${inlineMarkdown(setting.description)}</p>`}
  <div class="help-setting-editor">${settingEditor(setting)}</div>
  <button type="button" class="help-link" data-help-action="open-setting" data-key="${escapeHtml(setting.key)}">Open in Settings</button>
</div>`;
}

/** An entry's row in the list. */
function entryRow(item: ThisPageEntry): string {
  const feature = item.entry.kind === 'feature';
  return `<li><button type="button" class="help-entry" data-help-action="select" data-id="${escapeHtml(item.entry.id)}">
  <span class="help-entry-name">${escapeHtml(item.title)}${item.tourScene ? ` <span class="help-chip">Tour ${item.tourScene}</span>` : ''}</span>
  ${item.current ? `<span class="help-entry-value">${escapeHtml(item.current)}</span>` : ''}
  ${feature ? `<span class="help-entry-summary">${escapeHtml(item.summary)}</span>` : ''}
</button></li>`;
}

/** The list: what you can do here, the controls, and the settings. */
function overview(model: ThisPageModel, map: PageHelpMap): string {
  const features = model.entries.filter((item) => item.entry.kind === 'feature');
  const controls = model.entries.filter((item) => item.entry.kind === 'control');
  return `<div class="help-this-head">
  <div><p class="help-eyebrow">This page</p><h1>${escapeHtml(map.title)}</h1></div>
  <button type="button" data-help-action="explore" aria-pressed="${model.exploring}"${model.pageOpen ? '' : ' disabled'}>Point at something</button>
</div>
${model.exploring ? '<p class="help-note" role="status">Click anything on the page beside to read about it here. <kbd>Escape</kbd> stops.</p>' : ''}
${model.pageOpen ? '' : `<p class="help-note">Open the ${escapeHtml(map.title)} beside Help for Show me and Point at something.</p>`}
<section aria-labelledby="help-features"><h2 id="help-features">What you can do here <span class="help-count">${features.length}</span></h2><ul class="help-entries">${features.map(entryRow).join('')}</ul></section>
<section aria-labelledby="help-controls"><h2 id="help-controls">Controls <span class="help-count">${controls.length}</span></h2><ul class="help-entries">${controls.map(entryRow).join('')}</ul></section>
<section aria-labelledby="help-settings"><h2 id="help-settings">Settings that change this page <span class="help-count">${model.settings.length}</span></h2>${model.settings.map((setting) => settingRow(setting)).join('')}</section>`;
}

/** One entry: its section, the page's own line about it, its choices, and its settings. */
function detail(model: ThisPageModel, map: PageHelpMap, item: ThisPageEntry): string {
  const choice = item.entry.choice ? model.choices[item.entry.choice] : undefined;
  const settings = (item.entry.settings ?? [])
    .map((key) => model.settings.find((setting) => setting.key === key))
    .filter((setting): setting is SettingView => Boolean(setting));
  const [guidePage, anchor] = item.entry.guide.split('#');
  return `<button type="button" class="help-link" data-help-action="back">← ${escapeHtml(map.title)}</button>
<div class="help-this-head"><div><p class="help-eyebrow">${item.entry.kind === 'feature' ? 'What you can do' : 'Control'}${item.entry.onThisPage ? ' · the same on every page' : ''}${item.tourScene ? ` · <span class="help-chip">Tour ${item.tourScene}</span>` : ''}</p><h1>${escapeHtml(item.title)}</h1></div></div>
<div class="help-section">${item.sectionHtml}</div>
<button type="button" class="help-link" data-help-action="open-guide" data-page="${escapeHtml(guidePage)}" data-anchor="${escapeHtml(anchor ?? '')}">From the guide: ${escapeHtml(item.from)}</button>
${item.onThisPage ? `<aside class="help-on-this-page"><p class="help-eyebrow">On this ${escapeHtml(map.title.toLowerCase())}</p><p>${boldWords(item.onThisPage.sentence, item.onThisPage.words)}</p><p class="help-from">${escapeHtml(item.onThisPage.from)}</p></aside>` : ''}
${choice ? `<section aria-labelledby="help-choices"><h2 id="help-choices">Choices</h2><div class="help-choices" role="group" aria-label="${escapeHtml(item.title)}">${choice.options
    .map((option) => `<button type="button" data-help-action="choose" data-choice="${item.entry.choice}" data-value="${escapeHtml(option.value)}" aria-pressed="${option.value === choice.current}"${option.disabled ? ` disabled title="${escapeHtml(option.disabled)}"` : ''}>${escapeHtml(option.label)}</button>`)
    .join('')}</div><p class="help-note">${escapeHtml(choice.kept)}</p></section>` : ''}
${settings.length ? `<section aria-labelledby="help-entry-settings"><h2 id="help-entry-settings">Settings</h2>${settings.map((setting) => settingRow(setting, true)).join('')}</section>` : ''}
<div class="help-actions"><button type="button" data-help-action="show-me" data-id="${escapeHtml(item.entry.id)}"${model.pageOpen ? '' : ' disabled'}>Show me</button><button type="button" data-help-action="open-guide" data-page="${escapeHtml(guidePage)}" data-anchor="${escapeHtml(anchor ?? '')}">Open in the guide</button></div>`;
}

/** This page's HTML, for the tab's panel. */
export function renderThisPage(model: ThisPageModel): string {
  const map = model.map;
  if (!map) {
    return `<div class="help-this-head"><div><p class="help-eyebrow">This page</p><h1>${escapeHtml(model.askedTitle ?? 'This page')}</h1></div></div>
<p>Help on this page explains a page's controls and settings for the pages it has a map of: so far, the Task board. For ${model.askedTitle ? `the ${escapeHtml(model.askedTitle)}` : 'other pages'}, its page of the guide says what is on it.</p>
<p><button type="button" data-help-action="open-tab" data-tab="guide">Open the guide</button> <button type="button" data-help-action="open-board">Open the Task board</button></p>`;
  }
  const selected = model.selected ? model.entries.find((item) => item.entry.id === model.selected) : undefined;
  return selected ? detail(model, map, selected) : overview(model, map);
}
