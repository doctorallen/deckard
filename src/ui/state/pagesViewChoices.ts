/**
 * How the Pages view is drawn and which pages it keeps, read from the
 * reader's settings: `deckard.pages.style` and `deckard.pages.shown`.
 */
import type { PagesViewStyle } from '../protocol/pagesView';

/** A settings section to read from, as VS Code's configuration is. */
export interface SettingsReader {
  get<T>(key: string): T | undefined;
}

/** How Pages draws its pages, from `deckard.pages.style`: the list unless it says icons. */
export function readPagesStyle(configuration: SettingsReader): PagesViewStyle {
  return configuration.get<string>('pages.style') === 'icons' ? 'icons' : 'list';
}

/** Whether Pages keeps a page, from `deckard.pages.shown`: every page it does not untick. */
export function isPageShown(configuration: SettingsReader, id: string): boolean {
  const shown = configuration.get<Record<string, unknown>>('pages.shown') ?? {};
  return shown[id] !== false;
}
