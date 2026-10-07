import * as vscode from 'vscode';

import type { IndexReader, IndexScanStatus, IndexUpdates } from '../../../../core/workspace/indexReader';
import { findWikiLinkPlace, parseWikiTarget } from '../../../../domain/index/backlinks';
import type { Task } from '../../../../domain/model';
import type { NavigationService } from '../../../../services/navigationService';
import type { NotePagePageToHost, NotePageSnapshot } from '../../../protocol/notePage';
import { openResultAt } from '../../../commands/navigation';
import { readQueryContext } from '../../../commands/queryContext';
import type { TaskWrites } from '../../../commands/taskActions';
import { findHubTagKey } from '../../../state/hubTree';
import { createNotePageSnapshot } from '../../../state/notePageState';
import { readSnapshotImages } from './noteImages';
import type { PageChrome } from '../../components';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import { PanelSurface } from '../../host/surface';
import {
  chooseTheme,
  goToPage,
  listGoTo,
  openGoTo,
  openHelp,
  openTag,
  displayCommand,
  setDisplay,
  setZenMode,
  toggleTask,
} from '../../host/sharedHandlers';
import { getNotePageHtml } from '../../notePageHtml';
import type { ActiveNotePage, NotePageSource } from '../../activeNotePage';
import { narrowNotePageMessage } from './messages';

/** A note the page has shown, and the line it was asked for at. */
export interface NoteLocation {
  filePath: string;
  line?: number;
}

/** What the note page reads, and whom it asks to open a tag. */
export interface NotePageControllerOptions {
  indexer: IndexReader<vscode.Uri> & IndexScanStatus & IndexUpdates;
  writes: TaskWrites;
  navigation: NavigationService;
  onOpenTag: (tagKey: string) => void | Promise<void>;
  /** The extension's folder, which the page's style sheets are under. */
  extensionUri: vscode.Uri;
  /** Where the page says it is in front, so Related Notes follows its note. */
  activeNotePage?: ActiveNotePage;
  /** Opens a search on a search page of its own. */
  onOpenSearch?: (query: string) => void | Promise<void>;
}

/** How many notes Back holds, so a long reading leaves a bounded trail. */
const HISTORY_LIMIT = 50;

/**
 * The note page: one note at a time, read in a Deckard page, its links,
 * tags, tasks, and query blocks working. The page keeps a trail of the
 * notes it has shown, for Back and Forward. It reads the note from the
 * index, so it follows each save.
 */
export class NotePageController implements PageController<NotePageSnapshot, NotePagePageToHost>, NotePageSource {
  public readonly name = 'Note page';
  public readonly options: PageOptions = {
    retainContextWhenHidden: false,
    enableFindWidget: true,
    readsInertState: true,
    restore: (state) => this.restoreFrom(state),
  };
  public readonly narrow = narrowNotePageMessage;
  public readonly handlers: MessageHandlers<NotePagePageToHost>;
  private current: NoteLocation | undefined;
  private readonly back: NoteLocation[] = [];
  private readonly forward: NoteLocation[] = [];
  /** Counts the notes asked for, so the page tells a new one from a redraw of the same. */
  private visit = 0;
  private page: PageContext | undefined;
  /** The note and line Related Notes was last told of, so a redraw of the same tells it nothing. */
  private announced: string | undefined;

  /** Reads from `notes.indexer`, and ticks tasks through `notes.writes`. */
  public constructor(private readonly notes: NotePageControllerOptions) {
    const { indexer, navigation } = notes;
    this.handlers = {
      openGoTo: openGoTo(),
      listGoTo: listGoTo({ indexer }),
      goToPage: goToPage(),
      setZenMode: setZenMode(),
      setDisplay: setDisplay(),
      displayCommand: displayCommand(),
      chooseTheme: chooseTheme(),
      openHelp: openHelp('links'),
      openNote: (message, page) => this.open(page, { filePath: message.filePath, line: message.line }, message),
      openWikiLink: (message, page) => this.openWikiLink(page, message, message),
      openInEditor: (message) => this.openInEditor(message.line, message.beside === true),
      openTag: openTag({ indexer, navigation, policy: 'lenient', openTag: (tagKey) => notes.onOpenTag(tagKey) }),
      toggleTask: toggleTask({ writes: notes.writes, findTask: (taskId): Task | undefined => indexer.getSnapshot().tasks.get(taskId) }),
      navigateNoteHistory: (message, page) => this.step(page, message.direction),
      openSearch: (message) => this.openSearch(message.query),
    };
  }

