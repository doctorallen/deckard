/**
 * Deckard's pages as Context draws them at its top: how, and which pages
 * it keeps, as the reader chose them from the pages' own gear and the
 * preferences keep them.
 */
import type { PersistedPreferences } from '../../domain/model/preferences';
import type { ContextPages, ContextPagesStyle } from '../protocol/sidebarNotes';
import type { DeckardPage, DeckardPageId } from './deckardPages';

/** The preferences the pages at the top of Context are kept in. */
export type ContextPagesPreferences = Pick<PersistedPreferences, 'contextPagesStyle' | 'contextPagesHidden'>;

/**
 * How Context draws its pages: the row of icons unless the reader chose the
 * list. The labeled rows took about 210 px of a sidebar at the top of every
 * state, and cut their hints short; each icon names its page and its hint
 * on hover and to a screen reader.
 */
export function readPagesStyle(preferences: ContextPagesPreferences): ContextPagesStyle {
  return preferences.contextPagesStyle === 'list' ? 'list' : 'icons';
}

/** Whether Context keeps a page: every page the reader has not left out. */
export function isPageShown(preferences: ContextPagesPreferences, id: string): boolean {
  return !(preferences.contextPagesHidden ?? []).includes(id);
}

/**
 * The pages Context draws at its top: of `pages`, in their order, the ones
 * the reader keeps, drawn as they chose, with the page in front, `current`,
 * named when it is one of them; and every page with whether it is kept,
 * which the gear offers to tick.
 */
export function listContextPages(pages: readonly DeckardPage[], preferences: ContextPagesPreferences, current?: DeckardPageId): ContextPages {
  const kept = pages
    .filter((page) => isPageShown(preferences, page.id))
    .map(({ id, label, description, detail }) => ({ id, label, description, detail }));
  return {
    style: readPagesStyle(preferences),
    pages: kept,
    choices: pages.map(({ id, label }) => ({ id, label, shown: isPageShown(preferences, id) })),
    ...(current && kept.some((page) => page.id === current) ? { current } : {}),
  };
}
