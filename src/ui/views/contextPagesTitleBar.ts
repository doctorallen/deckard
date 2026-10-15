import * as vscode from 'vscode';

import type { PersistedPreferences } from '../../domain/model/preferences';
import { DECKARD_PAGE_COMMANDS, type DeckardPageId } from '../state/deckardPages';
import { isPageShown, readPagesStyle, type ContextPagesPreferences } from '../state/contextPages';

/**
 * Deckard's pages as icons in Context's title bar, where they sat before
 * the view drew them itself. Each icon is a `view/title` button whose
 * `when` reads a context key this sets: on while the reader keeps the page
 * and has not chosen the list, which Context draws in its body instead.
 */

/** The context key a page's title-bar icon is shown by. */
export function pageIconContextKey(id: DeckardPageId): string {
  return `deckard.contextPageIcon.${id}`;
}

/** The context key saying Context draws its pages as a list in its body. */
export const PAGES_AS_LIST_CONTEXT_KEY = 'deckard.contextPagesAsList';

/**
 * Every context key the title bar reads, and its value: each page's icon is
 * on while the reader keeps it and the pages are not a list.
 */
export function contextPagesKeys(preferences: ContextPagesPreferences): Record<string, boolean> {
  const asList = readPagesStyle(preferences) === 'list';
  const keys: Record<string, boolean> = { [PAGES_AS_LIST_CONTEXT_KEY]: asList };
  for (const id of Object.keys(DECKARD_PAGE_COMMANDS) as DeckardPageId[]) {
    keys[pageIconContextKey(id)] = !asList && isPageShown(preferences, id);
  }
  return keys;
}

/** What the title bar reads its keys from, and is told of changes by. */
export interface ContextPagesSource {
  readonly current: PersistedPreferences;
  readonly onDidChange: vscode.Event<PersistedPreferences>;
}

/**
 * Sets the title bar's keys now and again whenever the preferences change,
 * only the keys whose value changed.
 */
export function watchContextPagesKeys(source: ContextPagesSource): vscode.Disposable {
  const set = new Map<string, boolean>();
  const apply = (preferences: ContextPagesPreferences): void => {
    for (const [key, value] of Object.entries(contextPagesKeys(preferences))) {
      if (set.get(key) !== value) {
        set.set(key, value);
        void vscode.commands.executeCommand('setContext', key, value);
      }
    }
  };
  apply(source.current);
  return source.onDidChange(apply);
}

/** What choosing the pages reads and writes. */
export interface ContextPagesChoices {
  readonly current: ContextPagesPreferences;
  setContextPageShown(page: string, shown: boolean): Promise<void>;
}

/** Each page's name, as Context and Go to… name it. */
const PAGE_LABELS: Readonly<Record<DeckardPageId, string>> = {
  home: 'Home',
  board: 'Task Board',
  calendar: 'Calendar',
  today: "Today's note",
  graph: 'Notes Graph',
  find: 'Find in Notes',
  stats: 'Stats',
  help: 'Help',
};

/**
 * Choose Pages…, from the title bar's ⋯: every page, the kept ones ticked,
 * and what the reader leaves ticked is kept.
 */
export async function chooseContextPages(choices: ContextPagesChoices): Promise<void> {
  const items = (Object.keys(PAGE_LABELS) as DeckardPageId[]).map((id) => ({
    id,
    label: PAGE_LABELS[id],
    picked: isPageShown(choices.current, id),
  }));
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'Pages in Context',
    placeHolder: 'Tick the pages to keep',
  });
  if (!picked) {
    return;
  }
  const kept = new Set(picked.map((item) => item.id));
  for (const item of items) {
    if (item.picked !== kept.has(item.id)) {
      await choices.setContextPageShown(item.id, kept.has(item.id));
    }
  }
}
