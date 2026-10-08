import * as vscode from 'vscode';

import type { DisplayService } from '../../core/storage/preferencesDisplay';
import type { PreferencesReader } from '../../core/storage/preferencesRepository';
import { DEFAULT_DATE_FORMAT, DEFAULT_DATE_LOCALE, DEFAULT_SHORT_DATE_FORMAT, type DateFormats, usesLocaleWeeks } from '../../domain/markdown/dateFormat';
import { DATE_FORMAT_SETTINGS, readDateFormats } from './datePrompt';
import { ZEN_CHOICES, type DisplayChoices } from '../state/displayLevel';

/**
 * Display, read from the settings and written from the gear: Zen
 * (`deckard.display.zen`), and the card details and date formats. Each is
 * personal, an application setting, so a workspace's settings never decide
 * how someone else's pages look; each is written to the user's settings.
 * What Zen turns on is ui/state/displayLevel.ts's.
 *
 * The page width is the gear's own, kept in the preferences, the same in
 * every workspace.
 */

/** The setting Zen is kept in, under `deckard.`. */
export const ZEN_SETTING = 'display.zen';

/** The Display setting a page's gear sets besides Zen: the page width. */
export type DisplaySetting = 'pageWidth';

/** How wide every page is drawn: limited to a column, or as wide as its panel. */
export type PageWidth = 'limited' | 'full';

/** Where the page width is kept, and what changes it. */
export interface PageWidthPreferences {
  readonly reader: Pick<PreferencesReader, 'value' | 'onDidChange'>;
  readonly display: Pick<DisplayService, 'setPageWidth'>;
}

/** The page width as the preferences last said, and where a new one is kept. */
let pageWidth: PageWidth = 'limited';
let pageWidthStore: PageWidthPreferences['display'] | undefined;
const pageWidthChanged = new vscode.EventEmitter<void>();

/** Fires when the page width changes, which every page's chrome is drawn with. */
export const onDidChangePageWidth: vscode.Event<void> = pageWidthChanged.event;

/** Limited until the gear chooses Full. */
function pageWidthOf(value: { readonly pageWidth?: 'full' }): PageWidth {
  return value.pageWidth === 'full' ? 'full' : 'limited';
}

/**
 * Starts reading the page width from the preferences, once, at activation,
 * and fires onDidChangePageWidth whenever a change to them changes it.
 */
export function startPageWidth(preferences: PageWidthPreferences): vscode.Disposable {
  pageWidthStore = preferences.display;
  pageWidth = pageWidthOf(preferences.reader.value);
  return preferences.reader.onDidChange((value) => {
    const next = pageWidthOf(value);
    if (next === pageWidth) {
      return;
    }
    pageWidth = next;
    pageWidthChanged.fire();
  });
}

/** The page width every page is drawn at now. */
export function readPageWidth(): PageWidth {
  return pageWidth;
}

/** Whether Zen is on: `deckard.display.zen` in the user's settings. */
export function readZen(): boolean {
  return vscode.workspace.getConfiguration('deckard').inspect<boolean>(ZEN_SETTING)?.globalValue === true;
}

/** How pages are drawn now, each value only when it isn't the default. */
export function readDisplayChoices(): DisplayChoices {
  const deckard = vscode.workspace.getConfiguration('deckard');
  return {
    ...(readZen() ? ZEN_CHOICES : {}),
    ...readDetailChoices(deckard),
    ...(readPageWidth() === 'full' ? { width: 'full' as const } : {}),
    ...dateFormatChoices(readDateFormats()),
  };
}

/**
 * The date formats as a page is told them, each only when it isn't the
 * default: the language only when it isn't English, and the week start
 * only when a format counts weeks by it.
 */
export function dateFormatChoices(formats: DateFormats): Pick<DisplayChoices, 'dateFormat' | 'shortDateFormat' | 'dateLocale' | 'weekStart'> {
  return {
    ...(formats.date === DEFAULT_DATE_FORMAT ? {} : { dateFormat: formats.date }),
    ...(formats.short === DEFAULT_SHORT_DATE_FORMAT ? {} : { shortDateFormat: formats.short }),
    ...(formats.locale === DEFAULT_DATE_LOCALE ? {} : { dateLocale: formats.locale }),
    ...(formats.weekStart !== 0 && (usesLocaleWeeks(formats.date) || usesLocaleWeeks(formats.short)) ? { weekStart: formats.weekStart } : {}),
  };
}

/** The details an entry can show, in the order they are written. */
const CARD_DETAILS = ['fileAndLine', 'created', 'updated'] as const;

/**
 * Which of an entry's details show on hover: those
 * `deckard.display.cardDetails` ticks. The file and line alone is the
 * default and writes nothing; none ticked draws none.
 */
function readDetailChoices(deckard: vscode.WorkspaceConfiguration): Pick<DisplayChoices, 'fileAndLine' | 'details'> {
  const ticked = deckard.get<Record<string, unknown>>('display.cardDetails') ?? {};
  const details = CARD_DETAILS.filter((detail) => (detail === 'fileAndLine' ? ticked[detail] !== false : ticked[detail] === true));
  if (!details.length) {
    return { fileAndLine: 'never' };
  }
  return details.length === 1 && details[0] === 'fileAndLine' ? {} : { details: details.join(' ') };
}

/**
 * Whether a settings change alters how pages are drawn: Zen, the details an
 * entry shows, a date format, or the week start a format's `w` counts from.
 */
export function affectsDisplayChoices(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration('deckard.display.cardDetails')
    || event.affectsConfiguration(`deckard.${ZEN_SETTING}`)
    || Object.values(DATE_FORMAT_SETTINGS).some((key) => event.affectsConfiguration(`deckard.${key}`))
    || event.affectsConfiguration('deckard.calendar.weekStart');
}

/**
 * Sets the page width from a page's gear, in the preferences. Each page
 * redraws from its own listener for it, so there is nothing to refresh here.
 */
export async function setDisplayChoice(setting: DisplaySetting, value: string): Promise<void> {
  if (setting === 'pageWidth' && (value === 'limited' || value === 'full')) {
    await pageWidthStore?.setPageWidth(value);
  }
}
