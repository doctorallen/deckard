import * as vscode from 'vscode';

import { PreferencesStore } from '../../core/storage/preferences';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { createQuerySuggestions } from '../state/dashboardState';
import {
  buildQuickFindResults,
  findChoiceKey,
  QuickFindItem,
  QuickFindResults,
} from '../state/quickFindState';
import { describeDistance, formatShortDay, parseDatePhrase } from '../../core/markdown/dates';
import { parseIsoDate } from '../../core/markdown/taskMetadata';
import { openDailyNoteFor } from './dailyNoteForDate';
import { readDateOptions } from './datePrompt';
import { captureToToday, formatCapture } from './capture';
import { readQueryContext } from './queryContext';
import { createWikiLink } from './insertLink';
import { createLinkedNote } from './linkHealth';
import { openSourceAt } from './navigation';
import { Task } from '../../core/types';
import { pinKey } from '../../core/storage/preferences';
import { createPinForLine } from '../state/pinnedNotes';
import { askForDueDate, dueDateFor, pickReschedule, setTasksDue } from './agendaActions';
import { buildRowActions, RowActionId, STAYING_ACTIONS } from './quickFindActions';
import { quoteTaskTitle, toggleTask } from './taskActions';
import { keyLabel } from './quickFindKeys';
import { shortSelection } from './selectionSeed';
import { whenPublished } from '../../core/workspace/publishing';

/** Set while Quick Find is open, so Tab completes in it and nowhere else. */
export const QUICK_FIND_CONTEXT = 'deckard.quickFindOpen';

export interface QuickFindActions {
  openTag(tagKey: string): Promise<void>;
  openSavedFilter(filterId: string): Promise<void>;
  /** Opens a search page on a search. */
  showSearch(query: string): Promise<void>;
  /** Moves a task under another heading, with Move to…. */
  moveTask?(task: Task): Promise<void>;
}

interface QuickFindPickItem extends vscode.QuickPickItem {
  item?: QuickFindItem;
  /** The row that opens the whole search on the Dashboard. */
  showAll?: boolean;
  /** The row that runs the corrected spelling. */
  suggestion?: string;
  /** The row that creates a note by the name typed, when none has it. */
  create?: string;
  /** The row that says the first scan is still under way. */
  indexing?: boolean;
  /** The row that opens the daily note for the day typed. */
  openDate?: string;
  /** The row that captures what was typed to today's note. */
  capture?: { text: string; line: string };
}

/** The row that opens a day's note, when what is typed is a day. */
export interface DailyNoteRow {
  date: string;
  label: string;
  description: string;
}

/** A weekday written short, which is as often a word searched for. */
const SHORT_WEEKDAY = /^(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)$/i;

/**
 * The daily note row for what is typed, when the whole of it is a day, such
 * as `friday` or `oct 3`, and could be a note's name. A short weekday alone,
 * such as `sat`, is left to the search.
 */
export function findDailyNoteRow(
  value: string,
  now: number = Date.now(),
  options: Parameters<typeof parseDatePhrase>[2] = {},
): DailyNoteRow | undefined {
  const text = value.trim();
  if (!text || !isNoteName(text) || SHORT_WEEKDAY.test(text)) {
    return undefined;
  }
  const date = parseDatePhrase(text, now, options)?.date;
  if (!date) {
    return undefined;
  }
  const at = parseIsoDate(date);
  const distance = at === undefined ? undefined : describeDistance(at, now);
  return {
    date,
    label: `$(calendar) Open daily note for ${formatShortDay(date, now)}`,
    description: distance ? `${date} · ${distance}` : date,
  };
}

export { keyLabel };

