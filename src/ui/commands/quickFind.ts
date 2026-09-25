import * as vscode from 'vscode';

import { PreferencesStore } from '../../core/storage/preferences';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { createQuerySuggestions } from '../state/dashboardState';
import {
  buildQuickFindResults,
  QuickFindItem,
  QuickFindResults,
} from '../state/quickFindState';
import { createWikiLink } from './insertLink';
import { createLinkedNote } from './linkHealth';
import { openSourceAt } from './navigation';

/** Set while Quick Find is open, so Tab completes in it and nowhere else. */
export const QUICK_FIND_CONTEXT = 'deckard.quickFindOpen';

export interface QuickFindActions {
  openTag(tagKey: string): Promise<void>;
  openSavedFilter(filterId: string): Promise<void>;
  /** Opens the Dashboard's Search tab on a search. */
  showSearch(query: string): Promise<void>;
}

interface QuickFindPickItem extends vscode.QuickPickItem {
  item?: QuickFindItem;
  /** The row that opens the whole search on the Dashboard. */
  showAll?: boolean;
  /** The row that runs the corrected spelling. */
  suggestion?: string;
  /** The row that creates a note by the name typed, when none has it. */
  create?: string;
}

const ADD_TO_SEARCH: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('add'),
  tooltip: 'Add to the search (Tab)',
};
const SAVE_AS_VIEW: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('save'),
  tooltip: 'Save as a view',
};
const OPEN_BESIDE: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('split-horizontal'),
  tooltip: 'Open to the side',
};
const INSERT_LINK: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('link'),
  tooltip: 'Insert a link to it at the cursor',
};
const SHOW_ALL: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('list-flat'),
  tooltip: 'Show every result on the Dashboard',
};

/**
 * Deckard: Find, one search box for notes, tasks, tags, and saved views that
 * shows results as you type.
 *
 * The search is a Deckard query, so plain words, `#tags`, and shorthands
 * such as `is:open` all work, and Tab completes the word being typed.
 */