  /** The note shown, if any. */
  public get location(): NoteLocation | undefined {
    return this.current;
  }

  /**
   * Shows a note, after the one shown now, which Back returns to; a note
   * asked for again at another line moves to the line without adding to
   * the trail.
   */
  public navigate(location: NoteLocation): void {
    if (this.current && this.current.filePath !== location.filePath) {
      this.back.push(this.current);
      if (this.back.length > HISTORY_LIMIT) {
        this.back.shift();
      }
      this.forward.length = 0;
    }
    this.current = location;
    this.visit += 1;
  }

  /** The note page's HTML, carrying `state` for the page to draw at once when given one. */
  public html(webview: vscode.Webview, chrome: PageChrome, state?: NotePageSnapshot): string {
    return getNotePageHtml(webview, this.notes.extensionUri, chrome, state);
  }

  /** The note shown, drawn from the index as it is now. */
  public buildSnapshot(): NotePageSnapshot | undefined {
    if (!this.current) {
      return undefined;
    }
    const snapshot = createNotePageSnapshot(this.notes.indexer.getSnapshot(), this.current.filePath, {
      queryContext: readQueryContext(),
      ...(this.current.line === undefined ? {} : { focusLine: this.current.line }),
      history: { back: this.back.length > 0, forward: this.forward.length > 0 },
      visit: this.visit,
    });
    return this.withImages(snapshot, this.current.filePath);
  }

  /**
   * The snapshot with its images read from the note's folder, for a note on
   * this machine's disk; elsewhere, the page says each was not read.
   */
  private withImages(snapshot: NotePageSnapshot, filePath: string): NotePageSnapshot {
    const uri = this.notes.indexer.getUri(filePath);
    const root = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    if (!uri || uri.scheme !== 'file' || !root || root.uri.scheme !== 'file') {
      return snapshot;
    }
    const fsPathOf = (path: string): string | undefined => {
      const found = this.notes.indexer.getUri(path);
      return found?.scheme === 'file' ? found.fsPath : undefined;
    };
    return readSnapshotImages(snapshot, { noteFsPath: uri.fsPath, rootFsPath: root.uri.fsPath }, fsPathOf);
  }

  /** The tab says which note it shows, and Related Notes hears of a new one. */
  public onDidSendSnapshot(page: PageContext): void {
    this.page = page;
    const announced = this.current ? `${this.current.filePath}:${this.current.line ?? ''}` : undefined;
    if (announced !== this.announced) {
      this.announced = announced;
      this.notes.activeNotePage?.notifyChanged(this);
    }
    const surface = page.surface;
    const title = this.buildTitle();
    if (surface instanceof PanelSurface && title) {
      surface.panel.title = title;
    }
  }

  /** Remembers the page, so a note asked for from elsewhere draws in it, and says whether it is in front. */
  public onDidAttach(page: PageContext): void {
    this.page = page;
    this.updateActivity(page.surface?.active === true);
  }

  /** The panel coming to the front or leaving it says so, so Related Notes follows its note. */
  public onDidChangeViewState(page: PageContext): void {
    this.updateActivity(page.surface?.active === true);
  }

  /** The page stops being in front before its panel closes. */
  public dispose(): void {
    this.notes.activeNotePage?.release(this);
  }

  /** Says the page is in front, or is not. */
  private updateActivity(active: boolean): void {
    if (active) {
      this.notes.activeNotePage?.setActive(this);
    } else {
      this.notes.activeNotePage?.release(this);
    }
  }