const ADD_TO_SEARCH: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('add'),
  tooltip: 'Add to the search (Tab)',
};
const SAVE_AS_VIEW: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('save'),
  tooltip: 'Save search',
};
const OPEN_BESIDE: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('split-horizontal'),
  tooltip: `Open to the side (${keyLabel('cmd+enter')})`,
};
const INSERT_LINK: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('link'),
  tooltip: `Insert a link to it at the cursor (${keyLabel('alt+enter')})`,
};
const COMPLETE: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('check'),
  tooltip: 'Complete this task',
};
const REOPEN: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('circle-large-outline'),
  tooltip: 'Reopen this task',
};
const SET_DUE: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('calendar'),
  tooltip: 'Set its due date',
};
const SHOW_ALL: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('list-flat'),
  tooltip: 'Open every result on a search page',
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

  public async show(initialQuery?: string, activeKey?: string): Promise<void> {
    // Coming back from a row's own list keeps the editor Find was opened from.
    if (activeKey === undefined) {
      this.editor = vscode.window.activeTextEditor;
    }
    // Opened with nothing to search for, Find starts from the words
    // selected in the editor, all selected, so typing replaces them.
    const query = initialQuery ?? shortSelection(vscode.window.activeTextEditor) ?? '';
    this.picker?.dispose();
    const picker = vscode.window.createQuickPick<QuickFindPickItem>();
    this.picker = picker;
    // A task completed or dated from Find redraws in place, where it was.
    picker.keepScrollPosition = true;
    const updates = this.indexer.onDidUpdate(() => {
      if (this.picker === picker) {
        this.refresh(this.activeKey());
      }
    });
    picker.title = 'Deckard: Find';
    picker.placeholder = `Words, #tags, is:open, in:folder… Tab completes, Enter opens, ${keyLabel('cmd+.')} for more`;
    // Deckard ranks the results itself, so VS Code's own filtering must not
    // hide any of them.
    picker.matchOnDescription = false;
    picker.matchOnDetail = false;
    picker.buttons = [SHOW_ALL];
    picker.value = query;
    void vscode.commands.executeCommand('setContext', QUICK_FIND_CONTEXT, true);

    picker.onDidChangeValue(() => this.scheduleRefresh());
    picker.onDidAccept(() => void this.accept());
    picker.onDidTriggerButton(() => void this.showAll());
    picker.onDidTriggerItemButton((event) => void this.triggerItemButton(event));
    picker.onDidHide(() => {
      updates.dispose();
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

    // Before the first scan Find opens at once, busy, and says how far the
    // scan has got; what is typed is kept, and the results come in its place.
    if (this.indexer.hasIndexed === false) {
      picker.busy = true;
      const progress = this.indexer.onDidProgress(() => this.refresh());
      void whenPublished(this.indexer).then(() => {
        progress.dispose();
        picker.busy = false;
        if (this.picker === picker) {
          this.refresh();
        }
      });
    }
    this.refresh(activeKey);
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

  /**
   * Cmd+Enter: opens the highlighted note or task beside the editor and
   * keeps Find open for the next. Any other row does what Enter does.
   */
  public async openBeside(): Promise<void> {
    const item = this.picker?.activeItems[0]?.item;
    if (!item || (item.kind !== 'note' && item.kind !== 'task') || !item.filePath || !item.line) {
      await this.accept();
      return;
    }
    await this.rememberChoice(this.picker?.value ?? '', item);
    await this.openResultBeside(item);
  }

  /** Alt+Enter: links the highlighted note, or a task's heading, at the cursor. */
  public async insertLinkFromActive(): Promise<void> {
    const item = this.picker?.activeItems[0]?.item;
    if (!item || (item.kind !== 'note' && item.kind !== 'task') || !item.filePath) {
      return;
    }
    await this.rememberChoice(this.picker?.value ?? '', item);
    this.picker?.hide();
    await this.insertLink(item.filePath, item.sectionId);
  }

  /**
   * Cmd+.: everything the highlighted row can do, in a list of its own.
   * Escape, or an action that leaves things where they are, comes back to
   * Find with its search and the same row highlighted.
   */
  public async showActions(): Promise<void> {
    const picker = this.picker;
    const item = picker?.activeItems[0]?.item;
    if (!picker || !item) {
      return;
    }
    const value = picker.value;
    const index = this.indexer.getSnapshot();
    const pin =
      item.kind === 'note' && item.filePath && item.line
        ? createPinForLine(index, item.filePath, item.line)
        : undefined;
    const groups = buildRowActions(item, {
      pinned: pin !== undefined && (this.preferences.value.pinnedNotes ?? []).some((each) => pinKey(each) === pinKey(pin)),
      favorite: item.tagKey !== undefined && this.preferences.value.favoriteTags.includes(item.tagKey),
      canMove: this.actions.moveTask !== undefined,
    });
    if (groups.length === 0) {
      return;
    }
    type ActionItem = vscode.QuickPickItem & { action?: RowActionId };
    const rows: ActionItem[] = groups.flatMap((group) => [
      { label: group.label, kind: vscode.QuickPickItemKind.Separator },
      ...group.actions.map((action) => ({
        label: action.label,
        description: action.description,
        action: action.id,
      })),
    ]);
    const chosen = await vscode.window.showQuickPick(rows, {
      title: `Actions for ${quoteLabel(item.label)}`,
      placeHolder: 'What to do with it',
    });
    if (!chosen?.action) {
      await this.show(value, rowKey(item));
      return;
    }
    await this.runAction(chosen.action, item, value);
  }

  /**
   * Does one row action. One that leaves things where they are comes back
   * to Find; one that goes somewhere does not.
   */
  private async runAction(action: RowActionId, item: QuickFindItem, value?: string): Promise<void> {
    const returnTo = value ?? this.picker?.value ?? '';
    if (item.kind !== 'recent') {
      await this.rememberChoice(returnTo, item);
    }
    const back = () => (STAYING_ACTIONS.has(action) ? this.show(returnTo, rowKey(item)) : Promise.resolve());
    const index = this.indexer.getSnapshot();
    const task = item.taskId ? this.indexer.getTask(item.taskId) : undefined;
    if (item.kind === 'task' && !task && ['complete', 'reopen', 'dueToday', 'dueTomorrow', 'dueDate', 'noDue', 'editTask', 'moveTo'].includes(action)) {
      void vscode.window.showInformationMessage('That task is no longer in its note.');
      return;
    }
    switch (action) {
      case 'open':
        if (item.kind === 'savedView' && item.savedFilterId) {
          this.picker?.hide();
          await this.actions.openSavedFilter(item.savedFilterId);
        } else if (item.filePath && item.line) {
          this.picker?.hide();
          await openSourceAt(item.filePath, item.line);
          if (item.kind === 'note' && item.sectionId) {
            await this.preferences.recordSectionAccess(item.sectionId);
          }
        }
        return;
      case 'openBeside':
        if (!this.picker) {
          await this.show(returnTo, rowKey(item));
        }
        await this.openResultBeside(item);
        return;
      case 'insertLink':
        if (item.filePath) {
          this.picker?.hide();
          await this.insertLink(item.filePath, item.sectionId);
        }
        return;
      case 'copyLink':
        if (item.filePath) {
          const link = createWikiLink(index, item.filePath, item.sectionId);
          await vscode.env.clipboard.writeText(link.text);
          void vscode.window.showInformationMessage(`Copied ${link.text}.`);
        }
        return back();
      case 'pin':
      case 'unpin': {
        const pin = item.filePath && item.line ? createPinForLine(index, item.filePath, item.line) : undefined;
        if (pin) {
          if (action === 'pin') {
            await this.preferences.pinNote(pin);
          } else {
            await this.preferences.unpinNote(pinKey(pin));
          }
        }
        return back();
      }
      case 'editTask':
        if (task) {
          this.picker?.hide();
          await openSourceAt(task.filePath, task.lineNumber);
          await vscode.commands.executeCommand('deckard.editTask');
        }
        return;
      case 'complete':
      case 'reopen':
        if (task) {
          await toggleTask(task, action === 'complete');
        }
        // Find stays open, and redraws the row when the index has it.
        return this.picker ? undefined : back();
      case 'dueToday':
      case 'dueTomorrow':
      case 'noDue':
        if (task) {
          await setTasksDue(
            [task],
            action === 'noDue' ? undefined : dueDateFor(action === 'dueToday' ? 'today' : 'tomorrow'),
          );
        }
        return back();
      case 'dueDate':
        if (task) {
          const date = await askForDueDate(quoteTaskTitle(task));
          if (date !== null) {
            await setTasksDue([task], date);
          }
        }
        return back();
      case 'moveTo':
        if (task && this.actions.moveTask) {
          this.picker?.hide();
          await this.actions.moveTask(task);
        }
        return;
      case 'openTag':
        if (item.tagKey) {
          this.picker?.hide();
          await this.actions.openTag(item.tagKey);
        }
        return;
      case 'addToSearch':
      case 'putInBox':
        await this.show(item.completion ?? returnTo, rowKey(item));
        return;
      case 'favorite':
      case 'unfavorite':
        if (item.tagKey) {
          await this.preferences.toggleFavorite(item.tagKey);
        }
        return back();
      case 'renameTag':
        if (item.tagKey) {
          this.picker?.hide();
          await vscode.commands.executeCommand('deckard.renameTag', item.tagKey);
        }
        return;
      case 'search':
        await this.show(item.query ?? returnTo);
        return;
      case 'saveSearch':
        if (item.query) {
          this.picker?.hide();
          await this.saveSearch(item.query);
        }
        return;
      case 'removeRecent':
        if (item.query) {
          await this.preferences.removeRecentQuery(item.query);
        }
        return this.show(returnTo);
    }
  }

  /** Set due on a task row: the usual choices, then back to Find. */
  private async setDue(item: QuickFindItem): Promise<void> {
    const value = this.picker?.value ?? '';
    const task = item.taskId ? this.indexer.getTask(item.taskId) : undefined;
    if (!task) {
      void vscode.window.showInformationMessage('That task is no longer in its note.');
      return;
    }
    const choice = await pickReschedule(quoteTaskTitle(task), [task], undefined, {
      title: `Due date for ${quoteTaskTitle(task)}`,
    });
    if (choice?.kind === 'one') {
      await setTasksDue([task], choice.date);
    }
    await this.show(value, rowKey(item));
  }

  private async saveSearch(query: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: 'Save search',
      prompt: 'Name this search',
      value: query,
      validateInput: (value) =>
        value.trim() ? undefined : 'A saved search needs a name.',
    });
    if (name !== undefined) {
      const saved = await this.preferences.saveSavedQueryFilter(name, query);
      if (saved) {
        void vscode.window.showInformationMessage(
          `Saved the search "${saved.name}".`,
        );
      }
    }
  }

  public dispose(): void {
    this.picker?.dispose();
    this.picker = undefined;
  }

  /**
   * Remembers which result was chosen for what was typed, so Find offers
   * it higher the next time. Only results are learned, never searches.
   */
  private async rememberChoice(typed: string, item: QuickFindItem): Promise<void> {
    if (!typed.trim()) {
      return;
    }
    const key = findChoiceKey(this.indexer.getSnapshot(), item);
    if (key) {
      await this.preferences.recordFindChoice(typed, key);
    }
  }

  /** Opens a result beside the editor without taking focus from Find. */
  private async openResultBeside(item: QuickFindItem): Promise<void> {
    if (!item.filePath || !item.line) {
      return;
    }
    await openSourceAt(item.filePath, item.line, undefined, true, false, true);
    if (item.kind === 'note' && item.sectionId) {
      await this.preferences.recordSectionAccess(item.sectionId);
    }
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

  /** The active row, named so it can be found again after a redraw. */
  private activeKey(): string | undefined {
    const item = this.picker?.activeItems[0]?.item;
    return item ? rowKey(item) : undefined;
  }

  private refresh(activeKey?: string): void {
    const picker = this.picker;
    if (!picker) {
      return;
    }
    if (this.indexer.hasIndexed === false) {
      const scan = this.indexer.scanProgress;
      picker.items = [
        {
          label: `$(sync~spin) ${
            scan?.total
              ? `Indexing this workspace: ${scan.completed.toLocaleString('en-US')} of ${scan.total.toLocaleString('en-US')} notes read…`
              : 'Indexing this workspace…'
          }`,
          alwaysShow: true,
          indexing: true,
        },
      ];
      return;
    }
    const index = this.indexer.getSnapshot();
    // One moment and one reading of the settings for everything this
    // keystroke lists.
    const queryContext = readQueryContext();
    const results = buildQuickFindResults(
      index,
      this.preferences.value,
      picker.value,
      (text) => this.indexer.searchEntries(text, { limit: 200 }),
      {
        queryContext,
        conditions: createQuerySuggestions(index, [], queryContext).conditions,
        formatCapture: (text) => formatCapture(text, queryContext.now),
      },
    );
    picker.items = toPickItems(
      results,
      picker.value,
      findDailyNoteRow(picker.value, queryContext.now, readDateOptions()),
    );
    if (activeKey !== undefined) {
      const again = picker.items.find((row) => row.item && rowKey(row.item) === activeKey);
      if (again) {
        picker.activeItems = [again];
      }
    }
  }

  private async accept(): Promise<void> {
    const picker = this.picker;
    const chosen = picker?.activeItems[0];
    if (!picker || !chosen || chosen.indexing) {
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
    if (chosen.openDate !== undefined) {
      picker.hide();
      await openDailyNoteFor(this.indexer, chosen.openDate);
      return;
    }
    if (chosen.capture) {
      picker.hide();
      // Written as Capture writes it; the words were captured, so they are
      // not kept as a search.
      await captureToToday(chosen.capture.text, chosen.capture.line);
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
      await this.rememberChoice(query, item);
    }
    if (item.kind === 'tag' && item.tagKey) {
      await this.actions.openTag(item.tagKey);
    } else if (item.kind === 'savedView' && item.savedFilterId) {
      await this.actions.openSavedFilter(item.savedFilterId);
    } else if (item.filePath && item.line) {
      await openSourceAt(item.filePath, item.line);
      if (item.kind === 'note' && item.sectionId) {
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
      await this.rememberChoice(picker.value, item);
      await this.openResultBeside(item);
      return;
    }
    if (event.button === COMPLETE || event.button === REOPEN) {
      await this.runAction(event.button === COMPLETE ? 'complete' : 'reopen', item);
      return;
    }
    if (event.button === SET_DUE) {
      await this.setDue(item);
      return;
    }
    if (event.button === INSERT_LINK && item.filePath) {
      await this.rememberChoice(picker.value, item);
      picker.hide();
      await this.insertLink(item.filePath, item.sectionId);
      return;
    }
    if (event.button === SAVE_AS_VIEW && item.query) {
      const query = item.query;
      picker.hide();
      await this.saveSearch(query);
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
  dateRow?: DailyNoteRow,
): QuickFindPickItem[] {
  const items: QuickFindPickItem[] = [];
  // A day typed opens that day's note first, rather than making a note
  // called "friday".
  if (dateRow) {
    items.push({
      label: dateRow.label,
      description: dateRow.description,
      alwaysShow: true,
      openDate: dateRow.date,
    });
  }
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
              ? item.completed
                ? [OPEN_BESIDE, REOPEN]
                : [OPEN_BESIDE, COMPLETE, SET_DUE]
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
  if (value.trim()) {
    group('Complete', results.conditions.map(row));
    group('Tags', results.tags.map(row));
    group('Saved searches', results.savedViews.map(row));
    group('Notes', results.notes.map(row));
    group('Tasks', results.tasks.map(row));
  } else {
    // Before anything is typed: what was kept on purpose, then what was
    // opened last, then the searches and tags most likely to be wanted.
    group('Pinned', (results.pinned ?? []).map(row));
    group('Recently opened', results.notes.map(row));
    group('Recent searches', results.recent.map(row));
    group('Saved searches', results.savedViews.map(row));
    group('Tags', results.tags.map(row));
  }

  // Plain words that no note is called can be the name of a new one, as a
  // quick switcher offers: Find finds, and makes what it did not find.
  const name = value.trim();
  const named = results.notes.some(
    (note) => note.label.trim().toLowerCase() === name.toLowerCase(),
  );
  if (name && !named && !dateRow && isNoteName(name)) {
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: `$(new-file) Create note “${name}”`,
      alwaysShow: true,
      create: name,
    });
  }

  // What could not be found may be something to do.
  if (name && results.capture) {
    if (!(name && !named && !dateRow && isNoteName(name))) {
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }
    items.push({
      label: `$(inbox) Capture “${results.capture.text}” to today’s note`,
      detail: results.capture.line,
      alwaysShow: true,
      capture: results.capture,
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
 * A row's identity across redraws: what it opens, not where it is listed.
 */
export function rowKey(item: QuickFindItem): string {
  switch (item.kind) {
    case 'task':
      return `task:${item.taskId ?? `${item.filePath}:${item.line}`}`;
    case 'note':
      return `note:${item.sectionId ?? `${item.filePath}:${item.line}`}`;
    case 'tag':
      return `tag:${item.tagKey}`;
    case 'savedView':
      return `view:${item.savedFilterId}`;
    default:
      return `${item.kind}:${item.query ?? item.label}`;
  }
}

/** A row's label in quotes, cut as a task's title is in a message. */
function quoteLabel(label: string): string {
  const text = label.trim();
  return `"${text.length > 60 ? `${text.slice(0, 57)}…` : text}"`;
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
      return item.pinned ? '$(pinned)' : '$(note)';
    default:
      return '$(info)';
  }
}