export class QuickFind implements vscode.Disposable {
  private picker: vscode.QuickPick<QuickFindPickItem> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** The editor Find was opened from, where Insert link writes. */
  private editor: vscode.TextEditor | undefined;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly actions: QuickFindActions,
  ) {}

  public async show(initialQuery = ''): Promise<void> {
    await this.indexer.ready;
    this.editor = vscode.window.activeTextEditor;
    this.picker?.dispose();
    const picker = vscode.window.createQuickPick<QuickFindPickItem>();
    this.picker = picker;
    picker.title = 'Deckard: Find';
    picker.placeholder =
      'Words, #tags, is:open, has:due, in:folder… Tab completes, Enter opens';
    // Deckard ranks the results itself, so VS Code's own filtering must not
    // hide any of them.
    picker.matchOnDescription = false;
    picker.matchOnDetail = false;
    picker.buttons = [SHOW_ALL];
    picker.value = initialQuery;
    void vscode.commands.executeCommand('setContext', QUICK_FIND_CONTEXT, true);

    picker.onDidChangeValue(() => this.scheduleRefresh());
    picker.onDidAccept(() => void this.accept());
    picker.onDidTriggerButton(() => void this.showAll());
    picker.onDidTriggerItemButton((event) => void this.triggerItemButton(event));
    picker.onDidHide(() => {
      void vscode.commands.executeCommand('setContext', QUICK_FIND_CONTEXT, false);
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
      }
      picker.dispose();
      if (this.picker === picker) {
        this.picker = undefined;
      }
    });

    this.refresh();
    picker.show();
  }

  /**
   * Writes the active completion into the search: a tag or condition in
   * place of the word being typed, or a recent search in full.
   */
  public complete(): void {
    const picker = this.picker;
    const active = picker?.activeItems[0]?.item;
    if (!picker || !active?.completion) {
      return;
    }
    picker.value = active.completion;
    this.refresh();
  }

  public dispose(): void {
    this.picker?.dispose();
    this.picker = undefined;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    // Typing quickly redraws once when it pauses, not once per keystroke.
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh();
    }, 40);
  }

  private refresh(): void {
    const picker = this.picker;
    if (!picker) {
      return;
    }
    const index = this.indexer.getSnapshot();
    const results = buildQuickFindResults(
      index,
      this.preferences.value,
      picker.value,
      (text) => this.indexer.searchEntries(text, { limit: 200 }),
      { conditions: createQuerySuggestions(index).conditions },
    );
    picker.items = toPickItems(results, picker.value);
  }

  private async accept(): Promise<void> {
    const picker = this.picker;
    const chosen = picker?.activeItems[0];
    if (!picker || !chosen) {
      return;
    }
    const query = picker.value.trim();
    if (chosen.suggestion !== undefined) {
      picker.value = chosen.suggestion;
      this.refresh();
      return;
    }
    if (chosen.showAll) {
      await this.showAll();
      return;
    }
    if (chosen.create !== undefined) {
      picker.hide();
      const from =
        this.editor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
      if (from) {
        await createLinkedNote(this.indexer, from, chosen.create);
      }
      return;
    }
    const item = chosen.item;
    if (!item || item.kind === 'message') {
      return;
    }
    if (item.kind === 'recent' || item.kind === 'condition') {
      picker.value = item.completion ?? item.query ?? picker.value;
      this.refresh();
      return;
    }

    picker.hide();
    if (query) {
      await this.preferences.recordRecentQuery(query);
    }
    if (item.kind === 'tag' && item.tagKey) {
      await this.actions.openTag(item.tagKey);
    } else if (item.kind === 'savedView' && item.savedFilterId) {
      await this.actions.openSavedFilter(item.savedFilterId);
    } else if (item.filePath && item.line) {
      await openSourceAt(item.filePath, item.line);
      if (item.sectionId) {
        await this.preferences.recordSectionAccess(item.sectionId);
      }
    }
  }

  /** Writes a link to the note, at its heading, where the cursor was. */
  private async insertLink(filePath: string, sectionId: string | undefined): Promise<void> {
    const editor = this.editor;
    if (!editor || editor.document.isClosed) {
      void vscode.window.showInformationMessage(
        'Open a note to insert a link into it, then use Find from there.',
      );
      return;
    }
    const link = createWikiLink(this.indexer.getSnapshot(), filePath, sectionId);
    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
    await editor.edit((builder) => {
      editor.selections.forEach((selection) => builder.replace(selection, link.text));
    });
    if (link.warning) {
      void vscode.window.showWarningMessage(link.warning);
    }
  }

  private async showAll(): Promise<void> {
    const query = this.picker?.value.trim() ?? '';
    this.picker?.hide();
    if (query) {
      await this.preferences.recordRecentQuery(query);
    }
    await this.actions.showSearch(query);
  }

  private async triggerItemButton(
    event: vscode.QuickPickItemButtonEvent<QuickFindPickItem>,
  ): Promise<void> {
    const item = event.item.item;
    const picker = this.picker;
    if (!item || !picker) {
      return;
    }
    if (event.button === ADD_TO_SEARCH && item.completion) {
      picker.value = item.completion;
      this.refresh();
      return;
    }
    if (event.button === OPEN_BESIDE && item.filePath && item.line) {
      // The list stays open, so the next result can be opened beside too.
      await openSourceAt(item.filePath, item.line, undefined, true);
      if (item.sectionId) {
        await this.preferences.recordSectionAccess(item.sectionId);
      }
      return;
    }
    if (event.button === INSERT_LINK && item.filePath) {
      picker.hide();
      await this.insertLink(item.filePath, item.sectionId);
      return;
    }
    if (event.button === SAVE_AS_VIEW && item.query) {
      const query = item.query;
      picker.hide();
      const name = await vscode.window.showInputBox({
        title: 'Save Deckard filter',
        prompt: 'Name this search',
        value: query,
        validateInput: (value) =>
          value.trim() ? undefined : 'A saved filter needs a name.',
      });
      if (name !== undefined) {
        const saved = await this.preferences.saveSavedQueryFilter(name, query);
        if (saved) {
          void vscode.window.showInformationMessage(
            `Saved Deckard filter: ${saved.name}`,
          );
        }
      }
    }
  }
}