  /** Forgets the note and the trail when the reader closes the tab, so the next tab starts its own. */
  public onDidDetach(): void {
    this.page = undefined;
    this.current = undefined;
    this.announced = undefined;
    this.notes.activeNotePage?.release(this);
    this.back.length = 0;
    this.forward.length = 0;
  }

  /** The note's name, for the tab. */
  private buildTitle(): string | undefined {
    if (!this.current) {
      return undefined;
    }
    const name = this.current.filePath.split('/').pop() ?? this.current.filePath;
    return name.replace(/\.md$/i, '');
  }

  /**
   * Opens a note from the page: here, or with Shift held in the editor,
   * which is where the setting does not open notes when it opens them here.
   * A hub note opens as its tag's search page, as Open Note as Page opens
   * it, and this page stays on the note it shows.
   */
  private async open(page: PageContext, location: NoteLocation, how: { opposite?: true; beside?: true }): Promise<void> {
    const index = this.notes.indexer.getSnapshot();
    if (!index.files.has(location.filePath)) {
      return;
    }
    if (how.opposite) {
      await openResultAt(location.filePath, location.line ?? 1, { beside: how.beside === true });
      return;
    }
    const hubTag = findHubTagKey(index, location.filePath);
    if (hubTag) {
      await this.notes.onOpenTag(hubTag);
      return;
    }
    this.navigate(location);
    page.refresh();
  }

  /**
   * Follows a `[[link]]` to the note, heading, or line it names, when exactly
   * one note has its name: read from the note it is written in, which for a
   * link inside an embed is the embedded note, so `[[#Heading]]` there is
   * that note's heading.
   */
  private async openWikiLink(page: PageContext, { target, from }: { target: string; from?: string }, how: { opposite?: true; beside?: true }): Promise<void> {
    const index = this.notes.indexer.getSnapshot();
    const writtenIn = from && index.files.has(from) ? from : this.current?.filePath;
    const place = findWikiLinkPlace(index, target, writtenIn);
    if (!place) {
      void vscode.window.showInformationMessage(`No note is named "${parseWikiTarget(target).note}" yet, or more than one is.`);
      return;
    }
    await this.open(page, place, how);
  }

  /**
   * Opens a progress line's search on a search page of its own, so the note
   * stays where it is: only a search the note shown draws now.
   */
  private async openSearch(query: string): Promise<void> {
    const snapshot = this.buildSnapshot();
    const drawn = [...(snapshot?.hub?.parts ?? []), ...(snapshot?.taskProgress?.parts ?? [])].some((part) => part.query === query);
    if (drawn) {
      await this.notes.onOpenSearch?.(query);
    }
  }

  /** Opens the note shown in the editor, at the line asked, or its first. */
  private async openInEditor(line: number | undefined, beside: boolean): Promise<void> {
    if (this.current) {
      await openResultAt(this.current.filePath, line ?? this.current.line ?? 1, { beside, pin: true });
    }
  }

  /** Back or Forward through the trail. */
  private step(page: PageContext, direction: 'back' | 'forward'): void {
    const from = direction === 'back' ? this.back : this.forward;
    const to = direction === 'back' ? this.forward : this.back;
    const next = from.pop();
    if (!next || !this.current) {
      return;
    }
    to.push(this.current);
    this.current = next;
    this.visit += 1;
    page.refresh();
  }

  /** The note a panel kept across a reload showed, if what it kept names one. */
  private restoreFrom(state: unknown): void {
    if (typeof state !== 'object' || state === null) {
      return;
    }
    const kept = state as { filePath?: unknown; line?: unknown };
    if (typeof kept.filePath === 'string' && kept.filePath) {
      this.navigate({ filePath: kept.filePath, ...(typeof kept.line === 'number' && kept.line > 0 ? { line: kept.line } : {}) });
    }
  }

  /** The page the controller draws in, while it is open. */
  public get context(): PageContext | undefined {
    return this.page;
  }
}
