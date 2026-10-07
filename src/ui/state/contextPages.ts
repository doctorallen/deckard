/**
 * Deckard's pages as Context draws them at its top: how, and which pages
 * it keeps, read from the reader's settings, `deckard.pages.style` and
 * `deckard.pages.shown`.
 */
import type { ContextPages, ContextPagesStyle } from '../protocol/sidebarNotes';
import type { DeckardPage, DeckardPageId } from './deckardPages';

/** A settings section to read from, as VS Code's configuration is. */
export interface SettingsReader {
  get<T>(key: string): T | undefined;
}

/** How Context draws its pages, from `deckard.pages.style`: the list unless it says icons. */
export function readPagesStyle(configuration: SettingsReader): ContextPagesStyle {
  return configuration.get<string>('pages.style') === 'icons' ? 'icons' : 'list';
}

/** Whether Context keeps a page, from `deckard.pages.shown`: every page it does not untick. */
export function isPageShown(configuration: SettingsReader, id: string): boolean {
  const shown = configuration.get<Record<string, unknown>>('pages.shown') ?? {};
  return shown[id] !== false;
}

/**
 * The pages Context draws at its top: of `pages`, in their order, the ones
 * the settings keep, drawn as they say, with the page in front, `current`,
 * named when it is one of them.
 */
export function listContextPages(pages: readonly DeckardPage[], configuration: SettingsReader, current?: DeckardPageId): ContextPages {
  const kept = pages
    .filter((page) => isPageShown(configuration, page.id))
    .map(({ id, label, description, detail }) => ({ id, label, description, detail }));
  return {
    style: readPagesStyle(configuration),
    pages: kept,
    ...(current && kept.some((page) => page.id === current) ? { current } : {}),
  };
}