/**
 * Lays the results out for the Quick Pick.
 *
 * While a search is typed VS Code hides separators and lifts rows whose label
 * matches, so each kind of row carries its own icon rather than relying on a
 * group heading. The empty picker keeps its headings.
 */
export function toPickItems(
  results: QuickFindResults,
  value: string,
): QuickFindPickItem[] {
  const items: QuickFindPickItem[] = [];
  const group = (label: string, rows: QuickFindPickItem[]): void => {
    if (rows.length === 0) {
      return;
    }
    items.push({ label, kind: vscode.QuickPickItemKind.Separator });
    items.push(...rows);
  };
  const row = (item: QuickFindItem): QuickFindPickItem => ({
    label: `${iconFor(item)} ${item.label}`,
    description: item.description,
    detail: item.detail,
    alwaysShow: true,
    item,
    buttons:
      item.kind === 'tag'
        ? [ADD_TO_SEARCH]
        : item.kind === 'recent'
          ? [SAVE_AS_VIEW]
          : item.kind === 'note'
            ? [OPEN_BESIDE, INSERT_LINK]
            : item.kind === 'task'
              ? [OPEN_BESIDE]
              : undefined,
  });

  if (results.message) {
    items.push({
      label: `$(info) ${results.message}`,
      alwaysShow: true,
      item: { kind: 'message', label: results.message },
    });
  }
  if (results.suggestion) {
    items.push({
      label: `$(lightbulb) Search for “${results.suggestion}” instead`,
      alwaysShow: true,
      suggestion: results.suggestion,
    });
  }
  group('Complete', results.conditions.map(row));
  group('Recent searches', results.recent.map(row));
  group('Tags', results.tags.map(row));
  group('Saved searches', results.savedViews.map(row));
  group(value.trim() ? 'Notes' : 'Recently opened', results.notes.map(row));
  group('Tasks', results.tasks.map(row));

  // Plain words that no note is called can be the name of a new one, as a
  // quick switcher offers: Find finds, and makes what it did not find.
  const name = value.trim();
  const named = results.notes.some(
    (note) => note.label.trim().toLowerCase() === name.toLowerCase(),
  );
  if (name && !named && isNoteName(name)) {
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: `$(new-file) Create note “${name}”`,
      alwaysShow: true,
      create: name,
    });
  }

  const total = results.totals.notes + results.totals.tasks;
  if (value.trim() && total > 0) {
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: `$(list-flat) Show all ${total} ${total === 1 ? 'result' : 'results'} on the Dashboard`,
      alwaysShow: true,
      showAll: true,
    });
  }
  return items;
}

/**
 * Whether typed text reads as a note's name rather than a search: no tag,
 * person, field, quote, parenthesis, or AND, OR, NOT.
 */
export function isNoteName(text: string): boolean {
  return (
    !/[#@:"()\[\]\/\\]/.test(text) &&
    !/(^|\s)(AND|OR|NOT)(\s|$)/.test(text) &&
    !/^-/.test(text)
  );
}

function iconFor(item: QuickFindItem): string {
  switch (item.kind) {
    case 'tag':
      return '$(tag)';
    case 'condition':
      return '$(filter)';
    case 'recent':
      return '$(history)';
    case 'savedView':
      return '$(bookmark)';
    case 'task':
      return item.completed ? '$(pass-filled)' : '$(circle-large-outline)';
    case 'note':
      return '$(note)';
    default:
      return '$(info)';
  }
}
